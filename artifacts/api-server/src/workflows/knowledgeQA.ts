import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { db, pool } from "@workspace/db";
import {
  brandsTable,
  mappingRunsTable,
  mappingRunSourcesTable,
  queryTracesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { createEmbeddings, createFastModel, invokeSynthesisModel, DEFAULT_SYNTHESIS_MODEL, type SynthesisModelId } from "../lib/llm";
import { logger } from "../lib/logger";
import {
  type ScoredCandidate,
  type ScoringTrace,
  parseEmbedding,
  buildChunkToDocMap,
  scoreAndSelect,
  resolveOriginalSources,
  type OriginalSource,
} from "../lib/scoring";

interface SourceRef {
  sourceType: "document_chunk" | "principle" | "rule" | "playbook" | "anti_pattern";
  sourceId: number;
  title: string;
  domainTag: string | null;
  confidence: number | null;
  excerpt: string | null;
  sourceOrg: string | null;
  originalSources: OriginalSource[];
}

interface QAInput {
  question: string;
  brandId?: number;
  brandContext?: string;
  domainFilter?: string;
  useBrandContext?: boolean;
  synthesisModel?: SynthesisModelId;
}

interface QAOutput {
  id: number;
  runType: "knowledge_answer";
  query: string;
  rationale_summary: string;
  confidence: number;
  missing_data: string;
  sections: {
    knownPrinciples: string;
    brandInference: string | null;
    uncertainty: string;
    missingData: string;
  };
  source_refs: SourceRef[];
  scoring_trace: ScoringTrace | null;
  status: string;
  createdAt: Date;
}

const QAState = Annotation.Root({
  input: Annotation<QAInput>(),
  questionEmbedding: Annotation<number[]>({ value: (_p, n) => n, default: () => [] }),
  scoredObjects: Annotation<ScoredCandidate[]>({ value: (_p, n) => n, default: () => [] }),
  scoringTrace: Annotation<ScoringTrace | null>({ value: (_p, n) => n, default: () => null }),
  brandContext: Annotation<string | null>({ value: (_p, n) => n, default: () => null }),
  lastPrompt: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
  lastRawResponse: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
  answer: Annotation<{
    knownPrinciples: string;
    brandInference: string | null;
    uncertainty: string;
    missingData: string;
    rationale: string;
    confidence: number;
    missingDataSummary: string;
  } | null>({ value: (_p, n) => n, default: () => null }),
  output: Annotation<QAOutput | null>({ value: (_p, n) => n, default: () => null }),
});

type QAStateType = typeof QAState.State;

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

async function parseQuestionNode(state: QAStateType): Promise<Partial<QAStateType>> {
  const embedModel = createEmbeddings();
  const fastModel = createFastModel();

  let queryPhrases: string[] = [state.input.question];
  try {
    const expansionResp = await fastModel.invoke([
      {
        role: "system",
        content: "Return a JSON array of exactly 2 search-optimized phrases that reformulate the user's question for semantic retrieval against a marketing strategy knowledge base. Use domain-specific vocabulary. Return ONLY a JSON array of strings, no explanation.",
      },
      { role: "user", content: state.input.question },
    ]);
    const raw = typeof expansionResp.content === "string" ? expansionResp.content.trim() : "";
    const match = raw.match(/\[[\s\S]*?\]/);
    if (match) {
      const parsed = JSON.parse(match[0]) as string[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        queryPhrases = [state.input.question, ...parsed.slice(0, 2)];
      }
    }
  } catch {
    // fall back to original question only
  }

  const embeddings = await Promise.all(
    queryPhrases.map((q) => withRetry(() => embedModel.embedDocuments([q]), 2, "embed_question"))
  );
  const vecs = embeddings.map(([e]) => e);
  const averaged = vecs[0].map((_, i) => vecs.reduce((sum, v) => sum + v[i], 0) / vecs.length);

  return { questionEmbedding: averaged };
}

async function retrieveAndScoreNode(state: QAStateType): Promise<Partial<QAStateType>> {
  const hasVec = state.questionEmbedding.length > 0;
  const vec = hasVec ? `[${state.questionEmbedding.join(",")}]` : null;

  const domainClause = state.input.domainFilter ? `AND domain_tag = '${state.input.domainFilter}'` : "";

  const [principleRows, playbookRows, ruleRows, apRows] = await Promise.all([
    pool.query<{
      id: number; title: string; statement: string; explanation: string | null;
      domain_tag: string; confidence_score: string | null; source_refs_json: string; source_org: string | null;
      status: string; cosine_dist: number; embedding_vector: string | null;
    }>(
      `SELECT id, title, statement, explanation, domain_tag, confidence_score, source_refs_json, source_org, status,
              ${hasVec ? `embedding_vector <=> $1::vector AS cosine_dist, embedding_vector::text` : "0.5 AS cosine_dist, NULL::text AS embedding_vector"}
       FROM principles
       WHERE status IN ('canonical', 'candidate') ${domainClause}
       ${hasVec ? "ORDER BY embedding_vector <=> $1::vector" : "ORDER BY id"}
       LIMIT 40`,
      hasVec ? [vec] : []
    ),
    pool.query<{
      id: number; name: string; summary: string; use_when: string | null; avoid_when: string | null;
      domain_tag: string; confidence_score: string | null; source_refs_json: string; source_org: string | null;
      status: string; cosine_dist: number; embedding_vector: string | null;
    }>(
      `SELECT id, name, summary, use_when, avoid_when, domain_tag, confidence_score, source_refs_json, source_org, status,
              ${hasVec ? `embedding_vector <=> $1::vector AS cosine_dist, embedding_vector::text` : "0.5 AS cosine_dist, NULL::text AS embedding_vector"}
       FROM playbooks
       WHERE status IN ('canonical', 'candidate') ${domainClause}
       ${hasVec ? "ORDER BY embedding_vector <=> $1::vector" : "ORDER BY id"}
       LIMIT 40`,
      hasVec ? [vec] : []
    ),
    pool.query<{
      id: number; name: string; if_condition: string; then_logic: string;
      domain_tag: string; confidence_score: string | null; source_refs_json: string; source_org: string | null;
      status: string; cosine_dist: number; embedding_vector: string | null;
    }>(
      `SELECT id, name, if_condition, then_logic, domain_tag, confidence_score, source_refs_json, source_org, status,
              ${hasVec ? `embedding_vector <=> $1::vector AS cosine_dist, embedding_vector::text` : "0.5 AS cosine_dist, NULL::text AS embedding_vector"}
       FROM rules
       WHERE status IN ('canonical', 'candidate') ${domainClause}
       ${hasVec ? "ORDER BY embedding_vector <=> $1::vector" : "ORDER BY id"}
       LIMIT 40`,
      hasVec ? [vec] : []
    ),
    pool.query<{
      id: number; title: string; description: string; signals_json: string;
      domain_tag: string; risk_level: string; source_refs_json: string; source_org: string | null;
      status: string; cosine_dist: number; embedding_vector: string | null;
    }>(
      `SELECT id, title, description, signals_json, domain_tag, risk_level, source_refs_json, source_org, status,
              ${hasVec ? `embedding_vector <=> $1::vector AS cosine_dist, embedding_vector::text` : "0.5 AS cosine_dist, NULL::text AS embedding_vector"}
       FROM anti_patterns
       WHERE status IN ('canonical', 'candidate') ${domainClause}
       ${hasVec ? "ORDER BY embedding_vector <=> $1::vector" : "ORDER BY id"}
       LIMIT 40`,
      hasVec ? [vec] : []
    ),
  ]);

  const candidates = [
    ...principleRows.rows.map((r) => ({
      id: r.id, type: "principle" as const,
      title: r.title,
      cosineDist: r.cosine_dist ?? 0.5,
      confidence: parseFloat(r.confidence_score ?? "0.7"),
      sourceRefsJson: r.source_refs_json,
      isCanonical: r.status === "canonical",
      embeddingVector: parseEmbedding(r.embedding_vector),
      data: { title: r.title, statement: r.statement, explanation: r.explanation, domainTag: r.domain_tag, confidenceScore: r.confidence_score, sourceRefsJson: r.source_refs_json, sourceOrg: r.source_org },
    })),
    ...playbookRows.rows.map((r) => ({
      id: r.id, type: "playbook" as const,
      title: r.name,
      cosineDist: r.cosine_dist ?? 0.5,
      confidence: parseFloat(r.confidence_score ?? "0.7"),
      sourceRefsJson: r.source_refs_json,
      isCanonical: r.status === "canonical",
      embeddingVector: parseEmbedding(r.embedding_vector),
      data: { name: r.name, summary: r.summary, useWhen: r.use_when, avoidWhen: r.avoid_when, domainTag: r.domain_tag, confidenceScore: r.confidence_score, sourceRefsJson: r.source_refs_json, sourceOrg: r.source_org },
    })),
    ...ruleRows.rows.map((r) => ({
      id: r.id, type: "rule" as const,
      title: r.name,
      cosineDist: r.cosine_dist ?? 0.5,
      confidence: parseFloat(r.confidence_score ?? "0.7"),
      sourceRefsJson: r.source_refs_json,
      isCanonical: r.status === "canonical",
      embeddingVector: parseEmbedding(r.embedding_vector),
      data: { name: r.name, ifCondition: r.if_condition, thenLogic: r.then_logic, domainTag: r.domain_tag, confidenceScore: r.confidence_score, sourceOrg: r.source_org },
    })),
    ...apRows.rows.map((r) => ({
      id: r.id, type: "anti_pattern" as const,
      title: r.title,
      cosineDist: r.cosine_dist ?? 0.5,
      confidence: 0.4,
      sourceRefsJson: r.source_refs_json,
      isCanonical: r.status === "canonical",
      embeddingVector: parseEmbedding(r.embedding_vector),
      data: { title: r.title, description: r.description, signalsJson: r.signals_json, domainTag: r.domain_tag, riskLevel: r.risk_level, sourceOrg: r.source_org },
    })),
  ];

  const chunkToDocMap = await buildChunkToDocMap(candidates);

  const { selected: scoredObjects, trace: scoringTrace } = await scoreAndSelect({
    candidates,
    chunkToDocMap,
    targetCount: 12,
    queryLabel: `qa:${state.input.question.slice(0, 40)}`,
    domainHint: state.input.domainFilter,
    reranker: {
      enabled: true,
      question: state.input.question,
      brandContext: state.brandContext,
      model: "gpt-4o-mini",
    },
  });

  return { scoredObjects, scoringTrace };
}

async function loadBrandContextNode(state: QAStateType): Promise<Partial<QAStateType>> {
  if (state.input.brandContext) {
    const embedModel = createEmbeddings();
    const compositeText = state.input.brandContext + "\n" + state.input.question;
    const [embedding] = await withRetry(() => embedModel.embedDocuments([compositeText]), 2, "embed_brand_question");
    return { brandContext: state.input.brandContext, questionEmbedding: embedding };
  }
  if (!state.input.brandId || !state.input.useBrandContext) return { brandContext: null };
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, state.input.brandId)).limit(1);
  if (!brand) return { brandContext: null };
  const contextParts = [
    brand.name && `Brand: ${brand.name}`,
    brand.icpDescription && `ICP: ${brand.icpDescription}`,
    brand.positioningStatement && `Positioning: ${brand.positioningStatement}`,
    brand.targetGeographiesJson && `Geographies: ${brand.targetGeographiesJson}`,
    brand.productTruthsJson && `Product truths: ${brand.productTruthsJson}`,
  ].filter(Boolean) as string[];
  const embedModel = createEmbeddings();
  const compositeText = contextParts.join("\n") + "\n" + state.input.question;
  const [embedding] = await withRetry(() => embedModel.embedDocuments([compositeText]), 2, "embed_brand_question");
  return { brandContext: contextParts.join("\n"), questionEmbedding: embedding };
}

