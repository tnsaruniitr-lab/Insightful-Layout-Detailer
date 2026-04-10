import { pool } from "@workspace/db";
import { logger } from "./logger";
import { invokeSynthesisModel } from "./llm";
import type { SynthesisModelId } from "./llm";

export type ObjectType = "principle" | "rule" | "playbook" | "anti_pattern";

export interface ScoringCandidate {
  id: number;
  type: ObjectType;
  title: string;
  cosineDist: number;
  confidence: number;
  sourceRefsJson: string;
  isCanonical: boolean;
  embeddingVector: number[];
  data: Record<string, unknown>;
}

export interface ScoredCandidate extends ScoringCandidate {
  similarity: number;
  sourceWeight: number;
  authorityCorroboration: number;
  canonicalBoost: number;
  domainAffinityBoost: number;
  finalScore: number;
  distinctDocs: number;
}

export interface ScoredCandidateSummary {
  id: number;
  type: ObjectType;
  title: string;
  similarity: number;
  confidence: number;
  sourceWeight: number;
  authorityCorroboration: number;
  canonicalBoost: number;
  domainAffinityBoost: number;
  finalScore: number;
  distinctDocs: number;
  isCanonical: boolean;
}

export interface DedupRemoval {
  removed: ScoredCandidateSummary;
  collidedWithId: number;
  collidedWithType: ObjectType;
  collidedWithTitle: string;
  embeddingSimilarity: number;
}

export interface DiversityRemoval {
  removed: ScoredCandidateSummary;
  reason: string;
}

export interface ScoringTrace {
  queryLabel: string;
  totalCandidatesReceived: number;
  totalTraceCount: number;
  timings: {
    scoring_ms: number;
    dedup_ms: number;
    rerank_ms: number;
    diversity_ms: number;
    total_ms: number;
  };
  top20BeforeDedup: ScoredCandidateSummary[];
  removedByDedup: DedupRemoval[];
  dedupThreshold: number;
  dedupFallbackUsed: boolean;
  rerankApplied: boolean;
  rerankCandidateCount: number;
  removedByDiversity: DiversityRemoval[];
  diversityCapApplied: boolean;
  finalSelected: ScoredCandidateSummary[];
}

export interface ScoringResult {
  selected: ScoredCandidate[];
  trace: ScoringTrace;
}

const TIER_WEIGHTS: Record<string, number> = {
  high: 3.0,
  medium: 1.0,
  low: 0.33,
};
const AUTH_NORM = Math.log(1 + 10);

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 1;
  return 1 - dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function safeParseJson<T>(str: string, fallback: T): T {
  try { return JSON.parse(str) as T; } catch { return fallback; }
}

function toSummary(c: ScoredCandidate): ScoredCandidateSummary {
  return {
    id: c.id, type: c.type, title: c.title,
    similarity: +c.similarity.toFixed(4),
    confidence: +c.confidence.toFixed(4),
    sourceWeight: +c.sourceWeight.toFixed(4),
    authorityCorroboration: +c.authorityCorroboration.toFixed(4),
    canonicalBoost: +c.canonicalBoost.toFixed(4),
    domainAffinityBoost: +c.domainAffinityBoost.toFixed(4),
    finalScore: +c.finalScore.toFixed(4),
    distinctDocs: c.distinctDocs,
    isCanonical: c.isCanonical,
  };
}

export function parseEmbedding(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try { return JSON.parse(raw as string) as number[]; } catch { return []; }
}

export async function buildChunkToDocMap(_candidates: ScoringCandidate[]): Promise<Map<number, number>> {
  return new Map();
}

export async function buildAuthorityMap(docIds: number[]): Promise<Map<number, string>> {
  if (docIds.length === 0) return new Map();
  const unique = [...new Set(docIds)];
  const rows = await pool.query<{ id: number; trust_level: string }>(
    `SELECT id, trust_level FROM documents WHERE id = ANY($1)`,
    [unique]
  );
  const map = new Map<number, string>();
  for (const r of rows.rows) map.set(r.id, r.trust_level ?? "medium");
  return map;
}

function computeAuthorityCorroboration(docIds: number[], authorityMap: Map<number, string>): number {
  const uniqueIds = [...new Set(docIds)];
  const totalWeight = uniqueIds.reduce((sum, id) => {
    const trust = authorityMap.get(id) ?? "medium";
    return sum + (TIER_WEIGHTS[trust] ?? 1.0);
  }, 0);
  return Math.log(1 + totalWeight) / AUTH_NORM;
}

