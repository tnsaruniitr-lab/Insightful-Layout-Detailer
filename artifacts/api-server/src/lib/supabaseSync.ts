import { pool } from "@workspace/db";
import { logger } from "./logger";

const SUPABASE_URL = "https://aldraxqsqeywluohskhs.supabase.co";

async function upsert(table: string, records: Record<string, unknown>[]): Promise<void> {
  const key = process.env.SUPABASE_SERVICE_KEY;
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

export async function fullSyncToSupabase(): Promise<{ synced: Record<string, number>; skipped: string }> {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) return { synced: {}, skipped: "SUPABASE_SERVICE_KEY not set" };

  const [documents, principles, rules, playbooks, antiPatterns, examples, brands] = await Promise.all([
    pool.query(`SELECT id, title, domain_tag, trust_level, source_type,
                raw_text_status, error_message, created_at FROM documents`),
    pool.query(`SELECT id, title, statement, explanation, domain_tag, confidence_score,
                source_count, source_refs_json, status, created_at, updated_at FROM principles`),
    pool.query(`SELECT id, name, rule_type, if_condition, then_logic, domain_tag,
                confidence_score, source_refs_json, status, created_at FROM rules`),
    pool.query(`SELECT id, name, summary, use_when, avoid_when, expected_outcomes,
                domain_tag, confidence_score, source_refs_json, status, created_at, updated_at FROM playbooks`),
    pool.query(`SELECT id, title, description, signals_json, domain_tag, risk_level,
                source_refs_json, status, created_at FROM anti_patterns`),
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
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) return;

  try {
    const result = await fullSyncToSupabase();
    logger.info({ documentId, synced: result.synced }, "Supabase sync complete after ingestion");
  } catch (err) {
    logger.error({ err, documentId }, "Supabase sync failed after ingestion — data still saved locally");
  }
}
