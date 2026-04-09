import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { syncAfterIngestion } from "../lib/supabaseSync";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { db, pool } from "@workspace/db";
import {
  documentsTable,
  documentChunksTable,
  principlesTable,
  rulesTable,
  playbooksTable,
  playbookStepsTable,
  antiPatternsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { createFastModel, createStrongModel, createEmbeddings } from "../lib/llm";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";

const DEDUPE_SIMILARITY_THRESHOLD = 0.92;
const CHUNK_TARGET_TOKENS = 400;
const CHUNK_OVERLAP_TOKENS = 50;
const EMBED_BATCH_SIZE = 100;

const TRUST_MULTIPLIERS: Record<"high" | "medium" | "low", number> = {
  high: 1.00,
  medium: 0.85,
  low: 0.70,
};

function applyTrust(score: number, trust: "high" | "medium" | "low"): number {
  return Math.min(1, score * TRUST_MULTIPLIERS[trust]);
}

type DomainTag = "seo" | "geo" | "aeo" | "content" | "entity" | "general";

interface ChunkRecord {
  id: number;
  chunkIndex: number;
  chunkText: string;
  tokenCount: number;
  domainTag: DomainTag | null;
  sourceConfidence: string | null;
  embedding: number[] | null;
}

interface ExtractedPrinciple {
  title: string;
  statement: string;
  explanation: string;
  domainTag: DomainTag;
  confidenceScore: number;
  sourceChunkIds: number[];
}

interface ExtractedRule {
  name: string;
  ruleType: "diagnostic" | "mapping" | "scoring" | "warning";
  ifCondition: string;
  thenLogic: string;
  domainTag: DomainTag;
  confidenceScore: number;
  sourceChunkIds: number[];
}

interface ExtractedPlaybook {
  name: string;
  summary: string;
  useWhen: string;
  avoidWhen: string;
  expectedOutcomes: string;
  domainTag: DomainTag;
  confidenceScore: number;
  sourceChunkIds: number[];
  steps: Array<{ title: string; description: string }>;
}

interface ExtractedAntiPattern {
  title: string;
  description: string;
  signals: string[];
  domainTag: DomainTag;
  riskLevel: "high" | "medium" | "low";
  confidenceScore: number;
  sourceChunkIds: number[];
}

const IngestionState = Annotation.Root({
  documentId: Annotation<number>(),
  rawText: Annotation<string>({ value: (_prev, next) => next, default: () => "" }),
  chunks: Annotation<ChunkRecord[]>({ value: (_prev, next) => next, default: () => [] }),
  extractedPrinciples: Annotation<ExtractedPrinciple[]>({ value: (_prev, next) => next, default: () => [] }),
  extractedRules: Annotation<ExtractedRule[]>({ value: (_prev, next) => next, default: () => [] }),
  extractedPlaybooks: Annotation<ExtractedPlaybook[]>({ value: (_prev, next) => next, default: () => [] }),
  extractedAntiPatterns: Annotation<ExtractedAntiPattern[]>({ value: (_prev, next) => next, default: () => [] }),
  persistedPrincipleIds: Annotation<number[]>({ value: (_prev, next) => next, default: () => [] }),
  persistedRuleIds: Annotation<number[]>({ value: (_prev, next) => next, default: () => [] }),
  persistedPlaybookIds: Annotation<number[]>({ value: (_prev, next) => next, default: () => [] }),
  persistedAntiPatternIds: Annotation<number[]>({ value: (_prev, next) => next, default: () => [] }),
  docTrustLevel: Annotation<"high" | "medium" | "low">({ value: (_prev, next) => next, default: () => "medium" as const }),
  status: Annotation<"processing" | "done" | "error">({ value: (_prev, next) => next, default: () => "processing" as const }),
  errorMessage: Annotation<string | null>({ value: (_prev, next) => next, default: () => null }),
});

type IngestionStateType = typeof IngestionState.State;

async function withRetry<T>(fn: () => Promise<T>, retries = 2, label = "op"): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        logger.warn({ err, attempt, label }, "Retrying after error");
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function chunkText(text: string, targetTokens: number, overlapTokens: number): string[] {
  const words = text.split(/\s+/);
  const targetWords = targetTokens * 3;
  const overlapWords = overlapTokens * 3;
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    const end = Math.min(i + targetWords, words.length);
    chunks.push(words.slice(i, end).join(" "));
    if (end >= words.length) break;
    i += targetWords - overlapWords;
  }
  return chunks.filter((c) => c.trim().length > 20);
}

