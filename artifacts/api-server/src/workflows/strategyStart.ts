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

interface StrategyInput {
  brandId: number;
  synthesisModel?: SynthesisModelId;
}

interface StrategyTheme {
  name: string;
  rationale: string;
  playbookIds: number[];
  antiPatternIds: number[];
  missingData: string;
}

interface StrategyOutput {
  id: number;
  runType: "strategy_start";
  query: string | null;
  rationale_summary: string;
  confidence: number;
  missing_data: string;
  sections: {
    knownPrinciples: string;
    brandInference: string | null;
    uncertainty: string;
    missingData: string;
    themes: StrategyTheme[] | null;
  };
  source_refs: SourceRef[];
  status: string;
  createdAt: Date;
}

const StrategyState = Annotation.Root({
  input: Annotation<StrategyInput>(),
  brandContext: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
  brandEmbedding: Annotation<number[]>({ value: (_p, n) => n, default: () => [] }),
  scoredObjects: Annotation<ScoredCandidate[]>({ value: (_p, n) => n, default: () => [] }),
  scoringTrace: Annotation<ScoringTrace | null>({ value: (_p, n) => n, default: () => null }),
  lastPrompt: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
  lastRawResponse: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
  answer: Annotation<{
    knownPrinciples: string;
    brandInference: string;
    themes: StrategyTheme[];
    uncertainty: string;
    missingData: string;
    rationale: string;
    confidence: number;
    missingDataSummary: string;
  } | null>({ value: (_p, n) => n, default: () => null }),
  output: Annotation<StrategyOutput | null>({ value: (_p, n) => n, default: () => null }),
});

type StrategyStateType = typeof StrategyState.State;

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

async function loadBrandContextNode(state: StrategyStateType): Promise<Partial<StrategyStateType>> {
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
  const brandContext = contextParts.join("\n");
  const embedModel = createEmbeddings();
  const [embedding] = await withRetry(() => embedModel.embedDocuments([brandContext]), 2, "embed_brand_strategy");
  return { brandContext, brandEmbedding: embedding };
}

