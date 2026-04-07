import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { db, pool } from "@workspace/db";
import {
  brandsTable,
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
  buildFrequencyMap,
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

interface QAInput {
  question: string;
  brandId?: number;
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
  const [embedding] = await withRetry(() => embedModel.embedDocuments([state.input.question]), 2, "embed_question");
  return { questionEmbedding: embedding };
}

async function retrieveAndScoreNode(state: QAStateType): Promise<Partial<QAStateType>> {
  const hasVec = state.questionEmbedding.length > 0;
  const vec = hasVec ? `[${state.questionEmbedding.join(",")}]` : null;

  const domainClause = state.input.domainFilter ? `AND domain_tag = '${state.input.domainFilter}'` : "";

  const [principleRows, playbookRows, ruleRows] = await Promise.all([
    pool.query<{
      id: number; title: string; statement: string; explanation: string | null;
      domain_tag: string; confidence_score: string | null; source_refs_json: string;
      status: string; cosine_dist: number; embedding_vector: string | null;
    }>(
      `SELECT id, title, statement, explanation, domain_tag, confidence_score, source_refs_json, status,
              ${hasVec ? `embedding_vector <=> $1::vector AS cosine_dist, embedding_vector::text` : "0.5 AS cosine_dist, NULL::text AS embedding_vector"}
       FROM principles
       WHERE status IN ('canonical', 'candidate') ${domainClause}
       ${hasVec ? "ORDER BY embedding_vector <=> $1::vector" : "ORDER BY id"}
       LIMIT 20`,
      hasVec ? [vec] : []
    ),
    pool.query<{
      id: number; name: string; summary: string; domain_tag: string;
      confidence_score: string | null; source_refs_json: string;
      status: string; cosine_dist: number; embedding_vector: string | null;
    }>(
      `SELECT id, name, summary, domain_tag, confidence_score, source_refs_json, status,
              ${hasVec ? `embedding_vector <=> $1::vector AS cosine_dist, embedding_vector::text` : "0.5 AS cosine_dist, NULL::text AS embedding_vector"}
       FROM playbooks
       WHERE status IN ('canonical', 'candidate') ${domainClause}
       ${hasVec ? "ORDER BY embedding_vector <=> $1::vector" : "ORDER BY id"}
       LIMIT 20`,
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
       LIMIT 20`,
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
      data: { title: r.title, statement: r.statement, explanation: r.explanation, domainTag: r.domain_tag, confidenceScore: r.confidence_score, sourceRefsJson: r.source_refs_json },
    })),
    ...playbookRows.rows.map((r) => ({
      id: r.id, type: "playbook" as const,
      title: r.name,
      cosineDist: r.cosine_dist ?? 0.5,
      confidence: parseFloat(r.confidence_score ?? "0.7"),
      sourceRefsJson: r.source_refs_json,
      isCanonical: r.status === "canonical",
      embeddingVector: parseEmbedding(r.embedding_vector),
      data: { name: r.name, summary: r.summary, domainTag: r.domain_tag, confidenceScore: r.confidence_score, sourceRefsJson: r.source_refs_json },
    })),
    ...ruleRows.rows.map((r) => ({
      id: r.id, type: "rule" as const,
      title: r.name,
      cosineDist: r.cosine_dist ?? 0.5,
      confidence: parseFloat(r.confidence_score ?? "0.7"),
      sourceRefsJson: r.source_refs_json,
      isCanonical: r.status === "canonical",
      embeddingVector: parseEmbedding(r.embedding_vector),
      data: { name: r.name, ifCondition: r.if_condition, thenLogic: r.then_logic, domainTag: r.domain_tag, confidenceScore: r.confidence_score },
    })),
  ];

  const [chunkToDocMap, { map: frequencyMap, totalTraceCount }] = await Promise.all([
    buildChunkToDocMap(candidates),
    buildFrequencyMap(),
  ]);

  const { selected: scoredObjects, trace: scoringTrace } = scoreAndSelect({
    candidates,
    chunkToDocMap,
    frequencyMap,
    totalTraceCount,
    targetCount: 12,
    queryLabel: `qa:${state.input.question.slice(0, 40)}`,
  });

  return { scoredObjects, scoringTrace };
}

async function loadBrandContextNode(state: QAStateType): Promise<Partial<QAStateType>> {
  if (!state.input.brandId || !state.input.useBrandContext) return { brandContext: null };
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, state.input.brandId)).limit(1);
  if (!brand) return { brandContext: null };
  const context = [
    brand.name && `Brand: ${brand.name}`,
    brand.icpDescription && `ICP: ${brand.icpDescription}`,
    brand.positioningStatement && `Positioning: ${brand.positioningStatement}`,
    brand.targetGeographiesJson && `Geographies: ${brand.targetGeographiesJson}`,
    brand.productTruthsJson && `Product truths: ${brand.productTruthsJson}`,
  ].filter(Boolean).join("\n");
  return { brandContext: context };
}

async function synthesizeAnswerNode(state: QAStateType): Promise<Partial<QAStateType>> {
  const principles = state.scoredObjects.filter((o) => o.type === "principle");
  const playbooks = state.scoredObjects.filter((o) => o.type === "playbook");
  const rules = state.scoredObjects.filter((o) => o.type === "rule");

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

  const brandSection = state.brandContext ? `\nBrand Context:\n${state.brandContext}` : "";

  const systemPrompt = `You are a knowledge retrieval system. Your only job is to answer questions using the structured intelligence objects provided below. You do not have permission to use general marketing knowledge, industry conventions, or anything from outside the provided context.

STRICT RULES:
1. Use ONLY information explicitly present in the provided principles, playbooks, and rules.
2. If the context does not contain enough information to answer, say so clearly — do not fill gaps with general knowledge or reasonable-sounding assumptions.
3. Every claim in "knownPrinciples" and "brandInference" must have an inline citation [P:id], [PB:id], or [R:id]. If you cannot cite it, do not state it.
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
${rulesContext || "None"}`;

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

  const sourceRefs: SourceRef[] = state.scoredObjects.map((o) => ({
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
  }));

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
  .addEdge("parse_question", "retrieve_and_score")
  .addEdge("retrieve_and_score", "load_brand_context")
  .addEdge("load_brand_context", "synthesize_answer")
  .addEdge("synthesize_answer", "persist_run")
  .addEdge("persist_run", END);

const compiledGraph = workflow.compile();

export async function runKnowledgeQAGraph(input: QAInput): Promise<QAOutput> {
  const state = await compiledGraph.invoke({ input });
  if (!state.output) throw new Error("QA graph produced no output");
  return state.output;
}
