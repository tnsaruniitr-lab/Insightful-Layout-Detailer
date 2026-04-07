import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { db, pool } from "@workspace/db";
import {
  brandsTable,
  competitorsTable,
  principlesTable,
  playbooksTable,
  rulesTable,
  antiPatternsTable,
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
  retrievedPlaybooks: Annotation<Array<{ id: number; name: string; summary: string; useWhen: string | null; avoidWhen: string | null; domainTag: string; confidenceScore: string | null }>>({ value: (_p, n) => n, default: () => [] }),
  retrievedRules: Annotation<Array<{ id: number; name: string; ifCondition: string; thenLogic: string; domainTag: string; confidenceScore: string | null }>>({ value: (_p, n) => n, default: () => [] }),
  retrievedAntiPatterns: Annotation<Array<{ id: number; title: string; description: string; signalsJson: string; domainTag: string; riskLevel: string }>>({ value: (_p, n) => n, default: () => [] }),
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

  return {
    brandContext: contextParts.join("\n"),
    questionEmbedding: embedding,
  };
}

async function retrieveRelevantPlaybooksNode(state: BrandMappingStateType): Promise<Partial<BrandMappingStateType>> {
  const vec = `[${state.questionEmbedding.join(",")}]`;
  const rows = await pool.query<{
    id: number; name: string; summary: string; use_when: string | null;
    avoid_when: string | null; domain_tag: string; confidence_score: string | null;
  }>(
    `SELECT id, name, summary, use_when, avoid_when, domain_tag, confidence_score
     FROM playbooks
     WHERE status IN ('canonical', 'candidate')
     ORDER BY CASE WHEN status = 'canonical' THEN 0 ELSE 1 END,
     ${state.questionEmbedding.length > 0 ? `embedding_vector <=> '${vec}'::vector` : "id"}
     LIMIT 10`,
    []
  );

  return {
    retrievedPlaybooks: rows.rows.map((r) => ({
      id: r.id, name: r.name, summary: r.summary,
      useWhen: r.use_when, avoidWhen: r.avoid_when,
      domainTag: r.domain_tag, confidenceScore: r.confidence_score,
    })),
  };
}

async function retrieveRelevantRulesNode(state: BrandMappingStateType): Promise<Partial<BrandMappingStateType>> {
  const vec = `[${state.questionEmbedding.join(",")}]`;
  const rows = await pool.query<{
    id: number; name: string; if_condition: string; then_logic: string;
    domain_tag: string; confidence_score: string | null;
  }>(
    `SELECT id, name, if_condition, then_logic, domain_tag, confidence_score
     FROM rules WHERE status IN ('canonical', 'candidate')
     ORDER BY CASE WHEN status = 'canonical' THEN 0 ELSE 1 END,
     ${state.questionEmbedding.length > 0 ? `embedding_vector <=> '${vec}'::vector` : "id"}
     LIMIT 8`,
    []
  );

  return {
    retrievedRules: rows.rows.map((r) => ({
      id: r.id, name: r.name, ifCondition: r.if_condition, thenLogic: r.then_logic,
      domainTag: r.domain_tag, confidenceScore: r.confidence_score,
    })),
  };
}