function parseDomainTag(raw: string | undefined): DomainTag {
  const valid: DomainTag[] = ["seo", "geo", "aeo", "content", "entity", "general"];
  return valid.includes(raw as DomainTag) ? (raw as DomainTag) : "general";
}

async function setProgress(docId: number, step: string): Promise<void> {
  try {
    await db.update(documentsTable)
      .set({ errorMessage: `progress:${step}` })
      .where(eq(documentsTable.id, docId));
  } catch {
    // Non-fatal — progress updates are best-effort
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function extractTextNode(state: IngestionStateType): Promise<Partial<IngestionStateType>> {
  await setProgress(state.documentId, "extracting_text");
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, state.documentId)).limit(1);
  if (!doc) throw new Error(`Document ${state.documentId} not found`);

  const objectStorage = new ObjectStorageService();
  const file = await objectStorage.getObjectEntityFile(doc.storagePath);
  const [fileBuffer] = await file.download();

  let rawText: string;
  if (doc.sourceType === "pdf") {
    const pdfParseModule = await import("pdf-parse");
    const pdfParse = (pdfParseModule as unknown as { default: (buf: Buffer) => Promise<{ text: string }> }).default ?? pdfParseModule;
    const parsed = await pdfParse(fileBuffer as Buffer);
    rawText = parsed.text;
  } else if (doc.sourceType === "doc") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: fileBuffer as Buffer });
    rawText = result.value;
    if (result.messages.length > 0) {
      logger.warn({ docId: state.documentId, warnings: result.messages.length }, "Mammoth DOCX warnings");
    }
  } else {
    rawText = (fileBuffer as Buffer).toString("utf-8");
  }

  const docTrustLevel = (doc.trustLevel ?? "medium") as "high" | "medium" | "low";
  logger.info({ docId: state.documentId, chars: rawText.length, trustLevel: docTrustLevel }, "Text extracted");
  return { rawText, docTrustLevel };
}

async function chunkDocumentNode(state: IngestionStateType): Promise<Partial<IngestionStateType>> {
  await setProgress(state.documentId, "chunking_document");
  const rawChunks = chunkText(state.rawText, CHUNK_TARGET_TOKENS, CHUNK_OVERLAP_TOKENS);

  const insertedChunks = await db.transaction(async (tx) => {
    await tx.delete(documentChunksTable).where(eq(documentChunksTable.documentId, state.documentId));
    const rows = await tx
      .insert(documentChunksTable)
      .values(rawChunks.map((text, i) => ({
        documentId: state.documentId,
        chunkIndex: i,
        chunkText: text,
        tokenCount: estimateTokens(text),
      })))
      .returning();
    return rows;
  });

  const chunks: ChunkRecord[] = insertedChunks.map((r) => ({
    id: r.id,
    chunkIndex: r.chunkIndex,
    chunkText: r.chunkText,
    tokenCount: r.tokenCount,
    domainTag: null,
    sourceConfidence: null,
    embedding: null,
  }));

  logger.info({ docId: state.documentId, count: chunks.length }, "Chunks created");
  return { chunks };
}

async function embedChunksNode(state: IngestionStateType): Promise<Partial<IngestionStateType>> {
  await setProgress(state.documentId, "embedding_chunks");
  const embedModel = createEmbeddings();
  const texts = state.chunks.map((c) => c.chunkText);
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const batchEmbeddings = await withRetry(() => embedModel.embedDocuments(batch), 2, "embed_batch");
    allEmbeddings.push(...batchEmbeddings);
  }

  const updatedChunks = state.chunks.map((c, i) => ({ ...c, embedding: allEmbeddings[i] }));

  await Promise.all(updatedChunks.map((c) => {
    if (!c.embedding) return Promise.resolve();
    const vec = `[${c.embedding.join(",")}]`;
    return pool.query(
      "UPDATE document_chunks SET embedding_vector = $1::vector WHERE id = $2",
      [vec, c.id]
    );
  }));

  logger.info({ docId: state.documentId, count: updatedChunks.length }, "Chunks embedded");
  return { chunks: updatedChunks };
}

