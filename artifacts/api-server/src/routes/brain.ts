import { Router, type IRouter, type Request, type Response } from "express";
import { fullSyncToSupabase } from "../lib/supabaseSync";
import { eq, and, desc, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
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

type DomainTag = "seo" | "geo" | "aeo" | "content" | "entity" | "general";
type BrainStatus = "canonical" | "candidate";

const router = Router();

router.get("/principles", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListPrinciplesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const filters: SQL[] = [];
  if (parsed.data.status) {
    filters.push(eq(principlesTable.status, parsed.data.status as BrainStatus));
  }
  if (parsed.data.domain_tag) {
    filters.push(eq(principlesTable.domainTag, parsed.data.domain_tag as DomainTag));
  }
  const rows = await db
    .select()
    .from(principlesTable)
    .where(filters.length ? and(...filters) : undefined);
  res.json(rows);
});

router.get("/rules", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListRulesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const filters: SQL[] = [];
  if (parsed.data.status) {
    filters.push(eq(rulesTable.status, parsed.data.status as BrainStatus));
  }
  if (parsed.data.domain_tag) {
    filters.push(eq(rulesTable.domainTag, parsed.data.domain_tag as DomainTag));
  }
  const rows = await db
    .select()
    .from(rulesTable)
    .where(filters.length ? and(...filters) : undefined);
  res.json(rows);
});

router.get("/playbooks", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListPlaybooksQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const filters: SQL[] = [];
  if (parsed.data.status) {
    filters.push(eq(playbooksTable.status, parsed.data.status as BrainStatus));
  }
  if (parsed.data.domain_tag) {
    filters.push(eq(playbooksTable.domainTag, parsed.data.domain_tag as DomainTag));
  }
  const rows = await db
    .select()
    .from(playbooksTable)
    .where(filters.length ? and(...filters) : undefined);
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
  const filters: SQL[] = [];
  if (parsed.data.status) {
    filters.push(eq(antiPatternsTable.status, parsed.data.status as BrainStatus));
  }
  if (parsed.data.domain_tag) {
    filters.push(eq(antiPatternsTable.domainTag, parsed.data.domain_tag as DomainTag));
  }
  const rows = await db
    .select()
    .from(antiPatternsTable)
    .where(filters.length ? and(...filters) : undefined);
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
      avgConfidence: avg(principles.map((p) => parseFloat(String(p.confidenceScore ?? 0.7)))),
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
      avgConfidence: avg(rules.map((r) => parseFloat(String(r.confidenceScore ?? 0.7)))),
      withEmptySourceRefs: rules.filter((r) => safeParseRefs(r.sourceRefsJson ?? "[]").length === 0).length,
      vagueRules: rules
        .filter((r) => isVague(r.ifCondition ?? "") || isVague(r.thenLogic ?? ""))
        .map((r) => ({ id: r.id, name: r.name, ifCondition: r.ifCondition, thenLogic: r.thenLogic })),
    };

    const playbookMetrics = {
      total: playbooks.length,
      byDomain: groupCount(playbooks, (p) => p.domainTag ?? "general"),
      byStatus: groupCount(playbooks, (p) => p.status ?? "candidate"),
      avgConfidence: avg(playbooks.map((p) => parseFloat(String(p.confidenceScore ?? 0.7)))),
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
      frequencyGuardActive: recentTraces.length < 20,
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
          frequencyGuardActive: traceMetrics.frequencyGuardActive,
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

export default router;
