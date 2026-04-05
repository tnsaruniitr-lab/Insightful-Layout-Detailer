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

const router: IRouter = Router();

router.get("/principles", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListPrinciplesQueryParams.safeParse(req.query);
  const filters: SQL[] = [];
  if (parsed.success) {
    if (parsed.data.status) {
      filters.push(eq(principlesTable.status, parsed.data.status as "canonical" | "candidate"));
    }
    if (parsed.data.domain_tag) {
      filters.push(
        eq(principlesTable.domainTag, parsed.data.domain_tag as "seo" | "geo" | "aeo" | "content" | "entity" | "general")
      );
    }
  }
  const rows = await db
    .select()
    .from(principlesTable)
    .where(filters.length ? and(...filters) : undefined);
  res.json(rows);
});

router.get("/rules", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListRulesQueryParams.safeParse(req.query);
  const filters: SQL[] = [];
  if (parsed.success) {
    if (parsed.data.status) {
      filters.push(eq(rulesTable.status, parsed.data.status as "canonical" | "candidate"));
    }
    if (parsed.data.domain_tag) {
      filters.push(
        eq(rulesTable.domainTag, parsed.data.domain_tag as "seo" | "geo" | "aeo" | "content" | "entity" | "general")
      );
    }
  }
  const rows = await db
    .select()
    .from(rulesTable)
    .where(filters.length ? and(...filters) : undefined);
  res.json(rows);
});

router.get("/playbooks", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListPlaybooksQueryParams.safeParse(req.query);
  const filters: SQL[] = [];
  if (parsed.success) {
    if (parsed.data.status) {
      filters.push(eq(playbooksTable.status, parsed.data.status as "canonical" | "candidate"));
    }
    if (parsed.data.domain_tag) {
      filters.push(
        eq(playbooksTable.domainTag, parsed.data.domain_tag as "seo" | "geo" | "aeo" | "content" | "entity" | "general")
      );
    }
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
  const filters: SQL[] = [];
  if (parsed.success) {
    if (parsed.data.status) {
      filters.push(eq(antiPatternsTable.status, parsed.data.status as "canonical" | "candidate"));
    }
    if (parsed.data.domain_tag) {
      filters.push(
        eq(antiPatternsTable.domainTag, parsed.data.domain_tag as "seo" | "geo" | "aeo" | "content" | "entity" | "general")
      );
    }
  }
  const rows = await db
    .select()
    .from(antiPatternsTable)
    .where(filters.length ? and(...filters) : undefined);
  res.json(rows);
});

router.get("/examples", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListExamplesQueryParams.safeParse(req.query);
  const filters: SQL[] = [];
  if (parsed.success && parsed.data.domain_tag) {
    filters.push(
      eq(examplesTable.domainTag, parsed.data.domain_tag as "seo" | "geo" | "aeo" | "content" | "entity" | "general")
    );
  }
  const rows = await db
    .select()
    .from(examplesTable)
    .where(filters.length ? and(...filters) : undefined);
  res.json(rows);
});

function buildPlaceholderMemo(
  runId: number,
  runType: "knowledge_answer" | "brand_mapping" | "strategy_start",
  query: string | null,
  createdAt: Date
) {
  return {
    id: runId,
    runType,
    query,
    rationale_summary:
      "AI pipeline not yet initialised — placeholder response pending Task 1B implementation.",
    confidence: null,
    missing_data:
      "No AI pipeline available yet. Brain knowledge objects must be ingested before analysis can run.",
    sections: {
      knownPrinciples:
        "No principles have been extracted yet. Upload and process knowledge documents to populate the brain.",
      brandInference: null,
      uncertainty:
        "High uncertainty — AI extraction pipeline is pending implementation.",
      missingData:
        "Ingestion pipeline required. No embeddings or brain objects available.",
    },
    source_refs: [],
    status: "done",
    createdAt,
  };
}

router.post("/brain/ask", async (req: Request, res: Response): Promise<void> => {
  const parsed = AskBrainBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { question, brandId } = parsed.data;
  try {
    const { runQaGraph } = await import("../pipelines/qa");
    const result = await runQaGraph(parsed.data);
    res.json(result);
  } catch (_err) {
    const [run] = await db
      .insert(mappingRunsTable)
      .values({
        brandId: brandId ?? null,
        query: question,
        runType: "knowledge_answer",
        status: "done",
        outputJson: JSON.stringify({}),
        rationale_summary: "Placeholder — AI pipeline pending.",
        missing_data:
          "No AI pipeline available yet. Brain knowledge objects must be ingested before analysis can run.",
      })
      .returning();
    res.json(buildPlaceholderMemo(run.id, "knowledge_answer", question, run.createdAt));
  }
});

router.post("/brain/map-brand", async (req: Request, res: Response): Promise<void> => {
  const parsed = MapBrandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { brandId, question } = parsed.data;
  try {
    const { runBrandMappingGraph } = await import("../pipelines/brandMapping");
    const result = await runBrandMappingGraph(parsed.data);
    res.json(result);
  } catch (_err) {
    const [run] = await db
      .insert(mappingRunsTable)
      .values({
        brandId,
        query: question,
        runType: "brand_mapping",
        status: "done",
        outputJson: JSON.stringify({}),
        rationale_summary: "Placeholder — AI pipeline pending.",
        missing_data:
          "No AI pipeline available yet. Brand mapping requires ingested documents.",
      })
      .returning();
    res.json(buildPlaceholderMemo(run.id, "brand_mapping", question, run.createdAt));
  }
});

router.post("/brain/where-to-start", async (req: Request, res: Response): Promise<void> => {
  const parsed = GetBrandStrategyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { brandId } = parsed.data;
  try {
    const { runStrategyGraph } = await import("../pipelines/strategy");
    const result = await runStrategyGraph(parsed.data);
    res.json(result);
  } catch (_err) {
    const [run] = await db
      .insert(mappingRunsTable)
      .values({
        brandId,
        query: null,
        runType: "strategy_start",
        status: "done",
        outputJson: JSON.stringify({}),
        rationale_summary: "Placeholder — strategy pipeline pending.",
        missing_data:
          "Strategy analysis requires ingested knowledge documents and brand data.",
      })
      .returning();
    res.json(buildPlaceholderMemo(run.id, "strategy_start", null, run.createdAt));
  }
});

export default router;
