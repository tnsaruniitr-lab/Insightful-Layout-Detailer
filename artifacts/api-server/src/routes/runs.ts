import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { mappingRunsTable, mappingRunSourcesTable } from "@workspace/db";
import {
  ListRunsQueryParams,
  GetRunParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/runs", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListRunsQueryParams.safeParse(req.query);
  const filters: SQL[] = [];
  if (parsed.success) {
    if (parsed.data.run_type) {
      filters.push(
        eq(mappingRunsTable.runType, parsed.data.run_type as "knowledge_answer" | "brand_mapping" | "strategy_start")
      );
    }
    if (parsed.data.brand_id != null) {
      filters.push(eq(mappingRunsTable.brandId, parsed.data.brand_id));
    }
  }
  const limit = parsed.success ? (parsed.data.limit ?? 50) : 50;
  const rows = await db
    .select()
    .from(mappingRunsTable)
    .where(filters.length ? and(...filters) : undefined)
    .limit(limit);
  res.json(rows);
});

router.get("/runs/:id", async (req: Request, res: Response): Promise<void> => {
  const parsed = GetRunParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid run id" });
    return;
  }
  const [run] = await db
    .select()
    .from(mappingRunsTable)
    .where(eq(mappingRunsTable.id, parsed.data.id))
    .limit(1);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  const sources = await db
    .select()
    .from(mappingRunSourcesTable)
    .where(eq(mappingRunSourcesTable.mappingRunId, run.id));
  res.json({ ...run, sources });
});

export default router;
