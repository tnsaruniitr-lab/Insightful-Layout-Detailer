import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  principlesTable,
  rulesTable,
  antiPatternsTable,
  playbooksTable,
  playbookStepsTable,
  examplesTable,
  mappingRunsTable,
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

export default router;
