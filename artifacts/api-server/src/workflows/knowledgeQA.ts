import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { db, pool } from "@workspace/db";
import {
  brandsTable,
  principlesTable,
  playbooksTable,
  rulesTable,
  mappingRunsTable,
  mappingRunSourcesTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { createStrongModel, createEmbeddings } from "../lib/llm";
import { logger } from "../lib/logger";

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
  retrievedPrinciples: Annotation<Array<{ id: number; title: string; statement: string; explanation: string | null; domainTag: string; confidenceScore: string | null; sourceRefsJson: string }>>({ value: (_p, n) => n, default: () => [] }),
  retrievedPlaybooks: Annotation<Array<{ id: number; name: string; summary: string; domainTag: string; confidenceScore: string | null; sourceRefsJson: string }>>({ value: (_p, n) => n, default: () => [] }),
  retrievedRules: Annotation<Array<{ id: number; name: string; ifCondition: string; thenLogic: string; domainTag: string; confidenceScore: string | null }>>({ value: (_p, n) => n, default: () => [] }),
  retrievedChunks: Annotation<Array<{ id: number; chunkText: string; domainTag: string | null; documentId: number }>>({ value: (_p, n) => n, default: () => [] }),
  brandContext: Annotation<string | null>({ value: (_p, n) => n, default: () => null }),
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

async function retrieveBrainObjectsNode(state: QAStateType): Promise<Partial<QAStateType>> {
  const vec = `[${state.questionEmbedding.join(",")}]`;

  const principleRows = await pool.query<{
    id: number; title: string; statement: string; explanation: string | null;
    domain_tag: string; confidence_score: string | null; source_refs_json: string;
  }>(
    `SELECT id, title, statement, explanation, domain_tag, confidence_score, source_refs_json
     FROM principles
     WHERE status IN ('canonical', 'candidate')
     ${state.input.domainFilter ? `AND domain_tag = '${state.input.domainFilter}'` : ""}
     ORDER BY CASE WHEN status = 'canonical' THEN 0 ELSE 1 END,
     ${state.questionEmbedding.length > 0 ? `embedding_vector <=> '${vec}'::vector` : "id"}
     LIMIT 10`,
    []
  );

  const playbookRows = await pool.query<{
    id: number; name: string; summary: string; domain_tag: string;
    confidence_score: string | null; source_refs_json: string;
  }>(
    `SELECT id, name, summary, domain_tag, confidence_score, source_refs_json
     FROM playbooks
     WHERE status IN ('canonical', 'candidate')
     ${state.input.domainFilter ? `AND domain_tag = '${state.input.domainFilter}'` : ""}
     ORDER BY CASE WHEN status = 'canonical' THEN 0 ELSE 1 END,
     ${state.questionEmbedding.length > 0 ? `embedding_vector <=> '${vec}'::vector` : "id"}
     LIMIT 10`,
    []
  );

  const ruleRows = await pool.query<{
    id: number; name: string; if_condition: string; then_logic: string;
    domain_tag: string; confidence_score: string | null;
  }>(
    `SELECT id, name, if_condition, then_logic, domain_tag, confidence_score
     FROM rules
     WHERE status IN ('canonical', 'candidate')
     ORDER BY CASE WHEN status = 'canonical' THEN 0 ELSE 1 END,
     ${state.questionEmbedding.length > 0 ? `embedding_vector <=> '${vec}'::vector` : "id"}
     LIMIT 10`,
    []
  );

  const retrievedPrinciples = principleRows.rows.map((r) => ({
    id: r.id, title: r.title, statement: r.statement, explanation: r.explanation,
    domainTag: r.domain_tag, confidenceScore: r.confidence_score, sourceRefsJson: r.source_refs_json,
  }));

  const retrievedPlaybooks = playbookRows.rows.map((r) => ({
    id: r.id, name: r.name, summary: r.summary,
    domainTag: r.domain_tag, confidenceScore: r.confidence_score, sourceRefsJson: r.source_refs_json,
  }));

  const retrievedRules = ruleRows.rows.map((r) => ({
    id: r.id, name: r.name, ifCondition: r.if_condition, thenLogic: r.then_logic,
    domainTag: r.domain_tag, confidenceScore: r.confidence_score,
  }));

  return { retrievedPrinciples, retrievedPlaybooks, retrievedRules };
}

async function retrieveSupportingChunksNode(state: QAStateType): Promise<Partial<QAStateType>> {
  if (state.questionEmbedding.length === 0) return { retrievedChunks: [] };

  const vec = `[${state.questionEmbedding.join(",")}]`;
  const rows = await pool.query<{ id: number; chunk_text: string; domain_tag: string | null; document_id: number }>(
    `SELECT id, chunk_text, domain_tag, document_id
     FROM document_chunks
     WHERE embedding_vector IS NOT NULL
     ORDER BY embedding_vector <=> $1::vector
     LIMIT 15`,
    [vec]
  );
  const retrievedChunks = rows.rows.map((r) => ({
    id: r.id, chunkText: r.chunk_text, domainTag: r.domain_tag, documentId: r.document_id,
  }));
  return { retrievedChunks };
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
  const strongModel = createStrongModel();

  const principlesContext = state.retrievedPrinciples
    .map((p) => `• [P:${p.id}] ${p.title}: ${p.statement}${p.explanation ? ` — ${p.explanation}` : ""}`)
    .join("\n");

  const playbooksContext = state.retrievedPlaybooks
    .map((p) => `• [PB:${p.id}] ${p.name}: ${p.summary}`)
    .join("\n");

  const rulesContext = state.retrievedRules
    .map((r) => `• [R:${r.id}] ${r.name}: IF ${r.ifCondition} THEN ${r.thenLogic}`)
    .join("\n");

  const chunksContext = state.retrievedChunks
    .slice(0, 8)
    .map((c) => `• [C:${c.id}] ${c.chunkText.slice(0, 300)}`)
    .join("\n");

  const brandSection = state.brandContext ? `\nBrand Context:\n${state.brandContext}` : "";

  const response = await withRetry(() => strongModel.invoke([
    new SystemMessage(
      `You are a senior marketing intelligence analyst. Answer the user's question using the provided brain objects and source chunks.
Structure your response as a JSON object with these exact keys:
{
  "knownPrinciples": "What the intelligence base knows about this topic — cite [P:id], [PB:id], [R:id] inline",
  "brandInference": "Brand-specific analysis using the brand context — null if no brand context provided",
  "uncertainty": "What is not known or where confidence is low",
  "missingData": "What data or documents would improve this answer",
  "rationale": "1-2 sentence summary of overall reasoning",
  "confidence": 0.0 to 1.0,
  "missingDataSummary": "Top-level gap summary in 1 sentence"
}
Every claim must cite a source. Respond ONLY with valid JSON, no markdown.`
    ),
    new HumanMessage(
      `Question: ${state.input.question}${brandSection}

Available Principles:
${principlesContext || "None"}

Available Playbooks:
${playbooksContext || "None"}

Available Rules:
${rulesContext || "None"}

Supporting Source Chunks:
${chunksContext || "None"}`
    ),
  ]), 2, "synthesize_qa");

  const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    return {
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
      knownPrinciples: string;
      brandInference: string | null;
      uncertainty: string;
      missingData: string;
      rationale: string;
      confidence: number;
      missingDataSummary: string;
    };
    return { answer: parsed };
  } catch {
    return {
      answer: {
        knownPrinciples: text,
        brandInference: null,
        uncertainty: "Parse error.",
        missingData: "Unknown.",
        rationale: "Could not parse structured answer.",
        confidence: 0.3,
        missingDataSummary: "Parse error.",
      },
    };
  }
}

