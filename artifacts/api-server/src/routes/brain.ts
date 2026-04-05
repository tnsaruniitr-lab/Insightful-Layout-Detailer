import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  principlesTable,
  rulesTable,
  antiPatternsTable,
  playbooksTable,
  playbookStepsTable,
  examplesTable,
  mappingRunsTable,
  mappingRunSourcesTable,
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

const router: IRouter = Router();

router.get("/principles", async (req: Request, res: Response): Promise<void> => {
  ListPrinciplesQueryParams.safeParse(req.query);
  const rows = await db.select().from(principlesTable);
  res.json(rows);
});

router.get("/rules", async (req: Request, res: Response): Promise<void> => {
  ListRulesQueryParams.safeParse(req.query);
  const rows = await db.select().from(rulesTable);
  res.json(rows);
});

router.get("/playbooks", async (req: Request, res: Response): Promise<void> => {
  ListPlaybooksQueryParams.safeParse(req.query);
  const rows = await db.select().from(playbooksTable);
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
  ListAntiPatternsQueryParams.safeParse(req.query);
  const rows = await db.select().from(antiPatternsTable);
  res.json(rows);
});

router.get("/examples", async (req: Request, res: Response): Promise<void> => {
  ListExamplesQueryParams.safeParse(req.query);
  const rows = await db.select().from(examplesTable);
  res.json(rows);
});

router.post("/brain/ask", async (req: Request, res: Response): Promise<void> => {
  const parsed = AskBrainBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const { runQaGraph } = await import("../pipelines/qa");
    const result = await runQaGraph(parsed.data);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "QA pipeline not yet available");
    res.status(503).json({ error: "AI pipeline not yet initialised" });
  }
});

router.post("/brain/map-brand", async (req: Request, res: Response): Promise<void> => {
  const parsed = MapBrandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const { runBrandMappingGraph } = await import("../pipelines/brandMapping");
    const result = await runBrandMappingGraph(parsed.data);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Brand mapping pipeline not yet available");
    res.status(503).json({ error: "AI pipeline not yet initialised" });
  }
});

router.post("/brain/where-to-start", async (req: Request, res: Response): Promise<void> => {
  const parsed = GetBrandStrategyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const { runStrategyGraph } = await import("../pipelines/strategy");
    const result = await runStrategyGraph(parsed.data);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Strategy pipeline not yet available");
    res.status(503).json({ error: "AI pipeline not yet initialised" });
  }
});

export default router;
