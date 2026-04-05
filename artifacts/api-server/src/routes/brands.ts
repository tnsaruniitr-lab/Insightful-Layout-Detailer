import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  brandsTable,
  competitorsTable,
} from "@workspace/db";
import {
  CreateBrandBody,
  GetBrandParams,
  UpdateBrandParams,
  UpdateBrandBody,
  GetBrandCompetitorsParams,
  CreateCompetitorParams,
  CreateCompetitorBody,
  DeleteCompetitorParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/brands", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateBrandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [brand] = await db
    .insert(brandsTable)
    .values(parsed.data)
    .returning();
  res.status(201).json(brand);
});

router.get("/brands/:id", async (req: Request, res: Response): Promise<void> => {
  const parsed = GetBrandParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid brand id" });
    return;
  }
  const [brand] = await db
    .select()
    .from(brandsTable)
    .where(eq(brandsTable.id, parsed.data.id))
    .limit(1);
  if (!brand) {
    res.status(404).json({ error: "Brand not found" });
    return;
  }
  res.json(brand);
});

router.patch("/brands/:id", async (req: Request, res: Response): Promise<void> => {
  const paramsParsed = UpdateBrandParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid brand id" });
    return;
  }
  const bodyParsed = UpdateBrandBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  const [updated] = await db
    .update(brandsTable)
    .set(bodyParsed.data)
    .where(eq(brandsTable.id, paramsParsed.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Brand not found" });
    return;
  }
  res.json(updated);
});

router.get(
  "/brands/:id/competitors",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = GetBrandCompetitorsParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid brand id" });
      return;
    }
    const rows = await db
      .select()
      .from(competitorsTable)
      .where(eq(competitorsTable.brandId, parsed.data.id));
    res.json(rows);
  }
);

router.post(
  "/brands/:id/competitors",
  async (req: Request, res: Response): Promise<void> => {
    const paramsParsed = CreateCompetitorParams.safeParse(req.params);
    if (!paramsParsed.success) {
      res.status(400).json({ error: "Invalid brand id" });
      return;
    }
    const bodyParsed = CreateCompetitorBody.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: bodyParsed.error.message });
      return;
    }
    const [competitor] = await db
      .insert(competitorsTable)
      .values({ ...bodyParsed.data, brandId: paramsParsed.data.id })
      .returning();
    res.status(201).json(competitor);
  }
);

router.delete(
  "/brands/:id/competitors/:competitorId",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = DeleteCompetitorParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    await db
      .delete(competitorsTable)
      .where(
        and(
          eq(competitorsTable.id, parsed.data.competitorId),
          eq(competitorsTable.brandId, parsed.data.id)
        )
      );
    res.status(204).end();
  }
);

export default router;
