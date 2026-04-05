import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { uploadedDataAssetsTable } from "@workspace/db";
import {
  GetBrandDataAssetsParams,
  UploadBrandDataParams,
  UploadBrandDataBody,
} from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

router.get(
  "/brands/:id/data/assets",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = GetBrandDataAssetsParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid brand id" });
      return;
    }
    const rows = await db
      .select()
      .from(uploadedDataAssetsTable)
      .where(eq(uploadedDataAssetsTable.brandId, parsed.data.id));
    res.json(rows);
  }
);

router.post(
  "/brands/:id/data/upload",
  async (req: Request, res: Response): Promise<void> => {
    const paramsParsed = UploadBrandDataParams.safeParse(req.params);
    if (!paramsParsed.success) {
      res.status(400).json({ error: "Invalid brand id" });
      return;
    }
    const bodyParsed = UploadBrandDataBody.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: bodyParsed.error.message });
      return;
    }
    const { assetType, filename } = bodyParsed.data;

    const uploadUrl = await objectStorage.getObjectEntityUploadURL();
    const objectPath = objectStorage.normalizeObjectEntityPath(uploadUrl);

    const [asset] = await db
      .insert(uploadedDataAssetsTable)
      .values({
        brandId: paramsParsed.data.id,
        assetType: assetType as "rankings_csv" | "traffic_csv" | "geo_snapshot_csv" | "competitor_csv",
        filename,
        storagePath: objectPath,
      })
      .returning();
    res.status(201).json(asset);
  }
);

export default router;
