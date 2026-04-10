import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { db, pool } from "@workspace/db";
import {
  brandsTable,
  competitorsTable,
  mappingRunsTable,
  mappingRunSourcesTable,
  queryTracesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { createEmbeddings, invokeSynthesisModel, DEFAULT_SYNTHESIS_MODEL, type SynthesisModelId } from "../lib/llm";
import { logger } from "../lib/logger";
import {
  type ScoredCandidate,
  type ScoringTrace,
  parseEmbedding,
  buildChunkToDocMap,
  scoreAndSelect,
} from "../lib/scoring";

interface SourceRef {
  sourceType: "document_chunk" | "principle" | "rule" | "playbook" | "anti_pattern";
  sourceId: number;
  title: string;
  domainTag: string | null;
  confidence: number | null;
  excerpt: string | null;
}

interface ScoredPlaybook {
  playbookId: number;
  name: string;
  fitScore: number;
  icpFit: number;
  offerFit: number;
  geographyRelevance: number;
  funnelRelevance: number;
  categoryRelevance: number;
  strategicLeverage: number;
  reasoning: string;
  recommendedActions: string[];
}

interface BrandMappingInput {
  brandId: number;
  question: string;
  synthesisModel?: SynthesisModelId;
}

interface BrandMappingOutput {
  id: number;
  runType: "brand_mapping";
  query: string;
  rationale_summary: string;
  confidence: number;
  missing_data: string;
  scored_playbooks: ScoredPlaybook[];
  sections: {
    knownPrinciples: string;
    brandInference: string | null;
    uncertainty: string;
    missingData: string;
  };
  source_refs: SourceRef[];
  status: string;
  createdAt: Date;
}

const BrandMappingState = Annotation.Root({
  input: Annotation<BrandMappingInput>(),
  brandContext: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
  questionEmbedding: Annotation<number[]>({ value: (_p, n) => n, default: () => [] }),
  scoredObjects: Annotation<ScoredCandidate[]>({ value: (_p, n) => n, default: () => [] }),
  scoringTrace: Annotation<ScoringTrace | null>({ value: (_p, n) => n, default: () => null }),
  lastPrompt: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
  lastRawResponse: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
  answer: Annotation<{
    knownPrinciples: string;
    brandInference: string;
    uncertainty: string;
    missingData: string;
    rationale: string;
    confidence: number;
    missingDataSummary: string;
    scoredPlaybooks: ScoredPlaybook[];
  } | null>({ value: (_p, n) => n, default: () => null }),
  output: Annotation<BrandMappingOutput | null>({ value: (_p, n) => n, default: () => null }),
});

type BrandMappingStateType = typeof BrandMappingState.State;

async function withRetry<T>(fn: () => Promise<T>, retries = 2, label = "op"): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        logger.warn({ err, attempt, label }, "Retrying");
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

async function loadBrandContextNode(state: BrandMappingStateType): Promise<Partial<BrandMappingStateType>> {
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, state.input.brandId)).limit(1);
  if (!brand) throw new Error(`Brand ${state.input.brandId} not found`);
  const competitors = await db.select().from(competitorsTable).where(eq(competitorsTable.brandId, state.input.brandId));
  const contextParts = [
    `Brand: ${brand.name}`,
    brand.icpDescription && `ICP: ${brand.icpDescription}`,
    brand.positioningStatement && `Positioning: ${brand.positioningStatement}`,
    brand.targetGeographiesJson && `Geographies: ${brand.targetGeographiesJson}`,
    brand.productTruthsJson && `Product Truths: ${brand.productTruthsJson}`,
    brand.toneDescriptorsJson && `Tone: ${brand.toneDescriptorsJson}`,
    competitors.length > 0 && `Competitors: ${competitors.map((c) => c.name).join(", ")}`,
  ].filter(Boolean);
  const embedModel = createEmbeddings();
  const contextText = contextParts.join("\n") + "\n" + state.input.question;
  const [embedding] = await withRetry(() => embedModel.embedDocuments([contextText]), 2, "embed_brand_context");
  return { brandContext: contextParts.join("\n"), questionEmbedding: embedding };
}