function scoreCandidates(
  candidates: ScoringCandidate[],
  authorityMap: Map<number, string>,
  domainHint?: string
): ScoredCandidate[] {
  return candidates.map((c) => {
    const similarity = Math.max(0, Math.min(1, 1 - c.cosineDist));
    const docIds = safeParseJson<number[]>(c.sourceRefsJson, []);
    const distinctDocs = Math.max(1, new Set(docIds).size);
    const sourceWeight = Math.log(1 + distinctDocs) / Math.log(1 + 5);
    const authorityCorroboration = computeAuthorityCorroboration(docIds, authorityMap);
    const canonicalBoost = c.isCanonical ? 1.0 : 0;
    const candidateDomain = (c.data as { domainTag?: string | null }).domainTag;
    const domainAffinityBoost = (domainHint && candidateDomain && candidateDomain === domainHint) ? 1.0 : 0;
    const finalScore =
      0.55 * similarity +
      0.20 * c.confidence +
      0.10 * sourceWeight +
      0.10 * authorityCorroboration +
      0.05 * canonicalBoost +
      0.05 * domainAffinityBoost;
    return { ...c, similarity, sourceWeight, authorityCorroboration, canonicalBoost, domainAffinityBoost, finalScore, distinctDocs };
  });
}

function deduplicateByEmbedding(
  candidates: ScoredCandidate[],
  threshold: number,
  isRetry: boolean
): { kept: ScoredCandidate[]; removed: DedupRemoval[]; fallbackUsed: boolean } {
  const kept: ScoredCandidate[] = [];
  const removed: DedupRemoval[] = [];

  for (const candidate of candidates) {
    if (candidate.embeddingVector.length === 0) { kept.push(candidate); continue; }
    let collision: { existing: ScoredCandidate; sim: number } | null = null;
    for (const existing of kept) {
      if (existing.embeddingVector.length === 0) continue;
      const sim = 1 - cosineDistance(candidate.embeddingVector, existing.embeddingVector);
      if (sim > threshold) { collision = { existing, sim }; break; }
    }
    if (collision) {
      removed.push({
        removed: toSummary(candidate),
        collidedWithId: collision.existing.id,
        collidedWithType: collision.existing.type,
        collidedWithTitle: collision.existing.title,
        embeddingSimilarity: +collision.sim.toFixed(4),
      });
    } else {
      kept.push(candidate);
    }
  }

  if (!isRetry && kept.length < Math.ceil(Math.min(candidates.length, 12) * 0.5)) {
    const fallback = deduplicateByEmbedding(candidates, 0.85, true);
    return { ...fallback, fallbackUsed: true };
  }

  return { kept, removed, fallbackUsed: false };
}

