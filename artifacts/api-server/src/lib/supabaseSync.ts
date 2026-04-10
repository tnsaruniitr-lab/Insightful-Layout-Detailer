import { pool } from "@workspace/db";
import { logger } from "./logger";

const SUPABASE_URL = "https://aldraxqsqeywluohskhs.supabase.co";

const BRAIN_TABLES = ["documents", "principles", "rules", "playbooks", "anti_patterns", "examples", "brands"] as const;
type BrainTable = typeof BRAIN_TABLES[number];

function getKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_KEY;
}

async function upsert(table: string, records: Record<string, unknown>[]): Promise<void> {
  const key = getKey();
  if (!key || records.length === 0) return;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(records),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase upsert to ${table} failed: ${res.status} ${body}`);
  }
}

export async function deleteFromSupabase(table: string, ids: number[]): Promise<void> {
  const key = getKey();
  if (!key || ids.length === 0) return;

  const filter = `id=in.(${ids.join(",")})`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=minimal",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase delete from ${table} failed: ${res.status} ${body}`);
  }
}

async function fetchSupabaseIds(table: BrainTable): Promise<number[]> {
  const key = getKey();
  if (!key) return [];

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) return [];
  const rows = await res.json() as { id: number }[];
  return rows.map((r) => r.id);
}

async function purgeOrphansFromSupabase(table: BrainTable, localIds: Set<number>): Promise<number> {
  const remoteIds = await fetchSupabaseIds(table);
  const orphans = remoteIds.filter((id) => !localIds.has(id));
  if (orphans.length > 0) await deleteFromSupabase(table, orphans);
  return orphans.length;
}

export async function fullSyncToSupabase(): Promise<{ synced: Record<string, number>; skipped: string }> {
  const key = getKey();
  if (!key) return { synced: {}, skipped: "SUPABASE_SERVICE_KEY not set" };

  const [documents, principles, rules, playbooks, antiPatterns, examples, brands] = await Promise.all([
    pool.query(`SELECT id, brand_id, title, source_type, domain_tag, author, source_url,
                storage_path, raw_text_status, error_message, trust_level, source_org,
                authority_tier, classifier_confidence, created_at FROM documents`),
    pool.query(`SELECT id, title, statement, explanation, domain_tag, confidence_score,
                source_count, source_refs_json, source_org, status, contested,
                conflict_pair_id, created_at, updated_at FROM principles`),
    pool.query(`SELECT id, name, rule_type, if_condition, then_logic, domain_tag,
                confidence_score, source_refs_json, source_org, status, contested,
                conflict_pair_id, created_at FROM rules`),
    pool.query(`SELECT id, name, summary, use_when, avoid_when, expected_outcomes,
                domain_tag, confidence_score, source_refs_json, source_org, status,
                contested, conflict_pair_id, created_at, updated_at FROM playbooks`),
    pool.query(`SELECT id, title, description, signals_json, domain_tag, risk_level,
                source_refs_json, source_org, status, contested, conflict_pair_id,
                created_at FROM anti_patterns`),
    pool.query(`SELECT id, title, description, domain_tag, source_refs_json, created_at FROM examples`),
    pool.query(`SELECT id, name, icp_description, positioning_statement, target_geographies_json, product_truths_json, tone_descriptors_json, created_at FROM brands`),
  ]);

  await Promise.all([
    upsert("documents", documents.rows),
    upsert("principles", principles.rows),
    upsert("rules", rules.rows),
    upsert("playbooks", playbooks.rows),
    upsert("anti_patterns", antiPatterns.rows),
    upsert("examples", examples.rows),
    upsert("brands", brands.rows),
  ]);

  const toSet = (rows: { id: number }[]) => new Set(rows.map((r) => r.id));
  const [dp, pp, rp, plp, ap, ep, bp] = await Promise.all([
    purgeOrphansFromSupabase("documents", toSet(documents.rows)),
    purgeOrphansFromSupabase("principles", toSet(principles.rows)),
    purgeOrphansFromSupabase("rules", toSet(rules.rows)),
    purgeOrphansFromSupabase("playbooks", toSet(playbooks.rows)),
    purgeOrphansFromSupabase("anti_patterns", toSet(antiPatterns.rows)),
    purgeOrphansFromSupabase("examples", toSet(examples.rows)),
    purgeOrphansFromSupabase("brands", toSet(brands.rows)),
  ]);

  logger.info({ purged: { documents: dp, principles: pp, rules: rp, playbooks: plp, anti_patterns: ap, examples: ep, brands: bp } }, "Supabase orphan purge complete");

  return {
    synced: {
      documents: documents.rowCount ?? 0,
      principles: principles.rowCount ?? 0,
      rules: rules.rowCount ?? 0,
      playbooks: playbooks.rowCount ?? 0,
      anti_patterns: antiPatterns.rowCount ?? 0,
      examples: examples.rowCount ?? 0,
      brands: brands.rowCount ?? 0,
    },
    skipped: "",
  };
}

export async function syncAfterIngestion(documentId: number): Promise<void> {
  const key = getKey();
  if (!key) return;

  try {
    const result = await fullSyncToSupabase();
    logger.info({ documentId, synced: result.synced }, "Supabase sync complete after ingestion");
  } catch (err) {
    logger.error({ err, documentId }, "Supabase sync failed after ingestion — data still saved locally");
  }
}