async function retrieveAndScoreNode(state: BrandMappingStateType): Promise<Partial<BrandMappingStateType>> {
  const hasVec = state.questionEmbedding.length > 0;
  const vec = hasVec ? `[${state.questionEmbedding.join(",")}]` : null;

  const [playbookRows, ruleRows, apRows, principleRows] = await Promise.all([
    pool.query<{
      id: number; name: string; summary: string; use_when: string | null; avoid_when: string | null;
      domain_tag: string; confidence_score: string | null; source_refs_json: string;
      status: string; cosine_dist: number; embedding_vector: string | null;
    }>(
      `SELECT id, name, summary, use_when, avoid_when, domain_tag, confidence_score, source_refs_json, status,
              ${hasVec ? `embedding_vector <=> $1::vector AS cosine_dist, embedding_vector::text` : "0.5 AS cosine_dist, NULL::text AS embedding_vector"}
       FROM playbooks
       WHERE status IN ('canonical', 'candidate')
       ${hasVec ? "ORDER BY embedding_vector <=> $1::vector" : "ORDER BY id"}
       LIMIT 40`,
      hasVec ? [vec] : []
    ),
    pool.query<{
      id: number; name: string; if_condition: string; then_logic: string;
      domain_tag: string; confidence_score: string | null; source_refs_json: string;
      status: string; cosine_dist: number; embedding_vector: string | null;
    }>(
      `SELECT id, name, if_condition, then_logic, domain_tag, confidence_score, source_refs_json, status,
              ${hasVec ? `embedding_vector <=> $1::vector AS cosine_dist, embedding_vector::text` : "0.5 AS cosine_dist, NULL::text AS embedding_vector"}
       FROM rules
       WHERE status IN ('canonical', 'candidate')
       ${hasVec ? "ORDER BY embedding_vector <=> $1::vector" : "ORDER BY id"}
       LIMIT 40`,
      hasVec ? [vec] : []
    ),
    pool.query<{
      id: number; title: string; description: string; signals_json: string;
      domain_tag: string; risk_level: string; source_refs_json: string;
      status: string; cosine_dist: number; embedding_vector: string | null;
    }>(
      `SELECT id, title, description, signals_json, domain_tag, risk_level, source_refs_json, status,
              ${hasVec ? `embedding_vector <=> $1::vector AS cosine_dist, embedding_vector::text` : "0.5 AS cosine_dist, NULL::text AS embedding_vector"}
       FROM anti_patterns
       WHERE status IN ('canonical', 'candidate')
       ${hasVec ? "ORDER BY embedding_vector <=> $1::vector" : "ORDER BY id"}
       LIMIT 40`,
      hasVec ? [vec] : []
    ),
    pool.query<{
      id: number; title: string; statement: string; explanation: string | null;
      domain_tag: string; confidence_score: string | null; source_refs_json: string;
      status: string; cosine_dist: number; embedding_vector: string | null;
    }>(
      `SELECT id, title, statement, explanation, domain_tag, confidence_score, source_refs_json, status,
              ${hasVec ? `embedding_vector <=> $1::vector AS cosine_dist, embedding_vector::text` : "0.5 AS cosine_dist, NULL::text AS embedding_vector"}
       FROM principles
       WHERE status IN ('canonical', 'candidate')
       ${hasVec ? "ORDER BY embedding_vector <=> $1::vector" : "ORDER BY id"}
       LIMIT 40`,
      hasVec ? [vec] : []
    ),
  ]);

  const candidates = [
    ...playbookRows.rows.map((r) => ({
      id: r.id, type: "playbook" as const, title: r.name,
      cosineDist: r.cosine_dist ?? 0.5,
      confidence: parseFloat(r.confidence_score ?? "0.7"),
      sourceRefsJson: r.source_refs_json,
      isCanonical: r.status === "canonical",
      embeddingVector: parseEmbedding(r.embedding_vector),
      data: { name: r.name, summary: r.summary, useWhen: r.use_when, avoidWhen: r.avoid_when, domainTag: r.domain_tag, confidenceScore: r.confidence_score },
    })),
    ...ruleRows.rows.map((r) => ({
      id: r.id, type: "rule" as const, title: r.name,
      cosineDist: r.cosine_dist ?? 0.5,
      confidence: parseFloat(r.confidence_score ?? "0.7"),
      sourceRefsJson: r.source_refs_json,
      isCanonical: r.status === "canonical",
      embeddingVector: parseEmbedding(r.embedding_vector),
      data: { name: r.name, ifCondition: r.if_condition, thenLogic: r.then_logic, domainTag: r.domain_tag, confidenceScore: r.confidence_score },
    })),
    ...apRows.rows.map((r) => ({
      id: r.id, type: "anti_pattern" as const, title: r.title,
      cosineDist: r.cosine_dist ?? 0.5,
      confidence: 0.4,
      sourceRefsJson: r.source_refs_json,
      isCanonical: r.status === "canonical",
      embeddingVector: parseEmbedding(r.embedding_vector),
      data: { title: r.title, description: r.description, signalsJson: r.signals_json, domainTag: r.domain_tag, riskLevel: r.risk_level },
    })),
    ...principleRows.rows.map((r) => ({
      id: r.id, type: "principle" as const, title: r.title,
      cosineDist: r.cosine_dist ?? 0.5,
      confidence: parseFloat(r.confidence_score ?? "0.7"),
      sourceRefsJson: r.source_refs_json,
      isCanonical: r.status === "canonical",
      embeddingVector: parseEmbedding(r.embedding_vector),
      data: { title: r.title, statement: r.statement, explanation: r.explanation, domainTag: r.domain_tag, confidenceScore: r.confidence_score },
    })),
  ];

  const chunkToDocMap = await buildChunkToDocMap(candidates);

  const { selected: scoredObjects, trace: scoringTrace } = await scoreAndSelect({
    candidates,
    chunkToDocMap,
    targetCount: 12,
    queryLabel: `brand_mapping:${state.input.brandId}`,
    reranker: {
      enabled: true,
      question: state.input.question,
      brandContext: state.brandContext,
      model: "gpt-4o-mini",
    },
  });

  return { scoredObjects, scoringTrace };
}