async function classifyChunksNode(state: IngestionStateType): Promise<Partial<IngestionStateType>> {
  await setProgress(state.documentId, "classifying_chunks");
  const fastModel = createFastModel();

  const BATCH = 20;
  const updatedChunks = [...state.chunks];

  for (let i = 0; i < state.chunks.length; i += BATCH) {
    const batch = state.chunks.slice(i, i + BATCH);
    const batchText = batch.map((c, j) =>
      `[${i + j}] ${c.chunkText.slice(0, 300)}`
    ).join("\n---\n");

    const response = await withRetry(() => fastModel.invoke([
      new SystemMessage(
        `You classify text chunks for a marketing intelligence system.
For each chunk, respond with a JSON array of objects: [{index, domain_tag, source_confidence}]
domain_tag options: seo, geo, aeo, content, entity, general
source_confidence: 0.0 to 1.0 (how authoritative the content seems)
Respond ONLY with valid JSON array, no markdown.`
      ),
      new HumanMessage(`Classify these chunks:\n${batchText}`),
    ]), 2, "classify_chunks");

    try {
      const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const classifications = JSON.parse(jsonMatch[0]) as Array<{
          index: number;
          domain_tag: string;
          source_confidence: number;
        }>;
        for (const cls of classifications) {
          const chunkIdx = cls.index;
          if (chunkIdx >= 0 && chunkIdx < updatedChunks.length) {
            updatedChunks[chunkIdx] = {
              ...updatedChunks[chunkIdx],
              domainTag: parseDomainTag(cls.domain_tag),
              sourceConfidence: String(Math.min(1, Math.max(0, cls.source_confidence ?? 0.5))),
            };
          }
        }
        await Promise.all(
          classifications.map((cls) => {
            const chunk = updatedChunks[cls.index];
            if (!chunk) return Promise.resolve();
            return db.update(documentChunksTable)
              .set({
                domainTag: chunk.domainTag ?? "general",
                sourceConfidence: chunk.sourceConfidence ?? "0.5",
              })
              .where(eq(documentChunksTable.id, chunk.id));
          })
        );
      }
    } catch (err) {
      logger.warn({ err }, "Failed to parse classification response for batch");
    }
  }

  return { chunks: updatedChunks };
}

async function extractPrinciplesNode(state: IngestionStateType): Promise<Partial<IngestionStateType>> {
  await setProgress(state.documentId, "extracting_principles");
  const strongModel = createStrongModel();
  const domainGroups = new Map<DomainTag, ChunkRecord[]>();

  for (const chunk of state.chunks) {
    const tag = chunk.domainTag ?? "general";
    if (!domainGroups.has(tag)) domainGroups.set(tag, []);
    domainGroups.get(tag)!.push(chunk);
  }

  const principles: ExtractedPrinciple[] = [];

  for (const [domain, chunks] of domainGroups) {
    const contextText = chunks.length === 1
      ? `[chunk_id:${chunks[0].id}] ${chunks[0].chunkText}`
      : chunks
          .slice(0, 15)
          .map((c) => `[chunk_id:${c.id}] ${c.chunkText.slice(0, 1500)}`)
          .join("\n---\n");

    const response = await withRetry(() => strongModel.invoke([
      new SystemMessage(
        `You extract intelligence principles from knowledge documents.
A principle is a universal truth about ${domain} that should guide strategy — not a definition, not a description.
Extract 1-8 principles from the provided content.
For compliance/policy content (platform guidelines, technical specs), extract the core requirements as principles.
Respond with a JSON array: [{title, statement, explanation, confidence_score, source_chunk_ids}]
- title: short name (< 10 words)
- statement: the core principle in 1-2 sentences — must be actionable, not definitional
- explanation: 2-4 sentence explanation with evidence from the content
- confidence_score: 0.0 to 1.0
- source_chunk_ids: array of chunk IDs that support this principle
If you find vague statements like "X is important for Y", use the surrounding context to sharpen them into specific, falsifiable truths rather than skipping them.
Respond ONLY with valid JSON array, no markdown.`
      ),
      new HumanMessage(`Domain: ${domain}\n\nContent:\n${contextText}`),
    ]), 2, "extract_principles");

    const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error(`extract_principles: LLM returned non-JSON for domain ${domain}: ${text.slice(0, 200)}`);
    const extracted = JSON.parse(jsonMatch[0]) as Array<{
      title: string;
      statement: string;
      explanation: string;
      confidence_score: number;
      source_chunk_ids: number[];
    }>;
    const fallbackChunkId = state.chunks[0]?.id;
    for (const p of extracted) {
      const rawIds: number[] = Array.isArray(p.source_chunk_ids) ? p.source_chunk_ids.filter(Number.isInteger) : [];
      const sourceChunkIds = rawIds.length > 0 ? rawIds : (fallbackChunkId != null ? [fallbackChunkId] : []);
      if (p.title && p.statement && sourceChunkIds.length > 0) {
        principles.push({
          title: p.title,
          statement: p.statement,
          explanation: p.explanation ?? "",
          domainTag: domain,
          confidenceScore: Math.min(1, Math.max(0, p.confidence_score ?? 0.7)),
          sourceChunkIds,
        });
      }
    }
  }

  const persistedIds: number[] = [];
  for (const item of principles) {
    const [row] = await db.insert(principlesTable).values({
      title: item.title,
      statement: item.statement,
      explanation: item.explanation,
      domainTag: item.domainTag,
      confidenceScore: String(applyTrust(item.confidenceScore, state.docTrustLevel)),
      sourceCount: 1,
      sourceRefsJson: JSON.stringify([state.documentId]),
      status: "candidate",
    }).returning();
    if (row) persistedIds.push(row.id);
  }

  logger.info({ docId: state.documentId, count: principles.length, trustLevel: state.docTrustLevel }, "Principles extracted");
  return { extractedPrinciples: principles, persistedPrincipleIds: persistedIds };
}