async function retrieveAndScoreNode(state: StrategyStateType): Promise<Partial<StrategyStateType>> {
  const hasVec = state.brandEmbedding.length > 0;
  const vec = hasVec ? `[${state.brandEmbedding.join(",")}]` : null;

  const [playbookRows, principleRows, apRows] = await Promise.all([
    pool.query<{
      id: number; name: string; summary: string; use_when: string | null; expected_outcomes: string | null;
      domain_tag: string; confidence_score: string | null; source_refs_json: string;
      status: string; cosine_dist: number; embedding_vector: string | null;
    }>(
      `SELECT id, name, summary, use_when, expected_outcomes, domain_tag, confidence_score, source_refs_json, status,
              ${hasVec ? `embedding_vector <=> $1::vector AS cosine_dist, embedding_vector::text` : "0.5 AS cosine_dist, NULL::text AS embedding_vector"}
       FROM playbooks
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
    pool.query<{
      id: number; title: string; description: string; domain_tag: string; risk_level: string;
      source_refs_json: string; status: string; cosine_dist: number; embedding_vector: string | null;
    }>(
      `SELECT id, title, description, domain_tag, risk_level, source_refs_json, status,
              ${hasVec ? `embedding_vector <=> $1::vector AS cosine_dist, embedding_vector::text` : "0.5 AS cosine_dist, NULL::text AS embedding_vector"}
       FROM anti_patterns
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
      data: { name: r.name, summary: r.summary, useWhen: r.use_when, expectedOutcomes: r.expected_outcomes, domainTag: r.domain_tag, confidenceScore: r.confidence_score },
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
    ...apRows.rows.map((r) => ({
      id: r.id, type: "anti_pattern" as const, title: r.title,
      cosineDist: r.cosine_dist ?? 0.5,
      confidence: 0.4,
      sourceRefsJson: r.source_refs_json,
      isCanonical: r.status === "canonical",
      embeddingVector: parseEmbedding(r.embedding_vector),
      data: { title: r.title, description: r.description, domainTag: r.domain_tag, riskLevel: r.risk_level },
    })),
  ];

  const chunkToDocMap = await buildChunkToDocMap(candidates);

  const { selected: scoredObjects, trace: scoringTrace } = await scoreAndSelect({
    candidates,
    chunkToDocMap,
    targetCount: 12,
    queryLabel: `strategy:${state.input.brandId}`,
    reranker: {
      enabled: true,
      question: "What are the most relevant playbooks, principles, rules, and anti-patterns for this brand's strategic situation?",
      brandContext: state.brandContext,
      model: "gpt-4o-mini",
    },
  });

  return { scoredObjects, scoringTrace };
}

async function generateStrategicRecommendationNode(state: StrategyStateType): Promise<Partial<StrategyStateType>> {
  const principles = state.scoredObjects.filter((o) => o.type === "principle");
  const playbooks = state.scoredObjects.filter((o) => o.type === "playbook");
  const antiPatterns = state.scoredObjects.filter((o) => o.type === "anti_pattern");

  const principlesText = principles.map((p) => {
    const d = p.data as { title: string; statement: string; domainTag: string };
    return `[P:${p.id}] ${d.title} (${d.domainTag}): ${d.statement}`;
  }).join("\n");

  const playbooksText = playbooks.map((p) => {
    const d = p.data as { name: string; summary: string; useWhen: string | null; expectedOutcomes: string | null; domainTag: string };
    return `[PB:${p.id}] ${d.name} (${d.domainTag}): ${d.summary}${d.useWhen ? ` | USE WHEN: ${d.useWhen}` : ""}${d.expectedOutcomes ? ` | OUTCOMES: ${d.expectedOutcomes}` : ""}`;
  }).join("\n");

  const apText = antiPatterns.map((a) => {
    const d = a.data as { title: string; riskLevel: string; domainTag: string; description: string };
    return `[AP:${a.id}] ${d.title} (${d.riskLevel} risk, ${d.domainTag}): ${d.description}`;
  }).join("\n");

  const systemPrompt = `You are a strategy synthesis system. Your job is to map a brand profile against the provided intelligence library — principles, playbooks, and anti-patterns — and produce a grounded "where to start" strategy. You must work exclusively from what is provided. You do not have permission to introduce general marketing strategy, industry best practices, or any knowledge from outside the provided context.

STRICT RULES:
1. Every strategic theme must be grounded in at least one provided principle [P:id] or playbook [PB:id] from the lists below.
2. Do not introduce strategic priorities that are not represented in the provided intelligence library.
3. If the provided library is thin on a topic that matters for this brand, name that gap explicitly in "missingData" — do not fill it with general marketing strategy.
4. playbookIds and antiPatternIds must only contain IDs that appear in the provided playbooks and anti-patterns lists — never invent or guess IDs.
5. "uncertainty" must reflect genuine gaps in what the provided context covers — not generic strategic hedging.
6. "brandInference" must cite specific principles or playbooks — do not write strategic opinions without a citation.

Structure your response as JSON with these exact fields:
{
  "knownPrinciples": "The principles from the provided library most relevant to this brand's starting position — cite [P:id] for every claim. 2-4 sentences per domain.",
  "brandInference": "What the provided intelligence conclusively supports as this brand's strategic position — every claim must cite [P:id] or [PB:id].",
  "themes": [
    {
      "name": "Theme title drawn from the intelligence library",
      "rationale": "Why this theme is a priority — grounded in cited principles and playbooks, not general advice (2-3 sentences with citations).",
      "playbookIds": [integer IDs only from the provided playbook list],
      "antiPatternIds": [integer IDs only from the provided anti-pattern list],
      "missingData": "What specific intelligence documents or brand data are absent that would sharpen this theme."
    }
  ],
  "uncertainty": "What the provided intelligence library does NOT cover for this brand — be specific about gaps in the library, not general uncertainty",
  "missingData": "Specific intelligence documents or brand data that are missing from the library and would materially change this strategy",
  "rationale": "1-2 sentence summary of what the provided intelligence conclusively supports as the starting position",
  "confidence": 0.0 to 1.0,
  "missingDataSummary": "The single most important gap in the provided intelligence library, in one sentence"
}
Return 3-5 themes. Use ONLY IDs from the provided playbooks and anti-patterns lists.
Respond ONLY with valid JSON, no markdown.`;

  const userPrompt = `Brand Context:\n${state.brandContext}

Relevant Principles:\n${principlesText || "None available"}

Relevant Playbooks:\n${playbooksText || "None available"}

Anti-Patterns to Watch:\n${apText || "None available"}`;

  const text = await invokeSynthesisModel(
    state.input.synthesisModel ?? DEFAULT_SYNTHESIS_MODEL,
    systemPrompt,
    userPrompt,
    2
  );
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  let answer: StrategyStateType["answer"] = null;
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      answer = {
        ...parsed,
        themes: Array.isArray(parsed.themes) ? parsed.themes.map((t: { name?: unknown; rationale?: unknown; playbookIds?: unknown; antiPatternIds?: unknown; missingData?: unknown }) => ({
          name: typeof t.name === "string" ? t.name : "Unnamed Theme",
          rationale: typeof t.rationale === "string" ? t.rationale : "",
          playbookIds: Array.isArray(t.playbookIds) ? t.playbookIds.filter((id: unknown) => typeof id === "number") : [],
          antiPatternIds: Array.isArray(t.antiPatternIds) ? t.antiPatternIds.filter((id: unknown) => typeof id === "number") : [],
          missingData: typeof t.missingData === "string" ? t.missingData : "",
        })) : [],
      };
    } catch { answer = null; }
  }

  if (!answer) {
    answer = {
      knownPrinciples: "Strategy generated but could not be structured.",
      brandInference: text,
      themes: [],
      uncertainty: "Response parsing failed.",
      missingData: "Unknown.",
      rationale: "See brandInference for raw analysis.",
      confidence: 0.4,
      missingDataSummary: "Structured parsing failed.",
    };
  }

  return { answer, lastPrompt: userPrompt, lastRawResponse: text };
}