async function scoreFitToBrandNode(state: BrandMappingStateType): Promise<Partial<BrandMappingStateType>> {
  const LOW_CONFIDENCE_THRESHOLD = 0.25;
  const topSimilarity = state.scoredObjects.length > 0 ? Math.max(...state.scoredObjects.map((o) => o.similarity)) : 0;
  const avgSimilarity = state.scoredObjects.length > 0
    ? state.scoredObjects.reduce((s, o) => s + o.similarity, 0) / state.scoredObjects.length
    : 0;

  if (topSimilarity < LOW_CONFIDENCE_THRESHOLD || avgSimilarity < 0.15) {
    logger.info({ topSimilarity, avgSimilarity, brandId: state.input.brandId }, "BrandMapping: low similarity — returning insufficient knowledge response");
    return {
      answer: {
        knownPrinciples: "The knowledge library does not contain sufficiently relevant information for this brand mapping.",
        brandInference: "Unable to infer brand-specific intelligence — insufficient knowledge coverage.",
        uncertainty: "No brain objects with meaningful similarity were found for this brand and question.",
        missingData: "Documents covering relevant playbooks and principles for this brand's category need to be added.",
        rationale: "Insufficient knowledge coverage for this brand mapping.",
        confidence: 0,
        missingDataSummary: "No relevant knowledge found for this brand mapping.",
        scoredPlaybooks: [],
      },
      lastPrompt: "",
      lastRawResponse: "",
    };
  }

  const playbooks = state.scoredObjects.filter((o) => o.type === "playbook");
  const rules = state.scoredObjects.filter((o) => o.type === "rule");
  const antiPatterns = state.scoredObjects.filter((o) => o.type === "anti_pattern");
  const principles = state.scoredObjects.filter((o) => o.type === "principle");

  const playbooksText = playbooks.map((p) => {
    const d = p.data as { name: string; summary: string; useWhen: string | null; avoidWhen: string | null };
    return `[PB:${p.id}] ${d.name}: ${d.summary}${d.useWhen ? `\n  USE WHEN: ${d.useWhen}` : ""}${d.avoidWhen ? `\n  AVOID WHEN: ${d.avoidWhen}` : ""}`;
  }).join("\n\n");

  const rulesText = rules.map((r) => {
    const d = r.data as { name: string; ifCondition: string; thenLogic: string };
    return `[R:${r.id}] ${d.name}: IF ${d.ifCondition} THEN ${d.thenLogic}`;
  }).join("\n");

  const apText = antiPatterns.map((a) => {
    const d = a.data as { title: string; riskLevel: string; description: string };
    return `[AP:${a.id}] ${d.title} (${d.riskLevel} risk): ${d.description}`;
  }).join("\n");

  const principlesText = principles.map((p) => {
    const d = p.data as { title: string; statement: string; explanation: string | null };
    return `[P:${p.id}] ${d.title}: ${d.statement}${d.explanation ? ` — ${d.explanation}` : ""}`;
  }).join("\n");

  const systemPrompt = `You are a playbook scoring system. Your job is to score how well each provided playbook fits the given brand, based strictly on the brand context and intelligence library provided. You do not have permission to draw on general marketing knowledge or introduce recommendations not grounded in the provided playbooks and rules.

STRICT RULES:
1. Score and reason ONLY from the provided playbooks, rules, principles, anti-patterns, and brand context — nothing else.
2. Every claim in "knownPrinciples" and "brandInference" must cite [PB:id], [R:id], [P:id], or [AP:id]. If you cannot cite it, do not state it.
3. Do not introduce strategic recommendations that are not grounded in a specific provided playbook, rule, or principle.
4. If the provided intelligence library does not contain a playbook relevant to an aspect of this brand, name that gap in "missingData" — do not substitute with general marketing advice.
5. "uncertainty" must reflect genuine gaps in what the provided context covers — not generic hedging.
6. playbookId values in scoredPlaybooks must only be IDs from the provided playbook list.

For each playbook, score six dimensions from 0.0 to 1.0: icpFit, offerFit, geographyRelevance, funnelRelevance, categoryRelevance, strategicLeverage.
The overall fitScore is the weighted mean (weights: icpFit×0.25, offerFit×0.20, geographyRelevance×0.10, funnelRelevance×0.15, categoryRelevance×0.15, strategicLeverage×0.15).

Structure your response as JSON:
{
  "knownPrinciples": "Which provided playbooks and rules are most relevant to this brand and why — every claim cites [PB:id] or [R:id]",
  "brandInference": "What the provided intelligence explicitly supports for this brand — grounded only in cited playbooks and rules",
  "uncertainty": "What the provided intelligence library does NOT cover for this brand's situation",
  "missingData": "What specific brand data or intelligence documents are missing that would improve scoring accuracy",
  "rationale": "1-2 sentence summary of what the provided context conclusively supports",
  "confidence": 0.0 to 1.0,
  "missingDataSummary": "The single most important gap in the provided context, in one sentence",
  "scoredPlaybooks": [
    {
      "playbookId": <number matching [PB:id]>,
      "name": "<playbook name>",
      "fitScore": <0.0-1.0>,
      "icpFit": <0.0-1.0>,
      "offerFit": <0.0-1.0>,
      "geographyRelevance": <0.0-1.0>,
      "funnelRelevance": <0.0-1.0>,
      "categoryRelevance": <0.0-1.0>,
      "strategicLeverage": <0.0-1.0>,
      "reasoning": "Why this playbook fits or does not fit — cite specific brand attributes and playbook properties, no general advice",
      "recommendedActions": ["action derived from this playbook's steps only"]
    }
  ]
}
Respond ONLY with valid JSON, no markdown.`;

  const userPrompt = `Brand Context:\n${state.brandContext}

Question: ${state.input.question}

Available Principles:
${principlesText || "None"}

Available Playbooks:
${playbooksText || "None"}

Available Rules:
${rulesText || "None"}

Likely Anti-Patterns to Watch:
${apText || "None"}`;

  const text = await invokeSynthesisModel(
    state.input.synthesisModel ?? DEFAULT_SYNTHESIS_MODEL,
    systemPrompt,
    userPrompt,
    2
  );
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  let answer: BrandMappingStateType["answer"] = null;
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      answer = { ...parsed, scoredPlaybooks: Array.isArray(parsed.scoredPlaybooks) ? parsed.scoredPlaybooks : [] };
    } catch { answer = null; }
  }

  if (!answer) {
    answer = {
      knownPrinciples: "Analysis generated but could not be structured.",
      brandInference: text,
      uncertainty: "Response parsing failed.",
      missingData: "Unknown.",
      rationale: "See brandInference for raw analysis.",
      confidence: 0.4,
      missingDataSummary: "Structured parsing failed.",
      scoredPlaybooks: playbooks.map((p) => ({
        playbookId: p.id, name: p.title, fitScore: 0.5,
        icpFit: 0.5, offerFit: 0.5, geographyRelevance: 0.5,
        funnelRelevance: 0.5, categoryRelevance: 0.5, strategicLeverage: 0.5,
        reasoning: "Scoring unavailable — parsing failed.", recommendedActions: [],
      })),
    };
  }

  return { answer, lastPrompt: userPrompt, lastRawResponse: text };
}