async function extractRulesNode(state: IngestionStateType): Promise<Partial<IngestionStateType>> {
  await setProgress(state.documentId, "extracting_rules");
  const strongModel = createStrongModel();
  const contextText = state.chunks.length === 1
    ? `[chunk_id:${state.chunks[0].id}] ${state.chunks[0].chunkText}`
    : state.chunks
        .slice(0, 20)
        .map((c) => `[chunk_id:${c.id}] ${c.chunkText.slice(0, 1500)}`)
        .join("\n---\n");

  const response = await withRetry(() => strongModel.invoke([
    new SystemMessage(
      `You extract actionable rules from knowledge documents.
A rule has an IF condition (specific observable trigger) and THEN action/implication.
Rules may be compliance requirements, technical requirements, or strategic guidelines.
For compliance/policy content (Google guidelines, platform policies, technical specs), extract the specific DO/DON'T requirements as rules.
Extract 1-8 rules from the content.
Respond with a JSON array: [{name, rule_type, if_condition, then_logic, domain_tag, confidence_score, source_chunk_ids}]
- rule_type: one of: diagnostic, mapping, scoring, warning
- domain_tag: one of: seo, geo, aeo, content, entity, general
- confidence_score: 0.0 to 1.0
- source_chunk_ids: array of chunk IDs
IMPORTANT: if_condition must be a specific observable trigger — not a definition or category.
If you find vague conditions like "if running a test" or "if content exists", use the surrounding context to sharpen them into concrete specifics (e.g. "if using 301 redirect for A/B test variant", "if Googlebot receives different content than users") rather than skipping them.
Respond ONLY with valid JSON array, no markdown.`
    ),
    new HumanMessage(`Content:\n${contextText}`),
  ]), 2, "extract_rules");

  const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`extract_rules: LLM returned non-JSON: ${text.slice(0, 200)}`);
  const extracted = JSON.parse(jsonMatch[0]) as Array<{
    name: string;
    rule_type: string;
    if_condition: string;
    then_logic: string;
    domain_tag: string;
    confidence_score: number;
    source_chunk_ids: number[];
  }>;

  const validTypes = ["diagnostic", "mapping", "scoring", "warning"];
  const fallbackRuleChunkId = state.chunks[0]?.id;
  const rules: ExtractedRule[] = extracted
    .filter((r) => {
      const rawIds: number[] = Array.isArray(r.source_chunk_ids) ? r.source_chunk_ids.filter(Number.isInteger) : [];
      const ids = rawIds.length > 0 ? rawIds : (fallbackRuleChunkId != null ? [fallbackRuleChunkId] : []);
      return r.name && r.if_condition && r.then_logic && ids.length > 0;
    })
    .map((r) => {
      const rawIds: number[] = Array.isArray(r.source_chunk_ids) ? r.source_chunk_ids.filter(Number.isInteger) : [];
      return {
        name: r.name,
        ruleType: (validTypes.includes(r.rule_type) ? r.rule_type : "diagnostic") as "diagnostic" | "mapping" | "scoring" | "warning",
        ifCondition: r.if_condition,
        thenLogic: r.then_logic,
        domainTag: parseDomainTag(r.domain_tag),
        confidenceScore: Math.min(1, Math.max(0, r.confidence_score ?? 0.7)),
        sourceChunkIds: rawIds.length > 0 ? rawIds : [fallbackRuleChunkId!],
      };
    });

  const persistedIds: number[] = [];
  for (const item of rules) {
    const [row] = await db.insert(rulesTable).values({
      name: item.name,
      ruleType: item.ruleType,
      ifCondition: item.ifCondition,
      thenLogic: item.thenLogic,
      domainTag: item.domainTag,
      confidenceScore: String(applyTrust(item.confidenceScore, state.docTrustLevel)),
      sourceRefsJson: JSON.stringify([state.documentId]),
      status: "candidate",
    }).returning();
    if (row) persistedIds.push(row.id);
  }

  logger.info({ docId: state.documentId, count: rules.length, trustLevel: state.docTrustLevel }, "Rules extracted");
  return { extractedRules: rules, persistedRuleIds: persistedIds };
}

