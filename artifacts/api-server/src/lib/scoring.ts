import { pool } from "@workspace/db";
import { logger } from "./logger";

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
  frequencyBonus: number;
  canonicalBoost: number;
  finalScore: number;
  distinctDocs: number;
  frequencyCount: number;
}

export interface ScoredCandidateSummary {
  id: number;
  type: ObjectType;
  title: string;
  similarity: number;
  confidence: number;
  sourceWeight: number;
  frequencyBonus: number;
  canonicalBoost: number;
  finalScore: number;
  distinctDocs: number;
  frequencyCount: number;
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
  frequencyGuardActive: boolean;
  totalTraceCount: number;
  timings: {
    scoring_ms: number;
    dedup_ms: number;
    diversity_ms: number;
    total_ms: number;
  };
  top20BeforeDedup: ScoredCandidateSummary[];
  removedByDedup: DedupRemoval[];
  dedupThreshold: number;
  dedupFallbackUsed: boolean;
  removedByDiversity: DiversityRemoval[];
  diversityCapApplied: boolean;
  finalSelected: ScoredCandidateSummary[];
}

export interface ScoringResult {
  selected: ScoredCandidate[];
  trace: ScoringTrace;
}

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
    frequencyBonus: +c.frequencyBonus.toFixed(4),
    canonicalBoost: +c.canonicalBoost.toFixed(4),
    finalScore: +c.finalScore.toFixed(4),
    distinctDocs: c.distinctDocs,
    frequencyCount: c.frequencyCount,
    isCanonical: c.isCanonical,
  };
}

export function parseEmbedding(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try { return JSON.parse(raw as string) as number[]; } catch { return []; }
}

// sourceRefsJson now stores document IDs directly — no chunk lookup needed.
// This function is kept for interface compatibility but returns an empty map.
export async function buildChunkToDocMap(_candidates: ScoringCandidate[]): Promise<Map<number, number>> {
  return new Map();
}

export async function buildFrequencyMap(): Promise<{ map: Map<string, number>; totalTraceCount: number }> {
  const countRow = await pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM query_traces");
  const totalTraceCount = parseInt(countRow.rows[0]?.count ?? "0", 10);
  if (totalTraceCount < 20) return { map: new Map(), totalTraceCount };
  const freqRows = await pool.query<{ object_id: number; object_type: string; freq: string }>(
    `SELECT (elem->>'id')::integer AS object_id, elem->>'type' AS object_type, COUNT(*) AS freq
     FROM query_traces, jsonb_array_elements(retrieved_objects_json::jsonb) elem
     WHERE created_at > NOW() - INTERVAL '30 days'
     GROUP BY 1, 2`
  );
  const map = new Map<string, number>();
  for (const r of freqRows.rows) map.set(`${r.object_type}:${r.object_id}`, parseInt(r.freq, 10));
  return { map, totalTraceCount };
}

function scoreCandidates(
  candidates: ScoringCandidate[],
  _chunkToDocMap: Map<number, number>,
  frequencyMap: Map<string, number>,
  totalTraceCount: number
): ScoredCandidate[] {
  return candidates.map((c) => {
    const similarity = Math.max(0, Math.min(1, 1 - c.cosineDist));
    // sourceRefsJson stores document IDs directly — count them without a chunk lookup
    const docIds = safeParseJson<number[]>(c.sourceRefsJson, []);
    const distinctDocs = Math.max(1, new Set(docIds).size);
    const sourceWeight = Math.log(1 + distinctDocs) / Math.log(1 + 5);
    const frequencyCount = frequencyMap.get(`${c.type}:${c.id}`) ?? 0;
    const frequencyBonus = totalTraceCount >= 20
      ? Math.min(0.1, Math.log(1 + frequencyCount) * 0.03)
      : 0;
    const canonicalBoost = c.isCanonical ? 0.05 : 0;
    const finalScore =
      0.6 * similarity + 0.2 * c.confidence + 0.1 * sourceWeight +
      0.05 * frequencyBonus + 0.05 * canonicalBoost;
    return { ...c, similarity, sourceWeight, frequencyBonus, canonicalBoost, finalScore, distinctDocs, frequencyCount };
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

  // Fallback: relax threshold if >50% removed
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

export function scoreAndSelect(params: {
  candidates: ScoringCandidate[];
  chunkToDocMap: Map<number, number>;
  frequencyMap: Map<string, number>;
  totalTraceCount: number;
  targetCount?: number;
  queryLabel?: string;
}): ScoringResult {
  const { candidates, chunkToDocMap, frequencyMap, totalTraceCount, targetCount = 12, queryLabel = "query" } = params;
  const totalStart = Date.now();

  // Step 1 — Score
  const scoreStart = Date.now();
  const scored = scoreCandidates(candidates, chunkToDocMap, frequencyMap, totalTraceCount);
  scored.sort((a, b) => b.finalScore - a.finalScore);
  const scoring_ms = Date.now() - scoreStart;

  const top20BeforeDedup = scored.slice(0, 20).map(toSummary);

  // Step 2 — Dedup
  const dedupStart = Date.now();
  const { kept: deduped, removed: removedByDedup, fallbackUsed: dedupFallbackUsed } =
    deduplicateByEmbedding(scored, 0.88, false);
  const dedup_ms = Date.now() - dedupStart;
  const dedupThreshold = dedupFallbackUsed ? 0.85 : 0.88;

  // Step 3 — Diversity
  const diversityStart = Date.now();
  const { selected, removed: removedByDiversity, capApplied: diversityCapApplied } =
    applyDiversity(deduped, targetCount);
  const diversity_ms = Date.now() - diversityStart;

  const total_ms = Date.now() - totalStart;

  const trace: ScoringTrace = {
    queryLabel,
    totalCandidatesReceived: candidates.length,
    frequencyGuardActive: totalTraceCount < 20,
    totalTraceCount,
    timings: { scoring_ms, dedup_ms, diversity_ms, total_ms },
    top20BeforeDedup,
    removedByDedup,
    dedupThreshold,
    dedupFallbackUsed,
    removedByDiversity,
    diversityCapApplied,
    finalSelected: selected.map(toSummary),
  };

  logger.info(
    {
      queryLabel,
      timings: trace.timings,
      totalCandidates: candidates.length,
      top20: top20BeforeDedup.map((c) => ({
        id: c.id, type: c.type, title: c.title.slice(0, 50),
        similarity: c.similarity, confidence: c.confidence,
        sourceWeight: c.sourceWeight, frequencyBonus: c.frequencyBonus,
        canonicalBoost: c.canonicalBoost, finalScore: c.finalScore,
      })),
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