async function persistRunNode(state: BrandMappingStateType): Promise<Partial<BrandMappingStateType>> {
  const answer = state.answer!;

  const sourceRefs: SourceRef[] = state.scoredObjects.map((o) => ({
    sourceType: o.type as SourceRef["sourceType"],
    sourceId: o.id,
    title: o.title,
    domainTag: (o.data as Record<string, unknown>).domainTag as string ?? null,
    confidence: o.confidence,
    excerpt: (() => {
      const d = o.data as Record<string, unknown>;
      if (o.type === "playbook") return String(d.summary ?? "").slice(0, 200);
      if (o.type === "rule") return `IF ${d.ifCondition}`.slice(0, 200);
      if (o.type === "anti_pattern") return String(d.description ?? "").slice(0, 200);
      return "";
    })(),
  }));

  const [run] = await db.insert(mappingRunsTable).values({
    brandId: state.input.brandId,
    query: state.input.question,
    runType: "brand_mapping",
    status: "done",
    outputJson: JSON.stringify({ sections: answer, sourceRefs, scoredPlaybooks: answer.scoredPlaybooks }),
    rationale_summary: answer.rationale,
    missing_data: answer.missingDataSummary,
  }).returning();

  if (run && sourceRefs.length > 0) {
    await db.insert(mappingRunSourcesTable).values(
      sourceRefs.map((ref) => ({ mappingRunId: run.id, sourceType: ref.sourceType, sourceId: ref.sourceId }))
    );
  }

  if (run) {
    const retrievedObjects = state.scoredObjects.map((o) => ({
      type: o.type, id: o.id, title: o.title,
      confidence: o.confidence,
      finalScore: +o.finalScore.toFixed(3),
      similarity: +o.similarity.toFixed(3),
    }));
    await db.insert(queryTracesTable).values({
      mappingRunId: run.id,
      runType: "brand_mapping",
      query: state.input.question,
      brandId: state.input.brandId,
      modelUsed: state.input.synthesisModel ?? DEFAULT_SYNTHESIS_MODEL,
      retrievedObjectsJson: JSON.stringify(retrievedObjects),
      scoringTraceJson: state.scoringTrace ? JSON.stringify(state.scoringTrace) : null,
      promptText: state.lastPrompt,
      rawResponse: state.lastRawResponse,
    }).catch((err) => logger.error({ err }, "Failed to write query trace"));
  }

  const output: BrandMappingOutput = {
    id: run.id,
    runType: "brand_mapping",
    query: state.input.question,
    rationale_summary: answer.rationale,
    confidence: Math.min(1, Math.max(0, answer.confidence ?? 0.5)),
    missing_data: answer.missingDataSummary,
    scored_playbooks: answer.scoredPlaybooks,
    sections: {
      knownPrinciples: answer.knownPrinciples,
      brandInference: answer.brandInference,
      uncertainty: answer.uncertainty,
      missingData: answer.missingData,
    },
    source_refs: sourceRefs,
    status: "done",
    createdAt: run.createdAt,
  };

  return { output };
}

const workflow = new StateGraph(BrandMappingState)
  .addNode("load_brand_context", loadBrandContextNode)
  .addNode("retrieve_and_score", retrieveAndScoreNode)
  .addNode("score_fit_to_brand", scoreFitToBrandNode)
  .addNode("persist_run", persistRunNode)
  .addEdge(START, "load_brand_context")
  .addEdge("load_brand_context", "retrieve_and_score")
  .addEdge("retrieve_and_score", "score_fit_to_brand")
  .addEdge("score_fit_to_brand", "persist_run")
  .addEdge("persist_run", END);

const compiledGraph = workflow.compile();

export async function runBrandMappingGraph(input: BrandMappingInput): Promise<BrandMappingOutput> {
  const state = await compiledGraph.invoke({ input });
  if (!state.output) throw new Error("Brand mapping graph produced no output");
  return state.output;
}