async function extractPlaybooksNode(state: IngestionStateType): Promise<Partial<IngestionStateType>> {
  await setProgress(state.documentId, "extracting_playbooks");
  const strongModel = createStrongModel();
  const contextText = state.chunks.length === 1
    ? `[chunk_id:${state.chunks[0].id}] ${state.chunks[0].chunkText}`
    : state.chunks
        .slice(0, 20)
        .map((c) => `[chunk_id:${c.id}] ${c.chunkText.slice(0, 1500)}`)
        .join("\n---\n");

  const response = await withRetry(() => strongModel.invoke([
    new SystemMessage(
      `You extract actionable playbooks from knowledge documents.
A playbook is a repeatable procedure for achieving a specific outcome — it may be a technical implementation process, a compliance workflow, or a strategic marketing procedure.
Extract 0-3 playbooks from the content. Only extract if a genuine step-by-step process is present.
Respond with a JSON array: [{name, summary, use_when, avoid_when, expected_outcomes, domain_tag, confidence_score, source_chunk_ids, steps}]
- steps: array of {title, description} — the ordered execution steps (2-8 steps)
- use_when: specific conditions that trigger this playbook (not vague like "when needed")
- avoid_when: specific conditions where this playbook should not be used
- domain_tag: one of: seo, geo, aeo, content, entity, general
- confidence_score: 0.0 to 1.0
Respond ONLY with valid JSON array, no markdown.`
    ),
    new HumanMessage(`Content:\n${contextText}`),
  ]), 2, "extract_playbooks");

  const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`extract_playbooks: LLM returned non-JSON: ${text.slice(0, 200)}`);
  const extracted = JSON.parse(jsonMatch[0]) as Array<{
    name: string;
    summary: string;
    use_when: string;
    avoid_when: string;
    expected_outcomes: string;
    domain_tag: string;
    confidence_score: number;
    source_chunk_ids: number[];
    steps: Array<{ title: string; description: string }>;
  }>;

  const fallbackPlaybookChunkId = state.chunks[0]?.id;
  const playbooks: ExtractedPlaybook[] = extracted
    .filter((p) => {
      const rawIds: number[] = Array.isArray(p.source_chunk_ids) ? p.source_chunk_ids.filter(Number.isInteger) : [];
      const ids = rawIds.length > 0 ? rawIds : (fallbackPlaybookChunkId != null ? [fallbackPlaybookChunkId] : []);
      return p.name && p.summary && ids.length > 0;
    })
    .map((p) => {
      const rawIds: number[] = Array.isArray(p.source_chunk_ids) ? p.source_chunk_ids.filter(Number.isInteger) : [];
      return {
        name: p.name,
        summary: p.summary,
        useWhen: p.use_when ?? "",
        avoidWhen: p.avoid_when ?? "",
        expectedOutcomes: p.expected_outcomes ?? "",
        domainTag: parseDomainTag(p.domain_tag),
        confidenceScore: Math.min(1, Math.max(0, p.confidence_score ?? 0.7)),
        sourceChunkIds: rawIds.length > 0 ? rawIds : [fallbackPlaybookChunkId!],
        steps: (p.steps ?? []).filter((s) => s.title),
      };
    });

  const persistedIds: number[] = [];
  for (const item of playbooks) {
    const [row] = await db.insert(playbooksTable).values({
      name: item.name,
      summary: item.summary,
      useWhen: item.useWhen,
      avoidWhen: item.avoidWhen,
      expectedOutcomes: item.expectedOutcomes,
      domainTag: item.domainTag,
      confidenceScore: String(applyTrust(item.confidenceScore, state.docTrustLevel)),
      sourceRefsJson: JSON.stringify([state.documentId]),
      status: "candidate",
    }).returning();
    if (row) {
      persistedIds.push(row.id);
      for (let i = 0; i < item.steps.length; i++) {
        await db.insert(playbookStepsTable).values({
          playbookId: row.id,
          stepOrder: i + 1,
          stepTitle: item.steps[i].title,
          stepDescription: item.steps[i].description,
        });
      }
    }
  }

  logger.info({ docId: state.documentId, count: playbooks.length }, "Playbooks extracted");
  return { extractedPlaybooks: playbooks, persistedPlaybookIds: persistedIds };
}