async function synthesizeAnswerNode(state: QAStateType): Promise<Partial<QAStateType>> {
  const LOW_CONFIDENCE_THRESHOLD = 0.25;
  const topSimilarity = state.scoredObjects.length > 0 ? Math.max(...state.scoredObjects.map((o) => o.similarity)) : 0;
  const avgSimilarity = state.scoredObjects.length > 0
    ? state.scoredObjects.reduce((s, o) => s + o.similarity, 0) / state.scoredObjects.length
    : 0;

  if (topSimilarity < LOW_CONFIDENCE_THRESHOLD || avgSimilarity < 0.15) {
    logger.info({ topSimilarity, avgSimilarity, question: state.input.question }, "QA: low similarity — returning insufficient knowledge response");
    return {
      answer: {
        knownPrinciples: "The knowledge library does not contain sufficiently relevant information to answer this question.",
        brandInference: null,
        uncertainty: "No brain objects with meaningful similarity to this question were found.",
        missingData: "Documents covering this topic need to be added to the knowledge library before this question can be answered.",
        rationale: "Insufficient knowledge coverage for this query.",
        confidence: 0,
        missingDataSummary: "No relevant knowledge found for this topic.",
      },
      lastPrompt: "",
      lastRawResponse: "",
    };
  }

  const principles = state.scoredObjects.filter((o) => o.type === "principle");
  const playbooks = state.scoredObjects.filter((o) => o.type === "playbook");
  const rules = state.scoredObjects.filter((o) => o.type === "rule");
  const antiPatterns = state.scoredObjects.filter((o) => o.type === "anti_pattern");

  const principlesContext = principles.map((p) => {
    const d = p.data as { title: string; statement: string; explanation: string | null };
    return `• [P:${p.id}] ${d.title}: ${d.statement}${d.explanation ? ` — ${d.explanation}` : ""}`;
  }).join("\n");

  const playbooksContext = playbooks.map((p) => {
    const d = p.data as { name: string; summary: string };
    return `• [PB:${p.id}] ${d.name}: ${d.summary}`;
  }).join("\n");

  const rulesContext = rules.map((r) => {
    const d = r.data as { name: string; ifCondition: string; thenLogic: string };
    return `• [R:${r.id}] ${d.name}: IF ${d.ifCondition} THEN ${d.thenLogic}`;
  }).join("\n");

  const antiPatternsContext = antiPatterns.map((a) => {
    const d = a.data as { title: string; description: string; riskLevel: string };
    return `• [AP:${a.id}] ${d.title} (risk: ${d.riskLevel}): ${d.description}`;
  }).join("\n");

  const brandSection = state.brandContext ? `\nBrand Context:\n${state.brandContext}` : "";

  const systemPrompt = `You are a knowledge retrieval system. Your only job is to answer questions using the structured intelligence objects provided below. You do not have permission to use general marketing knowledge, industry conventions, or anything from outside the provided context.

STRICT RULES:
1. Use ONLY information explicitly present in the provided principles, playbooks, rules, and anti-patterns.
2. If the context does not contain enough information to answer, say so clearly — do not fill gaps with general knowledge or reasonable-sounding assumptions.
3. Every claim in "knownPrinciples" and "brandInference" must have an inline citation [P:id], [PB:id], [R:id], or [AP:id]. If you cannot cite it, do not state it.
4. "uncertainty" must explicitly name what the provided context does NOT cover — not generic hedging.
5. Never invent or paraphrase beyond what the source material states.

Structure your response as a JSON object with these exact keys:
{
  "knownPrinciples": "What the provided intelligence explicitly states about this topic — cite [P:id], [PB:id], [R:id] inline for every claim",
  "brandInference": "Brand-specific analysis grounded only in the provided brand context and cited intelligence — null if no brand context provided",
  "uncertainty": "What the provided context does NOT cover or where the source material is ambiguous",
  "missingData": "What documents or data would need to be added to the intelligence library to answer this more completely",
  "rationale": "1-2 sentence summary of what the provided context supports",
  "confidence": 0.0 to 1.0,
  "missingDataSummary": "The single most important gap in the provided context, in one sentence"
}
Respond ONLY with valid JSON, no markdown.`;

  const userPrompt = `Question: ${state.input.question}${brandSection}

Available Principles:
${principlesContext || "None"}

Available Playbooks:
${playbooksContext || "None"}

Available Rules:
${rulesContext || "None"}

Available Anti-Patterns (things to avoid):
${antiPatternsContext || "None"}`;

  const text = await invokeSynthesisModel(
    state.input.synthesisModel ?? DEFAULT_SYNTHESIS_MODEL,
    systemPrompt,
    userPrompt,
    2
  );

  const traceState = { lastPrompt: userPrompt, lastRawResponse: text };
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    return {
      ...traceState,
      answer: {
        knownPrinciples: text,
        brandInference: state.brandContext ? "Brand context was provided but synthesis failed." : null,
        uncertainty: "Response parsing failed — raw answer provided above.",
        missingData: "Unable to determine structured missing data.",
        rationale: "LLM response was not structured JSON.",
        confidence: 0.3,
        missingDataSummary: "Response parsing error.",
      },
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      knownPrinciples: string; brandInference: string | null; uncertainty: string;
      missingData: string; rationale: string; confidence: number; missingDataSummary: string;
    };
    return { ...traceState, answer: parsed };
  } catch {
    return {
      ...traceState,
      answer: {
        knownPrinciples: text, brandInference: null, uncertainty: "Parse error.",
        missingData: "Unknown.", rationale: "Could not parse structured answer.",
        confidence: 0.3, missingDataSummary: "Parse error.",
      },
    };
  }
}

