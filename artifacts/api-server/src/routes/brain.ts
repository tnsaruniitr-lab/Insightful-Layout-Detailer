import { Router, type IRouter, type Request, type Response } from "express";
import { fullSyncToSupabase } from "../lib/supabaseSync";
import { eq, and, desc, inArray, count, type SQL } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  principlesTable,
  rulesTable,
  antiPatternsTable,
  playbooksTable,
  playbookStepsTable,
  examplesTable,
  mappingRunsTable,
  documentsTable,
  queryTracesTable,
} from "@workspace/db";
import {
  ListPrinciplesQueryParams,
  ListRulesQueryParams,
  ListPlaybooksQueryParams,
  GetPlaybookParams,
  ListAntiPatternsQueryParams,
  ListExamplesQueryParams,
  AskBrainBody,
  MapBrandBody,
  GetBrandStrategyBody,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { randomUUID } from "crypto";
import { z } from "zod/v4";
import { ObjectStorageService } from "../lib/objectStorage";
import { classifySourceAuthority, tierToTrustLevel } from "../lib/sourceClassifier";

type DomainTag = "seo" | "geo" | "aeo" | "content" | "entity" | "general";
type BrainStatus = "canonical" | "candidate";

const router = Router();

router.get("/principles", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListPrinciplesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 200);
  const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;
  const filters: SQL[] = [];
  if (parsed.data.status) {
    filters.push(eq(principlesTable.status, parsed.data.status as BrainStatus));
  }
  if (parsed.data.domain_tag) {
    filters.push(eq(principlesTable.domainTag, parsed.data.domain_tag as DomainTag));
  }
  const whereClause = filters.length ? and(...filters) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(principlesTable).where(whereClause);
  const rows = await db
    .select()
    .from(principlesTable)
    .where(whereClause)
    .limit(limit)
    .offset(offset);
  res.setHeader("X-Total-Count", String(total));
  res.json(rows);
});

router.get("/rules", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListRulesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 200);
  const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;
  const filters: SQL[] = [];
  if (parsed.data.status) {
    filters.push(eq(rulesTable.status, parsed.data.status as BrainStatus));
  }
  if (parsed.data.domain_tag) {
    filters.push(eq(rulesTable.domainTag, parsed.data.domain_tag as DomainTag));
  }
  const whereClause = filters.length ? and(...filters) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(rulesTable).where(whereClause);
  const rows = await db
    .select()
    .from(rulesTable)
    .where(whereClause)
    .limit(limit)
    .offset(offset);
  res.setHeader("X-Total-Count", String(total));
  res.json(rows);
});

router.get("/playbooks", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListPlaybooksQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 200);
  const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;
  const filters: SQL[] = [];
  if (parsed.data.status) {
    filters.push(eq(playbooksTable.status, parsed.data.status as BrainStatus));
  }
  if (parsed.data.domain_tag) {
    filters.push(eq(playbooksTable.domainTag, parsed.data.domain_tag as DomainTag));
  }
  const whereClause = filters.length ? and(...filters) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(playbooksTable).where(whereClause);
  const rows = await db
    .select()
    .from(playbooksTable)
    .where(whereClause)
    .limit(limit)
    .offset(offset);
  res.setHeader("X-Total-Count", String(total));
  res.json(rows);
});

router.get("/playbooks/:id", async (req: Request, res: Response): Promise<void> => {
  const parsed = GetPlaybookParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid playbook id" });
    return;
  }
  const [playbook] = await db
    .select()
    .from(playbooksTable)
    .where(eq(playbooksTable.id, parsed.data.id))
    .limit(1);
  if (!playbook) {
    res.status(404).json({ error: "Playbook not found" });
    return;
  }
  const steps = await db
    .select()
    .from(playbookStepsTable)
    .where(eq(playbookStepsTable.playbookId, playbook.id));
  res.json({ ...playbook, steps });
});

router.get("/anti-patterns", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListAntiPatternsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 200);
  const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;
  const filters: SQL[] = [];
  if (parsed.data.status) {
    filters.push(eq(antiPatternsTable.status, parsed.data.status as BrainStatus));
  }
  if (parsed.data.domain_tag) {
    filters.push(eq(antiPatternsTable.domainTag, parsed.data.domain_tag as DomainTag));
  }
  const whereClause = filters.length ? and(...filters) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(antiPatternsTable).where(whereClause);
  const rows = await db
    .select()
    .from(antiPatternsTable)
    .where(whereClause)
    .limit(limit)
    .offset(offset);
  res.setHeader("X-Total-Count", String(total));
  res.json(rows);
});