async function extractAntiPatternsNode(state: IngestionStateType): Promise<Partial<IngestionStateType>> {
  await setProgress(state.documentId, "extracting_anti_patterns");
  const strongModel = createStrongModel();
  const contextText = state.chunks.length === 1
    ? `[chunk_id:${state.chunks[0].id}] ${state.chunks[0].chunkText}`
    : state.chunks
        .slice(0, 20)
        .map((c) => `[chunk_id:${c.id}] ${c.chunkText.slice(0, 1500)}`)
        .join("\n---\n");

  const response = await withRetry(() => strongModel.invoke([
    new SystemMessage(
      `You extract anti-patterns from knowledge documents.
An anti-pattern is a common mistake, violation, or harmful practice that produces negative outcomes.
This includes technical anti-patterns (wrong redirect types, cloaking), compliance violations (against Google/platform policies), and strategic mistakes.
Extract 0-4 anti-patterns from the content. Only extract if genuinely present.
Respond with a JSON array: [{title, description, signals, domain_tag, risk_level, confidence_score, source_chunk_ids}]
- signals: array of specific, observable signs that this anti-pattern is occurring (not vague like "poor performance")
- risk_level: one of: high, medium, low — base on severity of consequence
- domain_tag: one of: seo, geo, aeo, content, entity, general
- confidence_score: 0.0 to 1.0
Respond ONLY with valid JSON array, no markdown.`
    ),
    new HumanMessage(`Content:\n${contextText}`),
  ]), 2, "extract_anti_patterns");

  const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`extract_anti_patterns: LLM returned non-JSON: ${text.slice(0, 200)}`);
  const extracted = JSON.parse(jsonMatch[0]) as Array<{
    title: string;
    description: string;
    signals: string[];
    domain_tag: string;
    risk_level: string;
    confidence_score: number;
    source_chunk_ids: number[];
  }>;

  const validRisk = ["high", "medium", "low"];
  const fallbackApChunkId = state.chunks[0]?.id;
  const antiPatterns: ExtractedAntiPattern[] = extracted
    .filter((a) => {
      const rawIds: number[] = Array.isArray(a.source_chunk_ids) ? a.source_chunk_ids.filter(Number.isInteger) : [];
      const ids = rawIds.length > 0 ? rawIds : (fallbackApChunkId != null ? [fallbackApChunkId] : []);
      return a.title && a.description && ids.length > 0;
    })
    .map((a) => {
      const rawIds: number[] = Array.isArray(a.source_chunk_ids) ? a.source_chunk_ids.filter(Number.isInteger) : [];
      return {
        title: a.title,
        description: a.description,
        signals: a.signals ?? [],
        domainTag: parseDomainTag(a.domain_tag),
        riskLevel: (validRisk.includes(a.risk_level) ? a.risk_level : "medium") as "high" | "medium" | "low",
        confidenceScore: Math.min(1, Math.max(0, a.confidence_score ?? 0.7)),
        sourceChunkIds: rawIds.length > 0 ? rawIds : [fallbackApChunkId!],
      };
    });

  const persistedIds: number[] = [];
  for (const item of antiPatterns) {
    const [row] = await db.insert(antiPatternsTable).values({
      title: item.title,
      description: item.description,
      signalsJson: JSON.stringify(item.signals),
      domainTag: item.domainTag,
      riskLevel: item.riskLevel,
      sourceRefsJson: JSON.stringify([state.documentId]),
      status: "candidate",
    }).returning();
    if (row) persistedIds.push(row.id);
  }

  logger.info({ docId: state.documentId, count: antiPatterns.length }, "Anti-patterns extracted");
  return { extractedAntiPatterns: antiPatterns, persistedAntiPatternIds: persistedIds };
}


