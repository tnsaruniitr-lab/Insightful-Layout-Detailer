import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { documentsTable, documentChunksTable } from "@workspace/db";
import {
  UploadDocumentBody,
  ListDocumentsQueryParams,
  GetDocumentParams,
  ProcessDocumentParams,
  GetDocumentChunksParams,
  GetDocumentChunksQueryParams,
} from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

router.get("/documents", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListDocumentsQueryParams.safeParse(req.query);
  const filters: SQL[] = [];
  if (parsed.success) {
    if (parsed.data.brand_id != null) {
      filters.push(eq(documentsTable.brandId, parsed.data.brand_id));
    }
    if (parsed.data.domain_tag) {
      filters.push(
        eq(documentsTable.domainTag, parsed.data.domain_tag as "seo" | "geo" | "aeo" | "content" | "entity" | "general")
      );
    }
    if (parsed.data.status) {
      filters.push(
        eq(documentsTable.rawTextStatus, parsed.data.status as "pending" | "processing" | "done" | "error")
      );
    }
  }
  const rows = await db
    .select()
    .from(documentsTable)
    .where(filters.length ? and(...filters) : undefined);
  res.json(rows);
});

router.post("/documents/upload", async (req: Request, res: Response): Promise<void> => {
  const parsed = UploadDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const {
    title,
    filename: _filename,
    contentType: _contentType,
    fileSize: _fileSize,
    sourceType = "pdf",
    domainTag = "general",
    author,
    sourceUrl,
    trustLevel = "medium",
    brandId,
  } = parsed.data;

  const uploadUrl = await objectStorage.getObjectEntityUploadURL();
  const objectPath = objectStorage.normalizeObjectEntityPath(uploadUrl);

  const [doc] = await db
    .insert(documentsTable)
    .values({
      title,
      sourceType: sourceType as "pdf" | "doc" | "text" | "markdown" | "web_import",
      domainTag: domainTag as "seo" | "geo" | "aeo" | "content" | "entity" | "general",
      author: author ?? null,
      sourceUrl: sourceUrl ?? null,
      storagePath: objectPath,
      rawTextStatus: "pending",
      trustLevel: trustLevel as "high" | "medium" | "low",
      brandId: brandId ?? null,
    })
    .returning();

  res.status(201).json({
    documentId: doc.id,
    uploadUrl,
    objectPath,
  });
});

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
      res.json({ status: "processing", documentId: doc.id });
      return;
    }
    await db
      .update(documentsTable)
      .set({ rawTextStatus: "processing" })
      .where(eq(documentsTable.id, doc.id));

    setImmediate(async () => {
      try {
        const { runIngestionGraph } = await import("../pipelines/ingestion");
        await runIngestionGraph(doc.id);
      } catch (err) {
        req.log.error({ err, documentId: doc.id }, "Ingestion pipeline failed");
        await db
          .update(documentsTable)
          .set({ rawTextStatus: "error", errorMessage: String(err) })
          .where(eq(documentsTable.id, doc.id));
      }
    });

    res.json({ status: "processing", documentId: doc.id });
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
    const limit = queryParsed.success ? (queryParsed.data.limit ?? 50) : 50;
    const offset = queryParsed.success ? (queryParsed.data.offset ?? 0) : 0;

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
