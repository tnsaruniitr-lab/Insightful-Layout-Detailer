import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, type SQL } from "drizzle-orm";
import multer from "multer";
import { z } from "zod";
import { db } from "@workspace/db";
import { documentsTable, documentChunksTable } from "@workspace/db";
import {
  ListDocumentsQueryParams,
  GetDocumentParams,
  ProcessDocumentParams,
  GetDocumentChunksParams,
  GetDocumentChunksQueryParams,
} from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";

type DomainTag = "seo" | "geo" | "aeo" | "content" | "entity" | "general";
type DocStatus = "pending" | "processing" | "done" | "error";
type SourceType = "pdf" | "doc" | "text" | "markdown" | "web_import";
type TrustLevel = "high" | "medium" | "low";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const UploadDocumentBodyText = z.object({
  title: z.string().min(1),
  sourceType: z.enum(["pdf", "doc", "text", "markdown", "web_import"]).optional(),
  domainTag: z.enum(["seo", "geo", "aeo", "content", "entity", "general"]).optional(),
  author: z.string().optional(),
  sourceUrl: z.string().optional(),
  trustLevel: z.enum(["high", "medium", "low"]).optional(),
  brandId: z.coerce.number().int().positive().optional().nullable(),
});

router.get("/documents", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListDocumentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const filters: SQL[] = [];
  if (parsed.data.brand_id != null) {
    filters.push(eq(documentsTable.brandId, parsed.data.brand_id));
  }
  if (parsed.data.domain_tag) {
    filters.push(eq(documentsTable.domainTag, parsed.data.domain_tag as DomainTag));
  }
  if (parsed.data.status) {
    filters.push(eq(documentsTable.rawTextStatus, parsed.data.status as DocStatus));
  }
  const rows = await db
    .select()
    .from(documentsTable)
    .where(filters.length ? and(...filters) : undefined);
  res.json(rows);
});

router.post(
  "/documents/upload",
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      res
        .status(400)
        .json({ error: "No file uploaded. Use multipart/form-data with a 'file' field." });
      return;
    }

    const textParsed = UploadDocumentBodyText.safeParse(req.body);
    if (!textParsed.success) {
      res.status(400).json({ error: textParsed.error.flatten() });
      return;
    }

    const { title, sourceType, domainTag, author, sourceUrl, trustLevel, brandId } =
      textParsed.data;

    const contentType = req.file.mimetype || "application/octet-stream";

    let objectPath: string;
    try {
      const result = await objectStorage.uploadBuffer(req.file.buffer, contentType);
      objectPath = result.objectPath;
    } catch (err) {
      req.log.error({ err }, "Failed to upload file to object storage");
      res.status(500).json({ error: "Failed to store document file" });
      return;
    }

    const [doc] = await db
      .insert(documentsTable)
      .values({
        title,
        sourceType: (sourceType ?? "pdf") as SourceType,
        domainTag: (domainTag ?? "general") as DomainTag,
        author: author ?? null,
        sourceUrl: sourceUrl ?? null,
        storagePath: objectPath,
        rawTextStatus: "pending",
        trustLevel: (trustLevel ?? "medium") as TrustLevel,
        brandId: brandId ?? null,
      })
      .returning();

    res.status(201).json(doc);
  }
);

router.get("/documents/:id", async (req: Request, res: Response): Promise<void> => {
  const parsed = GetDocumentParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid document id" });
    return;
  }
  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, parsed.data.id))
    .limit(1);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json(doc);
});

router.post(
  "/documents/:id/process",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ProcessDocumentParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid document id" });
      return;
    }
    const [doc] = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.id, parsed.data.id))
      .limit(1);
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    if (doc.rawTextStatus === "processing") {
      res.json({ status: "processing" });
      return;
    }
    await db
      .update(documentsTable)
      .set({ rawTextStatus: "processing" })
      .where(eq(documentsTable.id, doc.id));

    res.json({ status: "processing" });
  }
);

router.get(
  "/documents/:id/chunks",
  async (req: Request, res: Response): Promise<void> => {
    const paramsParsed = GetDocumentChunksParams.safeParse(req.params);
    if (!paramsParsed.success) {
      res.status(400).json({ error: "Invalid document id" });
      return;
    }
    const queryParsed = GetDocumentChunksQueryParams.safeParse(req.query);
    if (!queryParsed.success) {
      res.status(400).json({ error: queryParsed.error.flatten() });
      return;
    }
    const limit = queryParsed.data.limit ?? 50;
    const offset = queryParsed.data.offset ?? 0;

    const rows = await db
      .select()
      .from(documentChunksTable)
      .where(eq(documentChunksTable.documentId, paramsParsed.data.id))
      .limit(limit)
      .offset(offset);
    res.json(rows);
  }
);

export default router;