async function persistRunNode(state: QAStateType): Promise<Partial<QAStateType>> {
  const answer = state.answer!;

  const sourceRefs: SourceRef[] = [
    ...state.retrievedPrinciples.map((p) => ({
      sourceType: "principle" as const,
      sourceId: p.id,
      title: p.title,
      domainTag: p.domainTag,
      confidence: p.confidenceScore ? parseFloat(p.confidenceScore) : null,
      excerpt: p.statement.slice(0, 200),
    })),
    ...state.retrievedPlaybooks.map((p) => ({
      sourceType: "playbook" as const,
      sourceId: p.id,
      title: p.name,
      domainTag: p.domainTag,
      confidence: p.confidenceScore ? parseFloat(p.confidenceScore) : null,
      excerpt: p.summary.slice(0, 200),
    })),
    ...state.retrievedRules.map((r) => ({
      sourceType: "rule" as const,
      sourceId: r.id,
      title: r.name,
      domainTag: r.domainTag,
      confidence: r.confidenceScore ? parseFloat(r.confidenceScore) : null,
      excerpt: `IF ${r.ifCondition} THEN ${r.thenLogic}`.slice(0, 200),
    })),
    ...state.retrievedChunks.slice(0, 5).map((c) => ({
      sourceType: "document_chunk" as const,
      sourceId: c.id,
      title: `Chunk ${c.id}`,
      domainTag: c.domainTag,
      confidence: null,
      excerpt: c.chunkText.slice(0, 200),
    })),
  ];

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
    const runSourceValues = sourceRefs.map((ref) => ({
      mappingRunId: run.id,
      sourceType: ref.sourceType,
      sourceId: ref.sourceId,
    }));
    await db.insert(mappingRunSourcesTable).values(runSourceValues);
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
  .addNode("retrieve_brain_objects", retrieveBrainObjectsNode)
  .addNode("retrieve_supporting_chunks", retrieveSupportingChunksNode)
  .addNode("load_brand_context", loadBrandContextNode)
  .addNode("synthesize_answer", synthesizeAnswerNode)
  .addNode("persist_run", persistRunNode)
  .addEdge(START, "parse_question")
  .addEdge("parse_question", "retrieve_brain_objects")
  .addEdge("retrieve_brain_objects", "retrieve_supporting_chunks")
  .addEdge("retrieve_supporting_chunks", "load_brand_context")
  .addEdge("load_brand_context", "synthesize_answer")
  .addEdge("synthesize_answer", "persist_run")
  .addEdge("persist_run", END);

const compiledGraph = workflow.compile();

export async function runKnowledgeQAGraph(input: QAInput): Promise<QAOutput> {
  const state = await compiledGraph.invoke({ input });
  if (!state.output) throw new Error("QA graph produced no output");
  return state.output;
}