async function persistRunNode(state: StrategyStateType): Promise<Partial<StrategyStateType>> {
  const answer = state.answer!;

  const sourceRefs: SourceRef[] = state.scoredObjects.map((o) => ({
    sourceType: o.type as SourceRef["sourceType"],
    sourceId: o.id,
    title: o.title,
    domainTag: (o.data as Record<string, unknown>).domainTag as string ?? null,
    confidence: o.confidence,
    excerpt: (() => {
      const d = o.data as Record<string, unknown>;
      if (o.type === "principle") return String(d.statement ?? "").slice(0, 200);
      if (o.type === "playbook") return String(d.summary ?? "").slice(0, 200);
      if (o.type === "anti_pattern") return String(d.description ?? "").slice(0, 200);
      return "";
    })(),
  }));

  const [run] = await db.insert(mappingRunsTable).values({
    brandId: state.input.brandId,
    query: null,
    runType: "strategy_start",
    status: "done",
    outputJson: JSON.stringify({ sections: answer, sourceRefs }),
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
      runType: "strategy_start",
      query: null,
      brandId: state.input.brandId,
      modelUsed: state.input.synthesisModel ?? DEFAULT_SYNTHESIS_MODEL,
      retrievedObjectsJson: JSON.stringify(retrievedObjects),
      scoringTraceJson: state.scoringTrace ? JSON.stringify(state.scoringTrace) : null,
      promptText: state.lastPrompt,
      rawResponse: state.lastRawResponse,
    }).catch((err) => logger.error({ err }, "Failed to write query trace"));
  }

  const output: StrategyOutput = {
    id: run.id,
    runType: "strategy_start",
    query: null,
    rationale_summary: answer.rationale,
    confidence: Math.min(1, Math.max(0, answer.confidence ?? 0.5)),
    missing_data: answer.missingDataSummary,
    sections: {
      knownPrinciples: answer.knownPrinciples,
      brandInference: answer.brandInference,
      uncertainty: answer.uncertainty,
      missingData: answer.missingData,
      themes: answer.themes ?? null,
    },
    source_refs: sourceRefs,
    status: "done",
    createdAt: run.createdAt,
  };

  return { output };
}

const workflow = new StateGraph(StrategyState)
  .addNode("load_brand_context", loadBrandContextNode)
  .addNode("retrieve_and_score", retrieveAndScoreNode)
  .addNode("generate_starting_recommendation", generateStrategicRecommendationNode)
  .addNode("persist_run", persistRunNode)
  .addEdge(START, "load_brand_context")
  .addEdge("load_brand_context", "retrieve_and_score")
  .addEdge("retrieve_and_score", "generate_starting_recommendation")
  .addEdge("generate_starting_recommendation", "persist_run")
  .addEdge("persist_run", END);

const compiledGraph = workflow.compile();

export async function runStrategyStartGraph(input: StrategyInput): Promise<StrategyOutput> {
  const state = await compiledGraph.invoke({ input });
  if (!state.output) throw new Error("Strategy graph produced no output");
  return state.output;
}
