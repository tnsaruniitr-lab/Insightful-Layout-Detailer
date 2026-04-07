import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
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
import { eq } from "drizzle-orm";
import { createFastModel, createStrongModel, createEmbeddings } from "../lib/llm";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";

const DEDUPE_SIMILARITY_THRESHOLD = 0.92;
const CHUNK_TARGET_TOKENS = 400;
const CHUNK_OVERLAP_TOKENS = 50;
const EMBED_BATCH_SIZE = 100;

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
  } else {
    rawText = (fileBuffer as Buffer).toString("utf-8");
  }

  logger.info({ docId: state.documentId, chars: rawText.length }, "Text extracted");
  return { rawText };
}

async function chunkDocumentNode(state: IngestionStateType): Promise<Partial<IngestionStateType>> {
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
  const strongModel = createStrongModel();
  const domainGroups = new Map<DomainTag, ChunkRecord[]>();

  for (const chunk of state.chunks) {
    const tag = chunk.domainTag ?? "general";
    if (!domainGroups.has(tag)) domainGroups.set(tag, []);
    domainGroups.get(tag)!.push(chunk);
  }

  const principles: ExtractedPrinciple[] = [];

  for (const [domain, chunks] of domainGroups) {
    const contextText = chunks
      .slice(0, 15)
      .map((c) => `[chunk_id:${c.id}] ${c.chunkText.slice(0, 500)}`)
      .join("\n---\n");

    const response = await withRetry(() => strongModel.invoke([
      new SystemMessage(
        `You extract marketing intelligence principles from knowledge documents.
A principle is a universal truth about ${domain} marketing that should guide strategy.
Extract 1-5 principles from the provided content.
Respond with a JSON array: [{title, statement, explanation, confidence_score, source_chunk_ids}]
- title: short name (< 10 words)
- statement: the core principle in 1-2 sentences
- explanation: 2-4 sentence explanation with evidence
- confidence_score: 0.0 to 1.0
- source_chunk_ids: array of chunk IDs that support this principle
Respond ONLY with valid JSON array, no markdown.`
      ),
      new HumanMessage(`Domain: ${domain}\n\nContent:\n${contextText}`),
    ]), 2, "extract_principles");

    try {
      const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const extracted = JSON.parse(jsonMatch[0]) as Array<{
          title: string;
          statement: string;
          explanation: string;
          confidence_score: number;
          source_chunk_ids: number[];
        }>;
        for (const p of extracted) {
          if (p.title && p.statement) {
            principles.push({
              title: p.title,
              statement: p.statement,
              explanation: p.explanation ?? "",
              domainTag: domain,
              confidenceScore: Math.min(1, Math.max(0, p.confidence_score ?? 0.7)),
              sourceChunkIds: p.source_chunk_ids ?? [],
            });
          }
        }
      }
    } catch (err) {
      logger.warn({ err, domain }, "Failed to parse principles extraction");
    }
  }

  logger.info({ docId: state.documentId, count: principles.length }, "Principles extracted");
  return { extractedPrinciples: principles };
}

