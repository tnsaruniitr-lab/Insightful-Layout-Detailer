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

export function parseEmbedding(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try { return JSON.parse(raw as string) as number[]; } catch { return []; }
}

export async function buildChunkToDocMap(candidates: ScoringCandidate[]): Promise<Map<number, number>> {
  const allChunkIds = new Set<number>();
  for (const c of candidates) {
    const ids = safeParseJson<number[]>(c.sourceRefsJson, []);
    for (const id of ids) { if (typeof id === "number") allChunkIds.add(id); }
  }
  if (allChunkIds.size === 0) return new Map();
  const rows = await pool.query<{ id: number; document_id: number }>(
    "SELECT id, document_id FROM document_chunks WHERE id = ANY($1)",
    [Array.from(allChunkIds)]
  );
  const map = new Map<number, number>();
  for (const r of rows.rows) map.set(r.id, r.document_id);
  return map;
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
  for (const r of freqRows.rows) {
    map.set(`${r.object_type}:${r.object_id}`, parseInt(r.freq, 10));
  }
  return { map, totalTraceCount };
}

function scoreCandidates(
  candidates: ScoringCandidate[],
  chunkToDocMap: Map<number, number>,
  frequencyMap: Map<string, number>,
  totalTraceCount: number
): ScoredCandidate[] {
  return candidates.map((c) => {
    const similarity = Math.max(0, Math.min(1, 1 - c.cosineDist));

    const chunkIds = safeParseJson<number[]>(c.sourceRefsJson, []);
    const distinctDocIds = new Set(
      chunkIds.map((id) => chunkToDocMap.get(id)).filter((id): id is number => id !== undefined)
    );
    const distinctDocs = Math.max(1, distinctDocIds.size);
    const sourceWeight = Math.log(1 + distinctDocs) / Math.log(1 + 5);

    const frequencyCount = frequencyMap.get(`${c.type}:${c.id}`) ?? 0;
    const frequencyBonus = totalTraceCount >= 20
      ? Math.min(0.1, Math.log(1 + frequencyCount) * 0.03)
      : 0;

    const canonicalBoost = c.isCanonical ? 0.05 : 0;

    const finalScore =
      0.6 * similarity +
      0.2 * c.confidence +
      0.1 * sourceWeight +
      0.05 * frequencyBonus +
      0.05 * canonicalBoost;

    return { ...c, similarity, sourceWeight, frequencyBonus, canonicalBoost, finalScore, distinctDocs, frequencyCount };
  });
}

function deduplicateByEmbedding(candidates: ScoredCandidate[], threshold: number, isRetry = false): ScoredCandidate[] {
  const selected: ScoredCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.embeddingVector.length === 0) { selected.push(candidate); continue; }
    let tooSimilar = false;
    for (const existing of selected) {
      if (existing.embeddingVector.length === 0) continue;
      const sim = 1 - cosineDistance(candidate.embeddingVector, existing.embeddingVector);
      if (sim > threshold) { tooSimilar = true; break; }
    }
    if (!tooSimilar) selected.push(candidate);
  }
  if (!isRetry && selected.length < Math.ceil(Math.min(candidates.length, 12) * 0.5)) {
    return deduplicateByEmbedding(candidates, 0.85, true);
  }
  return selected;
}

function applyDiversity(candidates: ScoredCandidate[], targetCount: number): ScoredCandidate[] {
  if (candidates.length <= targetCount) return candidates;
  const typeCounts = candidates.slice(0, targetCount).reduce((acc, c) => {
    acc[c.type] = (acc[c.type] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const maxCount = Math.max(...Object.values(typeCounts));
  const dominant = maxCount / targetCount > 0.6;
  if (!dominant) return candidates.slice(0, targetCount);
  const caps: Record<string, number> = { rule: 5, principle: 4, playbook: 3, anti_pattern: 2 };
  const selected: ScoredCandidate[] = [];
  const usedCounts: Record<string, number> = {};
  for (const c of candidates) {
    const cap = caps[c.type] ?? targetCount;
    const used = usedCounts[c.type] ?? 0;
    if (used < cap) { selected.push(c); usedCounts[c.type] = used + 1; }
    if (selected.length >= targetCount) break;
  }
  return selected;
}

export function scoreAndSelect(params: {
  candidates: ScoringCandidate[];
  chunkToDocMap: Map<number, number>;
  frequencyMap: Map<string, number>;
  totalTraceCount: number;
  targetCount?: number;
  queryLabel?: string;
}): ScoredCandidate[] {
  const { candidates, chunkToDocMap, frequencyMap, totalTraceCount, targetCount = 12, queryLabel = "query" } = params;

  const scored = scoreCandidates(candidates, chunkToDocMap, frequencyMap, totalTraceCount);
  scored.sort((a, b) => b.finalScore - a.finalScore);

  logger.info(
    {
      queryLabel,
      totalCandidates: scored.length,
      topScores: scored.slice(0, 20).map((c) => ({
        id: c.id, type: c.type, title: c.title.slice(0, 50),
        similarity: +c.similarity.toFixed(3),
        confidence: +c.confidence.toFixed(3),
        sourceWeight: +c.sourceWeight.toFixed(3),
        frequencyBonus: +c.frequencyBonus.toFixed(3),
        canonicalBoost: +c.canonicalBoost.toFixed(3),
        finalScore: +c.finalScore.toFixed(3),
      })),
    },
    "Phase2 candidate scores"
  );

  const deduped = deduplicateByEmbedding(scored, 0.88);
  const result = applyDiversity(deduped, targetCount);

  logger.info(
    {
      queryLabel,
      selectedCount: result.length,
      selected: result.map((c) => ({ id: c.id, type: c.type, title: c.title.slice(0, 50), finalScore: +c.finalScore.toFixed(3) })),
    },
    "Phase2 selected objects"
  );

  return result;
}
