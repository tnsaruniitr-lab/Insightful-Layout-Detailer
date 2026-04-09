/**
 * One-time backfill script — promotes existing brain objects to canonical status
 * if they meet the canonical promotion criteria:
 *   - source_count >= 3 OR json_array_length(source_refs_json) >= 3
 *   - confidence_score > 0.95
 *   - contested = false
 *   - status != 'canonical' (not already promoted)
 *
 * Run: npx tsx src/scripts/backfill-canonical.ts
 */
import { pool } from "@workspace/db";

const TABLES: Array<{ name: string; titleCol: string; sourceCountClause: string }> = [
  {
    name: "principles",
    titleCol: "title",
    sourceCountClause: "source_count >= 3 OR json_array_length(source_refs_json::json) >= 3",
  },
  {
    name: "rules",
    titleCol: "name",
    sourceCountClause: "json_array_length(source_refs_json::json) >= 3",
  },
  {
    name: "playbooks",
    titleCol: "name",
    sourceCountClause: "json_array_length(source_refs_json::json) >= 3",
  },
];

async function run() {
  console.log("Starting canonical backfill...");
  let totalPromoted = 0;

  for (const { name: table, titleCol, sourceCountClause } of TABLES) {
    const result = await pool.query<{ id: number; title: string }>(
      `UPDATE ${table}
       SET status = 'canonical'
       WHERE status != 'canonical'
         AND contested = false
         AND confidence_score::numeric > 0.95
         AND (${sourceCountClause})
       RETURNING id, ${titleCol} AS title`
    );

    const promoted = result.rowCount ?? 0;
    totalPromoted += promoted;
    console.log(`  ${table}: promoted ${promoted} object(s) to canonical`);
    if (result.rows.length > 0) {
      for (const row of result.rows) {
        console.log(`    ID ${row.id}: ${row.title}`);
      }
    }
  }

  console.log(`\nBackfill complete. Total promoted: ${totalPromoted}`);
  await pool.end();
}

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