async function extractRulesNode(state: IngestionStateType): Promise<Partial<IngestionStateType>> {
  const strongModel = createStrongModel();
  const contextText = state.chunks
    .slice(0, 20)
    .map((c) => `[chunk_id:${c.id}] ${c.chunkText.slice(0, 400)}`)
    .join("\n---\n");

  const rules: ExtractedRule[] = [];

  const response = await withRetry(() => strongModel.invoke([
    new SystemMessage(
      `You extract diagnostic/scoring rules from marketing knowledge documents.
A rule has an IF condition and THEN action/implication.
Extract 1-5 rules from the content.
Respond with a JSON array: [{name, rule_type, if_condition, then_logic, domain_tag, confidence_score, source_chunk_ids}]
- rule_type: one of: diagnostic, mapping, scoring, warning
- domain_tag: one of: seo, geo, aeo, content, entity, general
- confidence_score: 0.0 to 1.0
- source_chunk_ids: array of chunk IDs
Respond ONLY with valid JSON array, no markdown.`
    ),
    new HumanMessage(`Content:\n${contextText}`),
  ]), 2, "extract_rules");

  try {
    const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const extracted = JSON.parse(jsonMatch[0]) as Array<{
        name: string;
        rule_type: string;
        if_condition: string;
        then_logic: string;
        domain_tag: string;
        confidence_score: number;
        source_chunk_ids: number[];
      }>;
      for (const r of extracted) {
        if (r.name && r.if_condition && r.then_logic) {
          const validTypes = ["diagnostic", "mapping", "scoring", "warning"];
          rules.push({
            name: r.name,
            ruleType: (validTypes.includes(r.rule_type) ? r.rule_type : "diagnostic") as "diagnostic" | "mapping" | "scoring" | "warning",
            ifCondition: r.if_condition,
            thenLogic: r.then_logic,
            domainTag: parseDomainTag(r.domain_tag),
            confidenceScore: Math.min(1, Math.max(0, r.confidence_score ?? 0.7)),
            sourceChunkIds: r.source_chunk_ids ?? [],
          });
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to parse rules extraction");
  }

  logger.info({ docId: state.documentId, count: rules.length }, "Rules extracted");
  return { extractedRules: rules };
}

async function extractPlaybooksNode(state: IngestionStateType): Promise<Partial<IngestionStateType>> {
  const strongModel = createStrongModel();
  const contextText = state.chunks
    .slice(0, 20)
    .map((c) => `[chunk_id:${c.id}] ${c.chunkText.slice(0, 400)}`)
    .join("\n---\n");

  const playbooks: ExtractedPlaybook[] = [];

  const response = await withRetry(() => strongModel.invoke([
    new SystemMessage(
      `You extract actionable marketing playbooks from knowledge documents.
A playbook is a repeatable procedure for achieving a marketing outcome.
Extract 0-3 playbooks from the content. Only extract if genuinely present.
Respond with a JSON array: [{name, summary, use_when, avoid_when, expected_outcomes, domain_tag, confidence_score, source_chunk_ids, steps}]
- steps: array of {title, description} — the ordered execution steps (2-8 steps)
- domain_tag: one of: seo, geo, aeo, content, entity, general
- confidence_score: 0.0 to 1.0
Respond ONLY with valid JSON array, no markdown.`
    ),
    new HumanMessage(`Content:\n${contextText}`),
  ]), 2, "extract_playbooks");

  try {
    const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
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
      for (const p of extracted) {
        if (p.name && p.summary) {
          playbooks.push({
            name: p.name,
            summary: p.summary,
            useWhen: p.use_when ?? "",
            avoidWhen: p.avoid_when ?? "",
            expectedOutcomes: p.expected_outcomes ?? "",
            domainTag: parseDomainTag(p.domain_tag),
            confidenceScore: Math.min(1, Math.max(0, p.confidence_score ?? 0.7)),
            sourceChunkIds: p.source_chunk_ids ?? [],
            steps: (p.steps ?? []).filter((s) => s.title),
          });
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to parse playbooks extraction");
  }

  logger.info({ docId: state.documentId, count: playbooks.length }, "Playbooks extracted");
  return { extractedPlaybooks: playbooks };
}

async function extractAntiPatternsNode(state: IngestionStateType): Promise<Partial<IngestionStateType>> {
  const strongModel = createStrongModel();
  const contextText = state.chunks
    .slice(0, 20)
    .map((c) => `[chunk_id:${c.id}] ${c.chunkText.slice(0, 400)}`)
    .join("\n---\n");

  const antiPatterns: ExtractedAntiPattern[] = [];

  const response = await withRetry(() => strongModel.invoke([
    new SystemMessage(
      `You extract anti-patterns from marketing knowledge documents.
An anti-pattern is a common mistake or harmful practice in marketing.
Extract 0-4 anti-patterns from the content. Only extract if genuinely present.
Respond with a JSON array: [{title, description, signals, domain_tag, risk_level, confidence_score, source_chunk_ids}]
- signals: array of observable signs that this anti-pattern is occurring
- risk_level: one of: high, medium, low
- domain_tag: one of: seo, geo, aeo, content, entity, general
- confidence_score: 0.0 to 1.0
Respond ONLY with valid JSON array, no markdown.`
    ),
    new HumanMessage(`Content:\n${contextText}`),
  ]), 2, "extract_anti_patterns");

  try {
    const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const extracted = JSON.parse(jsonMatch[0]) as Array<{
        title: string;
        description: string;
        signals: string[];
        domain_tag: string;
        risk_level: string;
        confidence_score: number;
        source_chunk_ids: number[];
      }>;
      for (const a of extracted) {
        if (a.title && a.description) {
          const validRisk = ["high", "medium", "low"];
          antiPatterns.push({
            title: a.title,
            description: a.description,
            signals: a.signals ?? [],
            domainTag: parseDomainTag(a.domain_tag),
            riskLevel: (validRisk.includes(a.risk_level) ? a.risk_level : "medium") as "high" | "medium" | "low",
            confidenceScore: Math.min(1, Math.max(0, a.confidence_score ?? 0.7)),
            sourceChunkIds: a.source_chunk_ids ?? [],
          });
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to parse anti-patterns extraction");
  }

  logger.info({ docId: state.documentId, count: antiPatterns.length }, "Anti-patterns extracted");
  return { extractedAntiPatterns: antiPatterns };
}


async function dedupeAndMergeNode(state: IngestionStateType): Promise<Partial<IngestionStateType>> {
  const embedModel = createEmbeddings();

  async function dedupePrinciples(items: ExtractedPrinciple[]) {
    for (const item of items) {
      const embeddingText = `${item.title} ${item.statement}`;
      const [embedding] = await withRetry(() => embedModel.embedDocuments([embeddingText]), 2, "dedupe_embed_principle");
      const vec = `[${embedding.join(",")}]`;

      const existing = await pool.query<{
        id: number;
        title: string;
        source_count: number;
        source_refs_json: string;
        confidence_score: string;
        embedding_str: string;
      }>(
        `SELECT id, title, source_count, source_refs_json, confidence_score,
         (embedding_vector::text) as embedding_str
         FROM principles
         WHERE embedding_vector IS NOT NULL
         ORDER BY embedding_vector <=> $1::vector
         LIMIT 5`,
        [vec]
      );

      let merged = false;
      for (const row of existing.rows) {
        if (row.embedding_str) {
          const existVec = row.embedding_str.slice(1, -1).split(",").map(Number);
          const sim = cosineSimilarity(embedding, existVec);
          if (sim >= DEDUPE_SIMILARITY_THRESHOLD) {
            const existingRefs: unknown[] = JSON.parse(row.source_refs_json || "[]");
            const newRefs = [...existingRefs, ...item.sourceChunkIds];
            const newConf = Math.max(parseFloat(row.confidence_score || "0"), item.confidenceScore);
            await db.update(principlesTable).set({
              sourceCount: row.source_count + 1,
              sourceRefsJson: JSON.stringify(newRefs),
              confidenceScore: String(newConf),
            }).where(eq(principlesTable.id, row.id));
            merged = true;
            logger.info({ id: row.id, sim }, "Principle deduplicated (merged)");
            break;
          }
        }
      }

      if (!merged) {
        const [inserted] = await db.insert(principlesTable).values({
          title: item.title,
          statement: item.statement,
          explanation: item.explanation,
          domainTag: item.domainTag,
          confidenceScore: String(item.confidenceScore),
          sourceCount: 1,
          sourceRefsJson: JSON.stringify(item.sourceChunkIds),
          status: "candidate",
        }).returning();
        if (inserted && embedding) {
          await pool.query(
            "UPDATE principles SET embedding_vector = $1::vector WHERE id = $2",
            [vec, inserted.id]
          );
        }
      }
    }
  }

  async function dedupeRules(items: ExtractedRule[]) {
    for (const item of items) {
      const embeddingText = `${item.name} ${item.ifCondition} ${item.thenLogic}`;
      const [embedding] = await withRetry(() => embedModel.embedDocuments([embeddingText]), 2, "dedupe_embed_rule");
      const vec = `[${embedding.join(",")}]`;

      const existing = await pool.query<{
        id: number;
        source_refs_json: string;
        embedding_str: string;
      }>(
        `SELECT id, source_refs_json, (embedding_vector::text) as embedding_str
         FROM rules WHERE embedding_vector IS NOT NULL
         ORDER BY embedding_vector <=> $1::vector LIMIT 5`,
        [vec]
      );

      let merged = false;
      for (const row of existing.rows) {
        if (row.embedding_str) {
          const existVec = row.embedding_str.slice(1, -1).split(",").map(Number);
          if (cosineSimilarity(embedding, existVec) >= DEDUPE_SIMILARITY_THRESHOLD) {
            const existingRefs: unknown[] = JSON.parse(row.source_refs_json || "[]");
            await db.update(rulesTable).set({
              sourceRefsJson: JSON.stringify([...existingRefs, ...item.sourceChunkIds]),
            }).where(eq(rulesTable.id, row.id));
            merged = true;
            break;
          }
        }
      }

      if (!merged) {
        const [inserted] = await db.insert(rulesTable).values({
          name: item.name,
          ruleType: item.ruleType,
          ifCondition: item.ifCondition,
          thenLogic: item.thenLogic,
          domainTag: item.domainTag,
          confidenceScore: String(item.confidenceScore),
          sourceRefsJson: JSON.stringify(item.sourceChunkIds),
          status: "candidate",
        }).returning();
        if (inserted && embedding) {
          await pool.query(
            "UPDATE rules SET embedding_vector = $1::vector WHERE id = $2",
            [vec, inserted.id]
          );
        }
      }
    }
  }

  async function dedupePlaybooks(items: ExtractedPlaybook[]) {
    for (const item of items) {
      const embeddingText = `${item.name} ${item.summary}`;
      const [embedding] = await withRetry(() => embedModel.embedDocuments([embeddingText]), 2, "dedupe_embed_playbook");
      const vec = `[${embedding.join(",")}]`;

      const existing = await pool.query<{
        id: number;
        source_refs_json: string;
        embedding_str: string;
      }>(
        `SELECT id, source_refs_json, (embedding_vector::text) as embedding_str
         FROM playbooks WHERE embedding_vector IS NOT NULL
         ORDER BY embedding_vector <=> $1::vector LIMIT 5`,
        [vec]
      );

      let merged = false;
      for (const row of existing.rows) {
        if (row.embedding_str) {
          const existVec = row.embedding_str.slice(1, -1).split(",").map(Number);
          if (cosineSimilarity(embedding, existVec) >= DEDUPE_SIMILARITY_THRESHOLD) {
            const existingRefs: unknown[] = JSON.parse(row.source_refs_json || "[]");
            await db.update(playbooksTable).set({
              sourceRefsJson: JSON.stringify([...existingRefs, ...item.sourceChunkIds]),
            }).where(eq(playbooksTable.id, row.id));
            merged = true;
            break;
          }
        }
      }

      if (!merged) {
        const [inserted] = await db.insert(playbooksTable).values({
          name: item.name,
          summary: item.summary,
          useWhen: item.useWhen,
          avoidWhen: item.avoidWhen,
          expectedOutcomes: item.expectedOutcomes,
          domainTag: item.domainTag,
          confidenceScore: String(item.confidenceScore),
          sourceRefsJson: JSON.stringify(item.sourceChunkIds),
          status: "candidate",
        }).returning();
        if (inserted) {
          if (embedding) {
            await pool.query(
              "UPDATE playbooks SET embedding_vector = $1::vector WHERE id = $2",
              [vec, inserted.id]
            );
          }
          for (let i = 0; i < item.steps.length; i++) {
            await db.insert(playbookStepsTable).values({
              playbookId: inserted.id,
              stepOrder: i + 1,
              stepTitle: item.steps[i].title,
              stepDescription: item.steps[i].description,
            });
          }
        }
      }
    }
  }

  async function dedupeAntiPatterns(items: ExtractedAntiPattern[]) {
    for (const item of items) {
      const embeddingText = `${item.title} ${item.description}`;
      const [embedding] = await withRetry(() => embedModel.embedDocuments([embeddingText]), 2, "dedupe_embed_ap");
      const vec = `[${embedding.join(",")}]`;

      const existing = await pool.query<{
        id: number;
        source_refs_json: string;
        embedding_str: string;
      }>(
        `SELECT id, source_refs_json, (embedding_vector::text) as embedding_str
         FROM anti_patterns WHERE embedding_vector IS NOT NULL
         ORDER BY embedding_vector <=> $1::vector LIMIT 5`,
        [vec]
      );

      let merged = false;
      for (const row of existing.rows) {
        if (row.embedding_str) {
          const existVec = row.embedding_str.slice(1, -1).split(",").map(Number);
          if (cosineSimilarity(embedding, existVec) >= DEDUPE_SIMILARITY_THRESHOLD) {
            const existingRefs: unknown[] = JSON.parse(row.source_refs_json || "[]");
            await db.update(antiPatternsTable).set({
              sourceRefsJson: JSON.stringify([...existingRefs, ...item.sourceChunkIds]),
            }).where(eq(antiPatternsTable.id, row.id));
            merged = true;
            break;
          }
        }
      }

      if (!merged) {
        const [inserted] = await db.insert(antiPatternsTable).values({
          title: item.title,
          description: item.description,
          signalsJson: JSON.stringify(item.signals),
          domainTag: item.domainTag,
          riskLevel: item.riskLevel,
          sourceRefsJson: JSON.stringify(item.sourceChunkIds),
          status: "candidate",
        }).returning();
        if (inserted && embedding) {
          await pool.query(
            "UPDATE anti_patterns SET embedding_vector = $1::vector WHERE id = $2",
            [vec, inserted.id]
          );
        }
      }
    }
  }

  await dedupePrinciples(state.extractedPrinciples);
  await dedupeRules(state.extractedRules);
  await dedupePlaybooks(state.extractedPlaybooks);
  await dedupeAntiPatterns(state.extractedAntiPatterns);

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
