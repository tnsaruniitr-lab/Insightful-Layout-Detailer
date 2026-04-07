import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { db, pool } from "@workspace/db";
import {
  brandsTable,
  competitorsTable,
  mappingRunsTable,
  mappingRunSourcesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
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

interface StrategyInput {
  brandId: number;
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
  retrievedPlaybooks: Annotation<Array<{ id: number; name: string; summary: string; useWhen: string | null; expectedOutcomes: string | null; domainTag: string; confidenceScore: string | null }>>({ value: (_p, n) => n, default: () => [] }),
  retrievedPrinciples: Annotation<Array<{ id: number; title: string; statement: string; explanation: string | null; domainTag: string; confidenceScore: string | null }>>({ value: (_p, n) => n, default: () => [] }),
  retrievedAntiPatterns: Annotation<Array<{ id: number; title: string; description: string; domainTag: string; riskLevel: string }>>({ value: (_p, n) => n, default: () => [] }),
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

async function retrieveRelevantPlaybooksNode(state: StrategyStateType): Promise<Partial<StrategyStateType>> {
  const hasVec = state.brandEmbedding.length > 0;
  const vec = hasVec ? `[${state.brandEmbedding.join(",")}]` : null;
  const rows = await pool.query<{
    id: number; name: string; summary: string; use_when: string | null;
    expected_outcomes: string | null; domain_tag: string; confidence_score: string | null;
  }>(
    `SELECT id, name, summary, use_when, expected_outcomes, domain_tag, confidence_score
     FROM playbooks WHERE status IN ('canonical', 'candidate')
     ORDER BY CASE WHEN status = 'canonical' THEN 0 ELSE 1 END,
     ${hasVec ? `embedding_vector <=> $1::vector` : "id"}
     LIMIT 12`,
    hasVec ? [vec] : []
  );

  return {
    retrievedPlaybooks: rows.rows.map((r) => ({
      id: r.id, name: r.name, summary: r.summary,
      useWhen: r.use_when, expectedOutcomes: r.expected_outcomes,
      domainTag: r.domain_tag, confidenceScore: r.confidence_score,
    })),
  };
}

async function retrieveRelevantPrinciplesNode(state: StrategyStateType): Promise<Partial<StrategyStateType>> {
  const hasVec = state.brandEmbedding.length > 0;
  const vec = hasVec ? `[${state.brandEmbedding.join(",")}]` : null;
  const rows = await pool.query<{
    id: number; title: string; statement: string; explanation: string | null;
    domain_tag: string; confidence_score: string | null;
  }>(
    `SELECT id, title, statement, explanation, domain_tag, confidence_score
     FROM principles WHERE status IN ('canonical', 'candidate')
     ORDER BY CASE WHEN status = 'canonical' THEN 0 ELSE 1 END,
     ${hasVec ? `embedding_vector <=> $1::vector` : "id"}
     LIMIT 12`,
    hasVec ? [vec] : []
  );

  return {
    retrievedPrinciples: rows.rows.map((r) => ({
      id: r.id, title: r.title, statement: r.statement, explanation: r.explanation,
      domainTag: r.domain_tag, confidenceScore: r.confidence_score,
    })),
  };
}

async function generateStrategicRecommendationNode(state: StrategyStateType): Promise<Partial<StrategyStateType>> {
  const strongModel = createStrongModel();

  const hasVecAp = state.brandEmbedding.length > 0;
  const vecAp = hasVecAp ? `[${state.brandEmbedding.join(",")}]` : null;
  const apRows = await pool.query<{ id: number; title: string; description: string; domain_tag: string; risk_level: string }>(
    `SELECT id, title, description, domain_tag, risk_level
     FROM anti_patterns WHERE status IN ('canonical', 'candidate')
     ORDER BY CASE WHEN status = 'canonical' THEN 0 ELSE 1 END,
     ${hasVecAp ? `embedding_vector <=> $1::vector` : "id"}
     LIMIT 6`,
    hasVecAp ? [vecAp] : []
  );
  const retrievedAntiPatterns = apRows.rows.map((r) => ({
    id: r.id, title: r.title, description: r.description, domainTag: r.domain_tag, riskLevel: r.risk_level,
  }));

  const principlesText = state.retrievedPrinciples
    .map((p) => `[P:${p.id}] ${p.title} (${p.domainTag}): ${p.statement}`)
    .join("\n");

  const playbooksText = state.retrievedPlaybooks
    .map((p) => `[PB:${p.id}] ${p.name} (${p.domainTag}): ${p.summary}${p.useWhen ? ` | USE WHEN: ${p.useWhen}` : ""}${p.expectedOutcomes ? ` | OUTCOMES: ${p.expectedOutcomes}` : ""}`)
    .join("\n");

  const apText = retrievedAntiPatterns
    .map((a) => `[AP:${a.id}] ${a.title} (${a.riskLevel} risk, ${a.domainTag}): ${a.description}`)
    .join("\n");

  const response = await withRetry(() => strongModel.invoke([
    new SystemMessage(
      `You are a senior marketing strategist. Given a brand profile and the full intelligence library, generate a clear "where to start" strategy.
Structure your response as JSON with these exact fields:
{
  "knownPrinciples": "The most relevant principles that define the strategic starting point — cite [P:id] inline. 2-4 sentences per domain.",
  "brandInference": "1-2 sentence strategic summary for this brand.",
  "themes": [
    {
      "name": "Theme title (e.g. Authority Building)",
      "rationale": "Why this is a priority for this specific brand right now (2-3 sentences).",
      "playbookIds": [list of integer playbook IDs from [PB:N] references that are most relevant],
      "antiPatternIds": [list of integer anti-pattern IDs from [AP:N] references that apply],
      "missingData": "What specific data would make this theme clearer or more actionable."
    }
  ],
  "uncertainty": "Where the strategy lacks confidence — what brand data is missing or ambiguous",
  "missingData": "Specific data that would sharpen strategy: brand positioning details, competitive intel, channel data, etc.",
  "rationale": "1-2 sentence executive summary of the recommended starting position",
  "confidence": 0.0,
  "missingDataSummary": "The single most important data gap in one sentence"
}
Return 3-5 themes. Use only IDs from the provided playbooks and anti-patterns lists.
Respond ONLY with valid JSON, no markdown.`
    ),
    new HumanMessage(
      `Brand Context:\n${state.brandContext}

Relevant Principles:\n${principlesText || "None available"}

Relevant Playbooks:\n${playbooksText || "None available"}

Anti-Patterns to Watch:\n${apText || "None available"}`
    ),
  ]), 2, "generate_strategy");

  const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
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

  return { answer, retrievedAntiPatterns };
}

async function persistRunNode(state: StrategyStateType): Promise<Partial<StrategyStateType>> {
  const answer = state.answer!;

  const sourceRefs: SourceRef[] = [
    ...state.retrievedPrinciples.map((p) => ({
      sourceType: "principle" as const, sourceId: p.id, title: p.title,
      domainTag: p.domainTag, confidence: p.confidenceScore ? parseFloat(p.confidenceScore) : null,
      excerpt: p.statement.slice(0, 200),
    })),
    ...state.retrievedPlaybooks.map((p) => ({
      sourceType: "playbook" as const, sourceId: p.id, title: p.name,
      domainTag: p.domainTag, confidence: p.confidenceScore ? parseFloat(p.confidenceScore) : null,
      excerpt: p.summary.slice(0, 200),
    })),
    ...state.retrievedAntiPatterns.map((a) => ({
      sourceType: "anti_pattern" as const, sourceId: a.id, title: a.title,
      domainTag: a.domainTag, confidence: null,
      excerpt: a.description.slice(0, 200),
    })),
  ];

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
      sourceRefs.map((ref) => ({
        mappingRunId: run.id,
        sourceType: ref.sourceType,
        sourceId: ref.sourceId,
      }))
    );
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
  .addNode("retrieve_relevant_playbooks", retrieveRelevantPlaybooksNode)
  .addNode("retrieve_relevant_principles", retrieveRelevantPrinciplesNode)
  .addNode("generate_starting_recommendation", generateStrategicRecommendationNode)
  .addNode("persist_run", persistRunNode)
  .addEdge(START, "load_brand_context")
  .addEdge("load_brand_context", "retrieve_relevant_playbooks")
  .addEdge("retrieve_relevant_playbooks", "retrieve_relevant_principles")
  .addEdge("retrieve_relevant_principles", "generate_starting_recommendation")
  .addEdge("generate_starting_recommendation", "persist_run")
  .addEdge("persist_run", END);

const compiledGraph = workflow.compile();

export async function runStrategyStartGraph(input: StrategyInput): Promise<StrategyOutput> {
  const state = await compiledGraph.invoke({ input });
  if (!state.output) throw new Error("Strategy graph produced no output");
  return state.output;
}