async function persistRunNode(state: QAStateType): Promise<Partial<QAStateType>> {
  const answer = state.answer!;

  const originalSourcesMap = await resolveOriginalSources(state.scoredObjects);
  const sourceRefs: SourceRef[] = state.scoredObjects.map((o) => {
    const key = `${o.type}:${o.id}`;
    const originalSources = originalSourcesMap.get(key) ?? [];
    const sourceOrg = originalSources[0]?.sourceOrg ?? (o.data as Record<string, unknown>).sourceOrg as string | null ?? null;
    return {
      sourceType: o.type === "anti_pattern" ? "anti_pattern" : o.type as SourceRef["sourceType"],
      sourceId: o.id,
      title: o.title,
      domainTag: (o.data as Record<string, unknown>).domainTag as string ?? null,
      confidence: o.confidence,
      excerpt: (() => {
        const d = o.data as Record<string, unknown>;
        if (o.type === "principle") return String(d.statement ?? "").slice(0, 200);
        if (o.type === "playbook") return String(d.summary ?? "").slice(0, 200);
        if (o.type === "rule") return `IF ${d.ifCondition} THEN ${d.thenLogic}`.slice(0, 200);
        return "";
      })(),
      sourceOrg,
      originalSources,
    };
  });

  const [run] = await db.insert(mappingRunsTable).values({
    brandId: state.input.brandId ?? null,
    query: state.input.question,
    runType: "knowledge_answer",
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
      runType: "knowledge_answer",
      query: state.input.question,
      brandId: state.input.brandId ?? null,
      modelUsed: state.input.synthesisModel ?? DEFAULT_SYNTHESIS_MODEL,
      retrievedObjectsJson: JSON.stringify(retrievedObjects),
      scoringTraceJson: state.scoringTrace ? JSON.stringify(state.scoringTrace) : null,
      promptText: state.lastPrompt,
      rawResponse: state.lastRawResponse,
    }).catch((err) => logger.error({ err }, "Failed to write query trace"));
  }

  const output: QAOutput = {
    id: run.id,
    runType: "knowledge_answer",
    query: state.input.question,
    rationale_summary: answer.rationale,
    confidence: Math.min(1, Math.max(0, answer.confidence ?? 0.5)),
    missing_data: answer.missingDataSummary,
    sections: {
      knownPrinciples: answer.knownPrinciples,
      brandInference: answer.brandInference,
      uncertainty: answer.uncertainty,
      missingData: answer.missingData,
    },
    source_refs: sourceRefs,
    scoring_trace: state.scoringTrace ?? null,
    status: "done",
    createdAt: run.createdAt,
  };

  return { output };
}

const workflow = new StateGraph(QAState)
  .addNode("parse_question", parseQuestionNode)
  .addNode("retrieve_and_score", retrieveAndScoreNode)
  .addNode("load_brand_context", loadBrandContextNode)
  .addNode("synthesize_answer", synthesizeAnswerNode)
  .addNode("persist_run", persistRunNode)
  .addEdge(START, "parse_question")
  .addEdge("parse_question", "load_brand_context")
  .addEdge("load_brand_context", "retrieve_and_score")
  .addEdge("retrieve_and_score", "synthesize_answer")
  .addEdge("synthesize_answer", "persist_run")
  .addEdge("persist_run", END);

const compiledGraph = workflow.compile();

export async function runKnowledgeQAGraph(input: QAInput): Promise<QAOutput> {
  const state = await compiledGraph.invoke({ input });
  if (!state.output) throw new Error("QA graph produced no output");
  return state.output;
}