async function scoreFitToBrandNode(state: BrandMappingStateType): Promise<Partial<BrandMappingStateType>> {
  const strongModel = createStrongModel();

  const vec = `[${state.questionEmbedding.join(",")}]`;
  const apRows = await pool.query<{ id: number; title: string; description: string; signals_json: string; domain_tag: string; risk_level: string }>(
    `SELECT id, title, description, signals_json, domain_tag, risk_level
     FROM anti_patterns WHERE status IN ('canonical', 'candidate')
     ORDER BY CASE WHEN status = 'canonical' THEN 0 ELSE 1 END,
     ${state.questionEmbedding.length > 0 ? `embedding_vector <=> '${vec}'::vector` : "id"}
     LIMIT 5`,
    []
  );

  const retrievedAntiPatterns = apRows.rows.map((r) => ({
    id: r.id, title: r.title, description: r.description,
    signalsJson: r.signals_json, domainTag: r.domain_tag, riskLevel: r.risk_level,
  }));

  const playbooksText = state.retrievedPlaybooks
    .map((p) => `[PB:${p.id}] ${p.name} (${p.domainTag}): ${p.summary}${p.useWhen ? `\n  USE WHEN: ${p.useWhen}` : ""}${p.avoidWhen ? `\n  AVOID WHEN: ${p.avoidWhen}` : ""}`)
    .join("\n\n");

  const rulesText = state.retrievedRules
    .map((r) => `[R:${r.id}] ${r.name}: IF ${r.ifCondition} THEN ${r.thenLogic}`)
    .join("\n");

  const apText = retrievedAntiPatterns
    .map((a) => `[AP:${a.id}] ${a.title} (${a.riskLevel} risk): ${a.description}`)
    .join("\n");

  const response = await withRetry(() => strongModel.invoke([
    new SystemMessage(
      `You are a marketing intelligence analyst. Score how well each available playbook fits a specific brand.
For each playbook score these six dimensions from 0.0 to 1.0: icpFit, offerFit, geographyRelevance, funnelRelevance, categoryRelevance, strategicLeverage.
The overall fitScore is the weighted mean (weights: icpFit×0.25, offerFit×0.20, geographyRelevance×0.10, funnelRelevance×0.15, categoryRelevance×0.15, strategicLeverage×0.15).

Structure your response as JSON:
{
  "knownPrinciples": "Summary of which playbooks and rules are most relevant to this brand and why — cite [PB:id] and [R:id]",
  "brandInference": "Brand-specific strategic inference — what this brand should prioritise and why",
  "uncertainty": "Where confidence is low or data is ambiguous",
  "missingData": "What specific brand data would improve the scoring",
  "rationale": "1-2 sentence overall summary",
  "confidence": 0.0 to 1.0,
  "missingDataSummary": "Top gap in one sentence",
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
      "reasoning": "Why this playbook fits or doesn't fit this brand, referencing specific brand attributes",
      "recommendedActions": ["action1", "action2"]
    }
  ]
}
Respond ONLY with valid JSON, no markdown.`
    ),
    new HumanMessage(
      `Brand Context:\n${state.brandContext}

Question: ${state.input.question}

Available Playbooks:\n${playbooksText || "None"}

Available Rules:\n${rulesText || "None"}

Likely Anti-Patterns to Watch:\n${apText || "None"}`
    ),
  ]), 2, "score_fit_brand");

  const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  let answer: BrandMappingStateType["answer"] = null;
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      answer = {
        ...parsed,
        scoredPlaybooks: Array.isArray(parsed.scoredPlaybooks) ? parsed.scoredPlaybooks : [],
      };
    } catch {
      answer = null;
    }
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
      scoredPlaybooks: state.retrievedPlaybooks.map((p) => ({
        playbookId: p.id,
        name: p.name,
        fitScore: 0.5,
        icpFit: 0.5,
        offerFit: 0.5,
        geographyRelevance: 0.5,
        funnelRelevance: 0.5,
        categoryRelevance: 0.5,
        strategicLeverage: 0.5,
        reasoning: "Scoring unavailable — parsing failed.",
        recommendedActions: [],
      })),
    };
  }

  return { answer, retrievedAntiPatterns };
}

async function persistRunNode(state: BrandMappingStateType): Promise<Partial<BrandMappingStateType>> {
  const answer = state.answer!;

  const sourceRefs: SourceRef[] = [
    ...state.retrievedPlaybooks.map((p) => ({
      sourceType: "playbook" as const, sourceId: p.id, title: p.name,
      domainTag: p.domainTag, confidence: p.confidenceScore ? parseFloat(p.confidenceScore) : null,
      excerpt: p.summary.slice(0, 200),
    })),
    ...state.retrievedRules.map((r) => ({
      sourceType: "rule" as const, sourceId: r.id, title: r.name,
      domainTag: r.domainTag, confidence: r.confidenceScore ? parseFloat(r.confidenceScore) : null,
      excerpt: `IF ${r.ifCondition}`.slice(0, 200),
    })),
    ...state.retrievedAntiPatterns.map((a) => ({
      sourceType: "anti_pattern" as const, sourceId: a.id, title: a.title,
      domainTag: a.domainTag, confidence: null,
      excerpt: a.description.slice(0, 200),
    })),
  ];

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
      sourceRefs.map((ref) => ({
        mappingRunId: run.id,
        sourceType: ref.sourceType,
        sourceId: ref.sourceId,
      }))
    );
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
  .addNode("retrieve_relevant_playbooks", retrieveRelevantPlaybooksNode)
  .addNode("retrieve_relevant_rules", retrieveRelevantRulesNode)
  .addNode("score_fit_to_brand", scoreFitToBrandNode)
  .addNode("persist_run", persistRunNode)
  .addEdge(START, "load_brand_context")
  .addEdge("load_brand_context", "retrieve_relevant_playbooks")
  .addEdge("retrieve_relevant_playbooks", "retrieve_relevant_rules")
  .addEdge("retrieve_relevant_rules", "score_fit_to_brand")
  .addEdge("score_fit_to_brand", "persist_run")
  .addEdge("persist_run", END);

const compiledGraph = workflow.compile();

export async function runBrandMappingGraph(input: BrandMappingInput): Promise<BrandMappingOutput> {
  const state = await compiledGraph.invoke({ input });
  if (!state.output) throw new Error("Brand mapping graph produced no output");
  return state.output;
}