async function dedupeAndMergeNode(state: IngestionStateType): Promise<Partial<IngestionStateType>> {
  await setProgress(state.documentId, "deduplicating");
  const embedModel = createEmbeddings();

  async function dedupeById<T extends { id: number }>(
    table: "principles" | "rules" | "playbooks" | "anti_patterns",
    candidateIds: number[],
    embeddingTextFn: (row: T) => string,
    mergeUpdateFn: (existingId: number, existingRow: { id: number; source_refs_json: string }, candidateRow: T) => Promise<void>,
    fetchFn: (ids: number[]) => Promise<T[]>
  ) {
    if (candidateIds.length === 0) return;
    const candidates = await fetchFn(candidateIds);

    for (const candidate of candidates) {
      const embText = embeddingTextFn(candidate);
      const [embedding] = await withRetry(() => embedModel.embedDocuments([embText]), 2, `dedupe_embed_${table}`);
      const vec = `[${embedding.join(",")}]`;

      const existing = await pool.query<{
        id: number;
        source_refs_json: string;
        embedding_str: string;
      }>(
        `SELECT id, source_refs_json, (embedding_vector::text) as embedding_str
         FROM ${table}
         WHERE embedding_vector IS NOT NULL AND id != $1
         ORDER BY embedding_vector <=> $2::vector
         LIMIT 5`,
        [candidate.id, vec]
      );

      let merged = false;
      for (const row of existing.rows) {
        if (row.embedding_str) {
          const existVec = row.embedding_str.slice(1, -1).split(",").map(Number);
          if (cosineSimilarity(embedding, existVec) >= DEDUPE_SIMILARITY_THRESHOLD) {
            await mergeUpdateFn(row.id, row, candidate);
            await pool.query(`DELETE FROM ${table} WHERE id = $1`, [candidate.id]);
            merged = true;
            logger.info({ table, existingId: row.id, candidateId: candidate.id }, "Deduplicated — merged into existing");
            break;
          }
        }
      }

      if (!merged) {
        await pool.query(
          `UPDATE ${table} SET embedding_vector = $1::vector WHERE id = $2`,
          [vec, candidate.id]
        );
      }
    }
  }

  await dedupeById<{ id: number; title: string; statement: string; sourceRefsJson: string; confidenceScore: string }>(
    "principles",
    state.persistedPrincipleIds,
    (r) => `${r.title} ${r.statement}`,
    async (existId, existRow, candidate) => {
      const refs = [...new Set([...JSON.parse(existRow.source_refs_json || "[]"), ...JSON.parse(candidate.sourceRefsJson || "[]")])];
      const existingConf = await pool.query<{ confidence_score: string; source_count: number }>(
        "SELECT confidence_score, source_count FROM principles WHERE id = $1", [existId]
      );
      const existConf = parseFloat(existingConf.rows[0]?.confidence_score || "0");
      const existCount = existingConf.rows[0]?.source_count ?? 0;
      await db.update(principlesTable).set({
        sourceCount: existCount + 1,
        sourceRefsJson: JSON.stringify(refs),
        confidenceScore: String(Math.max(existConf, parseFloat(candidate.confidenceScore || "0"))),
      }).where(eq(principlesTable.id, existId));
    },
    async (ids) => {
      const rows = await db.select().from(principlesTable).where(inArray(principlesTable.id, ids));
      return rows.map((r) => ({ id: r.id, title: r.title ?? "", statement: r.statement ?? "", sourceRefsJson: r.sourceRefsJson ?? "[]", confidenceScore: r.confidenceScore ?? "0.7" }));
    }
  );

  await dedupeById<{ id: number; name: string; ifCondition: string; thenLogic: string; sourceRefsJson: string }>(
    "rules",
    state.persistedRuleIds,
    (r) => `${r.name} ${r.ifCondition} ${r.thenLogic}`,
    async (existId, existRow, candidate) => {
      const refs = [...new Set([...JSON.parse(existRow.source_refs_json || "[]"), ...JSON.parse(candidate.sourceRefsJson || "[]")])];
      await db.update(rulesTable).set({ sourceRefsJson: JSON.stringify(refs) }).where(eq(rulesTable.id, existId));
    },
    async (ids) => {
      const rows = await db.select().from(rulesTable).where(inArray(rulesTable.id, ids));
      return rows.map((r) => ({ id: r.id, name: r.name ?? "", ifCondition: r.ifCondition ?? "", thenLogic: r.thenLogic ?? "", sourceRefsJson: r.sourceRefsJson ?? "[]" }));
    }
  );

  await dedupeById<{ id: number; name: string; summary: string; sourceRefsJson: string }>(
    "playbooks",
    state.persistedPlaybookIds,
    (r) => `${r.name} ${r.summary}`,
    async (existId, existRow, candidate) => {
      const refs = [...new Set([...JSON.parse(existRow.source_refs_json || "[]"), ...JSON.parse(candidate.sourceRefsJson || "[]")])];
      await db.update(playbooksTable).set({ sourceRefsJson: JSON.stringify(refs) }).where(eq(playbooksTable.id, existId));
      await db.delete(playbookStepsTable).where(eq(playbookStepsTable.playbookId, candidate.id));
    },
    async (ids) => {
      const rows = await db.select().from(playbooksTable).where(inArray(playbooksTable.id, ids));
      return rows.map((r) => ({ id: r.id, name: r.name ?? "", summary: r.summary ?? "", sourceRefsJson: r.sourceRefsJson ?? "[]" }));
    }
  );

  await dedupeById<{ id: number; title: string; description: string; sourceRefsJson: string }>(
    "anti_patterns",
    state.persistedAntiPatternIds,
    (r) => `${r.title} ${r.description}`,
    async (existId, existRow, candidate) => {
      const refs = [...new Set([...JSON.parse(existRow.source_refs_json || "[]"), ...JSON.parse(candidate.sourceRefsJson || "[]")])];
      await db.update(antiPatternsTable).set({ sourceRefsJson: JSON.stringify(refs) }).where(eq(antiPatternsTable.id, existId));
    },
    async (ids) => {
      const rows = await db.select().from(antiPatternsTable).where(inArray(antiPatternsTable.id, ids));
      return rows.map((r) => ({ id: r.id, title: r.title ?? "", description: r.description ?? "", sourceRefsJson: r.sourceRefsJson ?? "[]" }));
    }
  );

  logger.info({ docId: state.documentId }, "Deduplication complete");
  return {};
}