router.get("/examples", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListExamplesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const filters: SQL[] = [];
  if (parsed.data.domain_tag) {
    filters.push(eq(examplesTable.domainTag, parsed.data.domain_tag as DomainTag));
  }
  const rows = await db
    .select()
    .from(examplesTable)
    .where(filters.length ? and(...filters) : undefined);
  res.json(rows);
});

router.post("/brain/ask", async (req: Request, res: Response): Promise<void> => {
  const parsed = AskBrainBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { question, brandId } = parsed.data;
  try {
    const { runKnowledgeQAGraph } = await import("../workflows/knowledgeQA");
    const result = await runKnowledgeQAGraph(parsed.data);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "QA graph failed");
    const [run] = await db
      .insert(mappingRunsTable)
      .values({
        brandId: brandId ?? null,
        query: question,
        runType: "knowledge_answer",
        status: "error",
        outputJson: JSON.stringify({}),
        rationale_summary: "Pipeline error — see server logs.",
        missing_data: "Pipeline failed. Check that documents have been processed and brain objects exist.",
      })
      .returning();
    res.status(500).json({
      id: run.id,
      runType: "knowledge_answer",
      query: question,
      rationale_summary: "An error occurred running the QA pipeline.",
      confidence: null,
      missing_data: "Pipeline error. Ensure documents are ingested and the AI API keys are configured.",
      sections: {
        knownPrinciples: "Pipeline error — no analysis available.",
        brandInference: null,
        uncertainty: "High — pipeline failed to execute.",
        missingData: err instanceof Error ? err.message : "Unknown error.",
      },
      source_refs: [],
      status: "error",
      createdAt: run.createdAt,
    });
  }
});

router.post("/brain/map-brand", async (req: Request, res: Response): Promise<void> => {
  const parsed = MapBrandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { brandId, question } = parsed.data;
  try {
    const { runBrandMappingGraph } = await import("../workflows/brandMapping");
    const result = await runBrandMappingGraph(parsed.data);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Brand mapping graph failed");
    const [run] = await db
      .insert(mappingRunsTable)
      .values({
        brandId,
        query: question,
        runType: "brand_mapping",
        status: "error",
        outputJson: JSON.stringify({}),
        rationale_summary: "Pipeline error.",
        missing_data: "Brand mapping pipeline failed.",
      })
      .returning();
    res.status(500).json({
      id: run.id,
      runType: "brand_mapping",
      query: question,
      rationale_summary: "An error occurred running the brand mapping pipeline.",
      confidence: null,
      missing_data: "Pipeline error. Ensure brand exists and AI API keys are configured.",
      sections: {
        knownPrinciples: "Pipeline error — no analysis available.",
        brandInference: null,
        uncertainty: "High — pipeline failed.",
        missingData: err instanceof Error ? err.message : "Unknown error.",
      },
      source_refs: [],
      status: "error",
      createdAt: run.createdAt,
    });
  }
});

router.post("/brain/where-to-start", async (req: Request, res: Response): Promise<void> => {
  const parsed = GetBrandStrategyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { brandId } = parsed.data;
  try {
    const { runStrategyStartGraph } = await import("../workflows/strategyStart");
    const result = await runStrategyStartGraph(parsed.data);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Strategy graph failed");
    const [run] = await db
      .insert(mappingRunsTable)
      .values({
        brandId,
        query: null,
        runType: "strategy_start",
        status: "error",
        outputJson: JSON.stringify({}),
        rationale_summary: "Pipeline error.",
        missing_data: "Strategy pipeline failed.",
      })
      .returning();
    res.status(500).json({
      id: run.id,
      runType: "strategy_start",
      query: null,
      rationale_summary: "An error occurred running the strategy pipeline.",
      confidence: null,
      missing_data: "Pipeline error. Ensure brand exists, documents are ingested, and AI API keys are configured.",
      sections: {
        knownPrinciples: "Pipeline error — no strategy available.",
        brandInference: null,
        uncertainty: "High — pipeline failed.",
        missingData: err instanceof Error ? err.message : "Unknown error.",
      },
      source_refs: [],
      status: "error",
      createdAt: run.createdAt,
    });
  }
});