function applyDiversity(
  candidates: ScoredCandidate[],
  targetCount: number
): { selected: ScoredCandidate[]; removed: DiversityRemoval[]; capApplied: boolean } {
  if (candidates.length <= targetCount) {
    return { selected: candidates, removed: [], capApplied: false };
  }

  const typeCounts = candidates.slice(0, targetCount).reduce((acc, c) => {
    acc[c.type] = (acc[c.type] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const maxCount = Math.max(...Object.values(typeCounts));
  const dominant = maxCount / targetCount > 0.6;

  if (!dominant) {
    return { selected: candidates.slice(0, targetCount), removed: [], capApplied: false };
  }

  const caps: Record<string, number> = { rule: 5, principle: 4, playbook: 3, anti_pattern: 2 };
  const selected: ScoredCandidate[] = [];
  const removed: DiversityRemoval[] = [];
  const usedCounts: Record<string, number> = {};

  for (const c of candidates) {
    if (selected.length >= targetCount) {
      removed.push({ removed: toSummary(c), reason: `target count ${targetCount} reached` });
      continue;
    }
    const cap = caps[c.type] ?? targetCount;
    const used = usedCounts[c.type] ?? 0;
    if (used < cap) {
      selected.push(c);
      usedCounts[c.type] = used + 1;
    } else {
      removed.push({ removed: toSummary(c), reason: `${c.type} soft cap: ${used}/${cap} slots used` });
    }
  }

  return { selected, removed, capApplied: true };
}

export async function scoreAndSelect(params: {
  candidates: ScoringCandidate[];
  chunkToDocMap: Map<number, number>;
  frequencyMap?: Map<string, number>;
  totalTraceCount?: number;
  targetCount?: number;
  queryLabel?: string;
  domainHint?: string;
  reranker?: {
    enabled: boolean;
    question: string;
    brandContext?: string | null;
    model?: SynthesisModelId;
  };
}): Promise<ScoringResult> {
  const { candidates, targetCount = 12, queryLabel = "query" } = params;
  const totalStart = Date.now();

  const allDocIds = candidates.flatMap((c) => {
    try { return JSON.parse(c.sourceRefsJson) as number[]; } catch { return []; }
  });
  const authorityMap = await buildAuthorityMap(allDocIds);

  const scoreStart = Date.now();
  const scored = scoreCandidates(candidates, authorityMap, params.domainHint);
  scored.sort((a, b) => b.finalScore - a.finalScore);
  const scoring_ms = Date.now() - scoreStart;

  const top20BeforeDedup = scored.slice(0, 40).map(toSummary);

  const dedupStart = Date.now();
  const { kept: deduped, removed: removedByDedup, fallbackUsed: dedupFallbackUsed } =
    deduplicateByEmbedding(scored, 0.92, false);
  const dedup_ms = Date.now() - dedupStart;
  const dedupThreshold = dedupFallbackUsed ? 0.85 : 0.92;

  let rerankApplied = false;
  let rerankCandidateCount = 0;
  let rerankedDeduped = deduped;
  const rerankStart = Date.now();

  if (params.reranker?.enabled && deduped.length >= 8) {
    const sims = deduped.map((c) => c.similarity);
    const mean = sims.reduce((s, v) => s + v, 0) / sims.length;
    const variance = sims.reduce((s, v) => s + (v - mean) ** 2, 0) / sims.length;
    const stddev = Math.sqrt(variance);

    if (stddev > 0.08) {
      rerankCandidateCount = deduped.length;
      const candidateLines = deduped.map((c, i) => {
        const excerpt = (() => {
          const d = c.data as Record<string, unknown>;
          if (c.type === "principle") return String(d.statement ?? "").slice(0, 120);
          if (c.type === "rule") return `IF ${String(d.ifCondition ?? "").slice(0, 80)} THEN ${String(d.thenLogic ?? "").slice(0, 80)}`;
          if (c.type === "playbook") return String(d.summary ?? "").slice(0, 120);
          if (c.type === "anti_pattern") return String(d.description ?? "").slice(0, 120);
          return "";
        })();
        return `${i + 1}. [${c.type}:${c.id}] ${c.title} — ${excerpt}`;
      }).join("\n");

      const brandSection = params.reranker.brandContext ? `\nBrand context: ${params.reranker.brandContext}` : "";
      const systemPrompt = `You are a relevance re-ranker. Given a question and a list of knowledge objects, return a JSON array of composite keys (format: "type:id") sorted from MOST to LEAST relevant. Include every item. Respond ONLY with a valid JSON array, no markdown.`;
      const userPrompt = `Question: ${params.reranker.question}${brandSection}\n\nCandidates:\n${candidateLines}`;

      try {
        const model = params.reranker.model ?? "gpt-4o-mini";
        const raw = await invokeSynthesisModel(model, systemPrompt, userPrompt, 1);
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const ranked = JSON.parse(jsonMatch[0]) as string[];
          const rankIndex = new Map(ranked.map((key, i) => [key, i]));
          const sorted = [...deduped].sort((a, b) => {
            const ka = `${a.type}:${a.id}`;
            const kb = `${b.type}:${b.id}`;
            const ia = rankIndex.has(ka) ? rankIndex.get(ka)! : deduped.length;
            const ib = rankIndex.has(kb) ? rankIndex.get(kb)! : deduped.length;
            return ia - ib;
          });
          rerankedDeduped = sorted;
          rerankApplied = true;
          logger.info({ queryLabel, stddev: +stddev.toFixed(3), rerankCandidateCount }, "Re-ranker applied");
        }
      } catch (err) {
        logger.warn({ err, queryLabel }, "Re-ranker failed — falling back to score order");
      }
    } else {
      logger.debug({ queryLabel, stddev: +stddev.toFixed(3) }, "Re-ranker skipped: low variance");
    }
  }
  const rerank_ms = Date.now() - rerankStart;

  const diversityStart = Date.now();
  const { selected, removed: removedByDiversity, capApplied: diversityCapApplied } =
    applyDiversity(rerankedDeduped, targetCount);
  const diversity_ms = Date.now() - diversityStart;

  const total_ms = Date.now() - totalStart;

  const trace: ScoringTrace = {
    queryLabel,
    totalCandidatesReceived: candidates.length,
    totalTraceCount: params.totalTraceCount ?? 0,
    timings: { scoring_ms, dedup_ms, rerank_ms, diversity_ms, total_ms },
    top20BeforeDedup,
    removedByDedup,
    dedupThreshold,
    dedupFallbackUsed,
    rerankApplied,
    rerankCandidateCount,
    removedByDiversity,
    diversityCapApplied,
    finalSelected: selected.map(toSummary),
  };

  logger.info(
    {
      queryLabel,
      timings: trace.timings,
      totalCandidates: candidates.length,
      rerankApplied,
      dedup: {
        threshold: dedupThreshold,
        fallbackUsed: dedupFallbackUsed,
        removed: removedByDedup.map((r) => ({
          id: r.removed.id, title: r.removed.title.slice(0, 40),
          collidedWith: `[${r.collidedWithType}:${r.collidedWithId}] ${r.collidedWithTitle.slice(0, 40)}`,
          embeddingSim: r.embeddingSimilarity,
        })),
      },
      diversity: {
        capApplied: diversityCapApplied,
        removed: removedByDiversity.map((r) => ({ id: r.removed.id, title: r.removed.title.slice(0, 40), reason: r.reason })),
      },
      finalSelected: selected.map((c) => ({ id: c.id, type: c.type, title: c.title.slice(0, 50), finalScore: +c.finalScore.toFixed(3) })),
    },
    "Phase2 scoring trace"
  );

  return { selected, trace };
}