async function persistOutputsNode(state: IngestionStateType): Promise<Partial<IngestionStateType>> {
  await db.update(documentsTable)
    .set({ rawTextStatus: "done", errorMessage: null })
    .where(eq(documentsTable.id, state.documentId));
  logger.info({ docId: state.documentId }, "Ingestion complete — status set to done");
  return { status: "done" };
}

const workflow = new StateGraph(IngestionState)
  .addNode("extract_text", extractTextNode)
  .addNode("chunk_document", chunkDocumentNode)
  .addNode("embed_chunks", embedChunksNode)
  .addNode("classify_chunks", classifyChunksNode)
  .addNode("extract_principles", extractPrinciplesNode)
  .addNode("extract_rules", extractRulesNode)
  .addNode("extract_playbooks", extractPlaybooksNode)
  .addNode("extract_anti_patterns", extractAntiPatternsNode)
  .addNode("dedupe_merge", dedupeAndMergeNode)
  .addNode("persist_outputs", persistOutputsNode)
  .addEdge(START, "extract_text")
  .addEdge("extract_text", "chunk_document")
  .addEdge("chunk_document", "embed_chunks")
  .addEdge("embed_chunks", "classify_chunks")
  .addEdge("classify_chunks", "extract_principles")
  .addEdge("extract_principles", "extract_rules")
  .addEdge("extract_rules", "extract_playbooks")
  .addEdge("extract_playbooks", "extract_anti_patterns")
  .addEdge("extract_anti_patterns", "dedupe_merge")
  .addEdge("dedupe_merge", "persist_outputs")
  .addEdge("persist_outputs", END);

const compiledGraph = workflow.compile();

export async function runIngestionGraph(documentId: number): Promise<void> {
  logger.info({ documentId }, "Starting ingestion graph");

  try {
    await compiledGraph.invoke({ documentId });
    await syncAfterIngestion(documentId);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err, documentId }, "Ingestion graph failed");
    try {
      await db.update(documentsTable)
        .set({ rawTextStatus: "error", errorMessage: errorMessage.slice(0, 1000) })
        .where(eq(documentsTable.id, documentId));
    } catch (dbErr) {
      logger.error({ dbErr }, "Failed to update document error status");
    }
  }
}