// ── Audit helpers ──────────────────────────────────────────────────────────

function groupCount<T>(arr: T[], keyFn: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of arr) {
    const key = keyFn(item) ?? "unknown";
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4);
}

// ── POST /brain/sync ───────────────────────────────────────────────────────

router.post("/brain/sync", async (req: Request, res: Response): Promise<void> => {
  const auditKey = req.headers["x-audit-key"] ?? req.query.key;
  if (!process.env.AUDIT_SECRET || auditKey !== process.env.AUDIT_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const result = await fullSyncToSupabase();
    if (result.skipped) {
      res.status(503).json({ error: result.skipped });
      return;
    }
    res.json({ ok: true, synced: result.synced });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /brain/audit ───────────────────────────────────────────────────────

router.get("/brain/audit", async (req: Request, res: Response): Promise<void> => {
  const auditKey = req.headers["x-audit-key"] ?? req.query.key;
  if (!process.env.AUDIT_SECRET || auditKey !== process.env.AUDIT_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const [principles, rules, playbooks, antiPatterns, examples, documents, recentTraces, recentRuns] =
      await Promise.all([
        db.select().from(principlesTable),
        db.select().from(rulesTable),
        db.select().from(playbooksTable),
        db.select().from(antiPatternsTable),
        db.select().from(examplesTable),
        db.select().from(documentsTable),
        db.select().from(queryTracesTable).orderBy(desc(queryTracesTable.createdAt)).limit(100),
        db.select().from(mappingRunsTable).orderBy(desc(mappingRunsTable.createdAt)).limit(50),
      ]);

    const VAGUE_PHRASES = [
      "should be", "best practice", "high quality", "good content",
      "important to", "make sure", "ensure that", "it is important",
      "you should", "always", "never forget",
    ];

    function isVague(text: string): boolean {
      const lower = text.toLowerCase();
      return text.length < 60 || VAGUE_PHRASES.some((p) => lower.includes(p));
    }

    function safeParseRefs(json: string): number[] {
      try { return JSON.parse(json) as number[]; } catch { return []; }
    }

    function confidenceBucket(score: number | string | null): string {
      const n = parseFloat(String(score ?? 0));
      if (n >= 0.85) return "high (≥0.85)";
      if (n >= 0.70) return "medium (0.70–0.84)";
      if (n >= 0.50) return "low (0.50–0.69)";
      return "very_low (<0.50)";
    }

    const principleMetrics = {
      total: principles.length,
      byDomain: groupCount(principles, (p) => p.domainTag ?? "general"),
      byStatus: groupCount(principles, (p) => p.status ?? "candidate"),
      byConfidenceBucket: groupCount(principles, (p) => confidenceBucket(p.confidenceScore)),
      avgConfidence: avg(principles.map((p) => parseFloat(String(p.confidenceScore ?? 0.4)))),
      withEmptySourceRefs: principles.filter((p) => safeParseRefs(p.sourceRefsJson ?? "[]").length === 0).length,
      withMultipleSources: principles.filter((p) => safeParseRefs(p.sourceRefsJson ?? "[]").length > 1).length,
      vaguePrinciples: principles
        .filter((p) => isVague(p.statement ?? ""))
        .map((p) => ({ id: p.id, title: p.title, statement: p.statement, confidence: p.confidenceScore })),
    };

    const ruleMetrics = {
      total: rules.length,
      byDomain: groupCount(rules, (r) => r.domainTag ?? "general"),
      byRuleType: groupCount(rules, (r) => r.ruleType ?? "diagnostic"),
      byStatus: groupCount(rules, (r) => r.status ?? "candidate"),
      avgConfidence: avg(rules.map((r) => parseFloat(String(r.confidenceScore ?? 0.4)))),
      withEmptySourceRefs: rules.filter((r) => safeParseRefs(r.sourceRefsJson ?? "[]").length === 0).length,
      vagueRules: rules
        .filter((r) => isVague(r.ifCondition ?? "") || isVague(r.thenLogic ?? ""))
        .map((r) => ({ id: r.id, name: r.name, ifCondition: r.ifCondition, thenLogic: r.thenLogic })),
    };

    const playbookMetrics = {
      total: playbooks.length,
      byDomain: groupCount(playbooks, (p) => p.domainTag ?? "general"),
      byStatus: groupCount(playbooks, (p) => p.status ?? "candidate"),
      avgConfidence: avg(playbooks.map((p) => parseFloat(String(p.confidenceScore ?? 0.4)))),
      withEmptySourceRefs: playbooks.filter((p) => safeParseRefs(p.sourceRefsJson ?? "[]").length === 0).length,
      withMissingUseWhen: playbooks.filter((p) => !p.useWhen || p.useWhen.trim().length < 20).length,
    };

    const antiPatternMetrics = {
      total: antiPatterns.length,
      byDomain: groupCount(antiPatterns, (a) => a.domainTag ?? "general"),
      byRiskLevel: groupCount(antiPatterns, (a) => a.riskLevel ?? "medium"),
      byStatus: groupCount(antiPatterns, (a) => a.status ?? "candidate"),
      withEmptySourceRefs: antiPatterns.filter((a) => safeParseRefs(a.sourceRefsJson ?? "[]").length === 0).length,
    };

    const documentMetrics = {
      total: documents.length,
      byTrustLevel: groupCount(documents, (d) => d.trustLevel ?? "medium"),
      byDomain: groupCount(documents, (d) => d.domainTag ?? "general"),
      byStatus: groupCount(documents, (d) => d.rawTextStatus ?? "pending"),
      bySourceType: groupCount(documents, (d) => d.sourceType ?? "text"),
      failedIngestion: documents
        .filter((d) => d.rawTextStatus === "error")
        .map((d) => ({ id: d.id, title: d.title, error: d.errorMessage })),
    };

    const traceMetrics = {
      totalTraces: recentTraces.length,
      byRunType: groupCount(recentTraces, (t) => t.runType ?? "unknown"),
      byModel: groupCount(recentTraces, (t) => t.modelUsed ?? "unknown"),
    };

    const AEO_REQUIRED_DOMAINS = ["aeo", "geo", "seo", "content", "entity"];
    const coveredDomains = new Set([
      ...principles.map((p) => p.domainTag),
      ...rules.map((r) => r.domainTag),
      ...playbooks.map((p) => p.domainTag),
    ]);
    const coverageGaps = AEO_REQUIRED_DOMAINS.filter((d) => !coveredDomains.has(d as DomainTag));

    const domainObjectCounts: Record<string, number> = {};
    for (const d of AEO_REQUIRED_DOMAINS) {
      domainObjectCounts[d] =
        principles.filter((p) => p.domainTag === d).length +
        rules.filter((r) => r.domainTag === d).length +
        playbooks.filter((p) => p.domainTag === d).length;
    }

    res.json({
      generatedAt: new Date().toISOString(),
      summary: {
        totalBrainObjects: principles.length + rules.length + playbooks.length + antiPatterns.length + examples.length,
        totalDocuments: documents.length,
        totalTraces: recentTraces.length,
        coverageGaps,
        domainObjectCounts,
        healthFlags: {
          vaguePrinciplesCount: principleMetrics.vaguePrinciples.length,
          vagueRulesCount: ruleMetrics.vagueRules.length,
          principlesWithNoSource: principleMetrics.withEmptySourceRefs,
          rulesWithNoSource: ruleMetrics.withEmptySourceRefs,
          playbooksMissingUseWhen: playbookMetrics.withMissingUseWhen,
          failedDocuments: documentMetrics.failedIngestion.length,
        },
      },
      metrics: {
        principles: principleMetrics,
        rules: ruleMetrics,
        playbooks: playbookMetrics,
        antiPatterns: antiPatternMetrics,
        documents: documentMetrics,
        traces: traceMetrics,
      },
      brainObjects: {
        principles: principles.map((p) => ({
          id: p.id, title: p.title, statement: p.statement, explanation: p.explanation,
          domainTag: p.domainTag, confidenceScore: p.confidenceScore, sourceCount: p.sourceCount,
          sourceRefsJson: p.sourceRefsJson, status: p.status, createdAt: p.createdAt,
          isVague: isVague(p.statement ?? ""),
        })),
        rules: rules.map((r) => ({
          id: r.id, name: r.name, ruleType: r.ruleType, ifCondition: r.ifCondition,
          thenLogic: r.thenLogic, domainTag: r.domainTag, confidenceScore: r.confidenceScore,
          sourceRefsJson: r.sourceRefsJson, status: r.status, createdAt: r.createdAt,
        })),
        playbooks: playbooks.map((p) => ({
          id: p.id, name: p.name, summary: p.summary, useWhen: p.useWhen,
          avoidWhen: p.avoidWhen, expectedOutcomes: p.expectedOutcomes,
          domainTag: p.domainTag, confidenceScore: p.confidenceScore,
          sourceRefsJson: p.sourceRefsJson, status: p.status, createdAt: p.createdAt,
        })),
        antiPatterns: antiPatterns.map((a) => ({
          id: a.id, title: a.title, description: a.description, signalsJson: a.signalsJson,
          domainTag: a.domainTag, riskLevel: a.riskLevel,
          sourceRefsJson: a.sourceRefsJson, status: a.status, createdAt: a.createdAt,
        })),
        examples: examples.map((e) => ({
          id: e.id, title: e.title, description: e.description,
          domainTag: e.domainTag, sourceRefsJson: e.sourceRefsJson, createdAt: e.createdAt,
        })),
      },
      documents: documents.map((d) => ({
        id: d.id, title: d.title, domainTag: d.domainTag, trustLevel: d.trustLevel,
        sourceType: d.sourceType, rawTextStatus: d.rawTextStatus,
        errorMessage: d.errorMessage, createdAt: d.createdAt,
      })),
      recentTraces: recentTraces.map((t) => ({
        id: t.id, runType: t.runType, query: t.query,
        modelUsed: t.modelUsed, brandId: t.brandId, createdAt: t.createdAt,
      })),
      recentRuns: recentRuns.map((r) => ({
        id: r.id, runType: r.runType, status: r.status,
        rationale_summary: r.rationale_summary, missing_data: r.missing_data,
        brandId: r.brandId, createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    logger.error({ err }, "Brain audit endpoint failed");
    res.status(500).json({ error: "Audit failed", detail: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/brain/backfill-canonical", async (req: Request, res: Response): Promise<void> => {
  const secret = req.headers["x-audit-secret"];
  if (secret !== "sieve-audit-2026-xK9mP3") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const tableConfigs: Array<{ table: string; sourceCountClause: string }> = [
      { table: "principles", sourceCountClause: "source_count >= 3 OR json_array_length(source_refs_json::json) >= 3" },
      { table: "rules", sourceCountClause: "json_array_length(source_refs_json::json) >= 3" },
      { table: "playbooks", sourceCountClause: "json_array_length(source_refs_json::json) >= 3" },
    ];
    const results: Record<string, number> = {};
    for (const { table, sourceCountClause } of tableConfigs) {
      const r = await pool.query<{ id: number }>(
        `UPDATE ${table} SET status = 'canonical'
         WHERE status != 'canonical'
           AND contested = false
           AND confidence_score::numeric > 0.95
           AND (${sourceCountClause})
         RETURNING id`
      );
      results[table] = r.rowCount ?? 0;
    }
    res.json({ promoted: results });
  } catch (err) {
    logger.error({ err }, "Backfill canonical failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/brain/conflicts", async (req: Request, res: Response): Promise<void> => {
  try {
    const tableConfigs = [
      { table: "principles", titleCol: "title" },
      { table: "rules", titleCol: "name" },
      { table: "playbooks", titleCol: "name" },
      { table: "anti_patterns", titleCol: "title" },
    ];
    const contested: Array<{ table: string; id: number; title: string; domainTag: string | null; status: string | null }> = [];

    for (const { table, titleCol } of tableConfigs) {
      const rows = await pool.query<{ id: number; title: string; domain_tag: string | null; status: string | null }>(
        `SELECT id, ${titleCol} AS title, domain_tag, status FROM ${table} WHERE contested = true ORDER BY id`
      );
      for (const row of rows.rows) {
        contested.push({ table, id: row.id, title: row.title, domainTag: row.domain_tag, status: row.status });
      }
    }

    res.json({ total: contested.length, contested });
  } catch (err) {
    logger.error({ err }, "Get conflicts failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/brain/conflicts/:id/resolve", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { table, action } = req.body as { table: string; action: "keep" | "discard" };
  const ALLOWED_TABLES = ["principles", "rules", "playbooks", "anti_patterns"];
  if (!ALLOWED_TABLES.includes(table)) {
    res.status(400).json({ error: "Invalid table" });
    return;
  }
  if (!["keep", "discard"].includes(action)) {
    res.status(400).json({ error: "action must be keep or discard" });
    return;
  }
  try {
    if (action === "discard") {
      await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
      res.json({ deleted: id });
    } else {
      await pool.query(`UPDATE ${table} SET contested = false WHERE id = $1`, [id]);
      res.json({ cleared: id });
    }
  } catch (err) {
    logger.error({ err, id, table, action }, "Resolve conflict failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const BATCH_CONCURRENCY = 5;
const MAX_BATCH_SIZE = 200;
const MIN_CONTENT_CHARS = 200;
const MAX_CONTENT_CHARS = 500_000;

const BatchDocumentSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(MIN_CONTENT_CHARS, { message: `Content must be at least ${MIN_CONTENT_CHARS} characters` }).max(MAX_CONTENT_CHARS),
  sourceUrl: z.string().url().optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)),
  trustLevel: z.enum(["high", "medium", "low"]).optional().default("medium"),
  domainTag: z.enum(["seo", "geo", "aeo", "content", "entity", "general"]).optional().default("general"),
  author: z.string().max(200).optional(),
});

const IngestBatchBody = z.object({
  documents: z.array(BatchDocumentSchema).min(1).max(MAX_BATCH_SIZE),
});

function looksLikeHtml(text: string): boolean {
  const lower = text.slice(0, 2000).toLowerCase();
  return lower.includes("<!doctype") || lower.includes("<html") || lower.includes("<body");
}

function processBatchWithConcurrency(ids: number[]): void {
  const queue = [...ids];
  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      const id = queue.shift()!;
      try {
        const { runIngestionGraph } = await import("../workflows/ingestion");
        await runIngestionGraph(id);
      } catch (err) {
        logger.error({ err, docId: id }, "Batch ingestion worker error");
      }
    }
  };
  const slots = Math.min(BATCH_CONCURRENCY, ids.length);
  void Promise.all(Array.from({ length: slots }, worker));
}

router.post("/brain/ingest-batch", async (req: Request, res: Response): Promise<void> => {
  const parsed = IngestBatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }

  const { documents } = parsed.data;
  const batchId = randomUUID();
  const objectStorage = new ObjectStorageService();

  const accepted: { id: number; title: string }[] = [];
  const skipped: { title: string; reason: string }[] = [];
  const rejected: { title: string; reason: string }[] = [];

  const existingUrls = new Set<string>();
  const existingTitles = new Set<string>();

  const candidateUrls = documents.map((d) => d.sourceUrl).filter(Boolean) as string[];
  const candidateTitles = documents.map((d) => d.title);

  try {
    if (candidateUrls.length > 0) {
      const urlRows = await db
        .select({ sourceUrl: documentsTable.sourceUrl })
        .from(documentsTable)
        .where(inArray(documentsTable.sourceUrl, candidateUrls));
      for (const r of urlRows) if (r.sourceUrl) existingUrls.add(r.sourceUrl);
    }

    const titleRows = await db
      .select({ title: documentsTable.title })
      .from(documentsTable)
      .where(inArray(documentsTable.title, candidateTitles));
    for (const r of titleRows) existingTitles.add(r.title);
  } catch (err) {
    logger.error({ err, batchId }, "Duplicate pre-flight check failed");
    res.status(500).json({ error: "Pre-flight duplicate check failed" });
    return;
  }

  const seenTitlesThisBatch = new Set<string>();

  for (const doc of documents) {
    if (looksLikeHtml(doc.content)) {
      rejected.push({ title: doc.title, reason: "HTML content detected — submit plain text or markdown only" });
      continue;
    }
    if (doc.sourceUrl && existingUrls.has(doc.sourceUrl)) {
      skipped.push({ title: doc.title, reason: `Duplicate source_url: ${doc.sourceUrl}` });
      continue;
    }
    if (existingTitles.has(doc.title) || seenTitlesThisBatch.has(doc.title)) {
      skipped.push({ title: doc.title, reason: `Duplicate title: ${doc.title}` });
      continue;
    }

    seenTitlesThisBatch.add(doc.title);

    let storagePath = "";
    let trustLevel = doc.trustLevel;
    let authorityTier: string | undefined;
    let sourceOrg: string | undefined;
    let classifierConfidence: string | undefined;

    try {
      const textBuffer = Buffer.from(doc.content, "utf-8");
      const { objectPath } = await objectStorage.uploadBuffer(textBuffer, "text/plain");
      storagePath = objectPath;
    } catch (err) {
      logger.error({ err, title: doc.title, batchId }, "Object storage upload failed for batch doc");
      rejected.push({ title: doc.title, reason: "Storage upload failed" });
      continue;
    }

    if (doc.sourceUrl) {
      try {
        const classification = await classifySourceAuthority(doc.sourceUrl);
        sourceOrg = classification.sourceOrg;
        authorityTier = classification.tier;
        classifierConfidence = String(classification.confidence);
        if (doc.trustLevel === "medium") {
          trustLevel = tierToTrustLevel(classification.tier);
        }
      } catch {
        // non-blocking: classification failure doesn't block ingestion
      }
    }

    try {
      const [inserted] = await db
        .insert(documentsTable)
        .values({
          title: doc.title,
          sourceType: "text",
          domainTag: doc.domainTag,
          author: doc.author,
          sourceUrl: doc.sourceUrl,
          storagePath,
          rawTextStatus: "pending",
          trustLevel,
          sourceOrg,
          authorityTier,
          classifierConfidence,
          batchId,
        })
        .returning({ id: documentsTable.id });
      accepted.push({ id: inserted.id, title: doc.title });
    } catch (err) {
      logger.error({ err, title: doc.title, batchId }, "DB insert failed for batch doc");
      rejected.push({ title: doc.title, reason: "Database insert failed" });
    }
  }

  if (accepted.length > 0) {
    processBatchWithConcurrency(accepted.map((d) => d.id));
  }

  logger.info(
    { batchId, accepted: accepted.length, skipped: skipped.length, rejected: rejected.length },
    "Batch ingestion submitted"
  );

  res.status(202).json({
    batchId,
    totalSubmitted: documents.length,
    accepted: accepted.length,
    skipped: skipped.length,
    rejected: rejected.length,
    acceptedIds: accepted.map((d) => d.id),
    acceptedTitles: accepted.map((d) => d.title),
    skippedReasons: skipped,
    rejectedReasons: rejected,
    estimatedMinutes: Math.ceil(accepted.length * 1.5),
  });
});

router.get("/brain/ingest-batch/:batchId/status", async (req: Request, res: Response): Promise<void> => {
  const { batchId } = req.params;
  if (!batchId) {
    res.status(400).json({ error: "Missing batchId" });
    return;
  }

  try {
    const docs = await db
      .select({ id: documentsTable.id, rawTextStatus: documentsTable.rawTextStatus, createdAt: documentsTable.createdAt })
      .from(documentsTable)
      .where(eq(documentsTable.batchId, batchId));

    if (docs.length === 0) {
      res.status(404).json({ error: `No documents found for batchId: ${batchId}` });
      return;
    }

    const counts = { total: docs.length, done: 0, processing: 0, pending: 0, error: 0 };
    for (const d of docs) {
      if (d.rawTextStatus === "done") counts.done++;
      else if (d.rawTextStatus === "processing") counts.processing++;
      else if (d.rawTextStatus === "pending") counts.pending++;
      else if (d.rawTextStatus === "error") counts.error++;
    }

    const complete = counts.done + counts.error === counts.total;

    let extractionSummary: Record<string, number> | undefined;
    if (complete && counts.done > 0) {
      const docIds = docs.map((d) => d.id);
      const [princRow, ruleRow, playbookRow, antiRow] = await Promise.all([
        pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM principles WHERE EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(source_refs_json::jsonb) AS elem
            WHERE elem::int = ANY($1::int[])
          )`,
          [docIds]
        ),
        pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM rules WHERE EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(source_refs_json::jsonb) AS elem
            WHERE elem::int = ANY($1::int[])
          )`,
          [docIds]
        ),
        pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM playbooks WHERE EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(source_refs_json::jsonb) AS elem
            WHERE elem::int = ANY($1::int[])
          )`,
          [docIds]
        ),
        pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM anti_patterns WHERE EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(source_refs_json::jsonb) AS elem
            WHERE elem::int = ANY($1::int[])
          )`,
          [docIds]
        ),
      ]);
      extractionSummary = {
        principles: parseInt(princRow.rows[0]?.count ?? "0", 10),
        rules: parseInt(ruleRow.rows[0]?.count ?? "0", 10),
        playbooks: parseInt(playbookRow.rows[0]?.count ?? "0", 10),
        antiPatterns: parseInt(antiRow.rows[0]?.count ?? "0", 10),
      };
    }

    res.json({ batchId, complete, counts, extractionSummary });
  } catch (err) {
    logger.error({ err, batchId }, "Failed to get batch status");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
