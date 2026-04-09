import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, inArray, type SQL } from "drizzle-orm";
import multer from "multer";
import { z } from "zod";
import { db } from "@workspace/db";
import { documentsTable, documentChunksTable, principlesTable, rulesTable, playbooksTable, antiPatternsTable } from "@workspace/db";
import {
  ListDocumentsQueryParams,
  GetDocumentParams,
  ProcessDocumentParams,
  GetDocumentChunksParams,
  GetDocumentChunksQueryParams,
} from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";
import { fireAndForget } from "../lib/jobRunner";
import { deleteFromSupabase } from "../lib/supabaseSync";
import { classifySourceAuthority, tierToTrustLevel } from "../lib/sourceClassifier";

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

router.get("/documents/pre-classify", async (req: Request, res: Response): Promise<void> => {
  const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
  const sourceUrl = typeof req.query.sourceUrl === "string" ? req.query.sourceUrl.trim() : undefined;
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const result = await classifySourceAuthority(title, sourceUrl);
  res.json({ ...result, trustLevel: tierToTrustLevel(result.tier) });
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

    const classification = await classifySourceAuthority(title, sourceUrl);
    const derivedTrustLevel = trustLevel ?? tierToTrustLevel(classification.tier);

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
        trustLevel: derivedTrustLevel as TrustLevel,
        brandId: brandId ?? null,
        sourceOrg: classification.sourceOrg,
        authorityTier: classification.tier,
        classifierConfidence: String(classification.confidence),
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

    fireAndForget(doc.id);

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

function parseSourceRefs(json: string): number[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : [];
  } catch { return []; }
}

function calcImpact(rows: { id: number; sourceRefsJson: string }[], docId: number) {
  let willDelete = 0, willUpdate = 0;
  for (const row of rows) {
    const refs = parseSourceRefs(row.sourceRefsJson);
    if (!refs.includes(docId)) continue;
    if (refs.length === 1) willDelete++; else willUpdate++;
  }
  return { willDelete, willUpdate };
}

router.get("/documents/:id/impact", async (req: Request, res: Response): Promise<void> => {
  const parsed = GetDocumentParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid document id" }); return; }
  const docId = parsed.data.id;
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, docId)).limit(1);
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

  const [principles, rules, playbooks, antiPatterns] = await Promise.all([
    db.select({ id: principlesTable.id, sourceRefsJson: principlesTable.sourceRefsJson }).from(principlesTable),
    db.select({ id: rulesTable.id, sourceRefsJson: rulesTable.sourceRefsJson }).from(rulesTable),
    db.select({ id: playbooksTable.id, sourceRefsJson: playbooksTable.sourceRefsJson }).from(playbooksTable),
    db.select({ id: antiPatternsTable.id, sourceRefsJson: antiPatternsTable.sourceRefsJson }).from(antiPatternsTable),
  ]);

  const pi = calcImpact(principles, docId);
  const ri = calcImpact(rules, docId);
  const pli = calcImpact(playbooks, docId);
  const ai = calcImpact(antiPatterns, docId);

  res.json({
    docId,
    willDelete: { principles: pi.willDelete, rules: ri.willDelete, playbooks: pli.willDelete, antiPatterns: ai.willDelete, total: pi.willDelete + ri.willDelete + pli.willDelete + ai.willDelete },
    willUpdate: { principles: pi.willUpdate, rules: ri.willUpdate, playbooks: pli.willUpdate, antiPatterns: ai.willUpdate, total: pi.willUpdate + ri.willUpdate + pli.willUpdate + ai.willUpdate },
  });
});

router.post("/documents/bulk-delete", async (req: Request, res: Response): Promise<void> => {
  const { ids } = req.body as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array" });
    return;
  }
  const docIds = ids.map(Number).filter((n) => !isNaN(n) && n > 0);
  if (docIds.length === 0) {
    res.status(400).json({ error: "No valid document ids provided" });
    return;
  }

  const [principles, rules, playbooks, antiPatterns] = await Promise.all([
    db.select({ id: principlesTable.id, sourceRefsJson: principlesTable.sourceRefsJson }).from(principlesTable),
    db.select({ id: rulesTable.id, sourceRefsJson: rulesTable.sourceRefsJson }).from(rulesTable),
    db.select({ id: playbooksTable.id, sourceRefsJson: playbooksTable.sourceRefsJson }).from(playbooksTable),
    db.select({ id: antiPatternsTable.id, sourceRefsJson: antiPatternsTable.sourceRefsJson }).from(antiPatternsTable),
  ]);

  const docIdSet = new Set(docIds);
  const deletedBrainIds: Record<string, number[]> = { principles: [], rules: [], playbooks: [], anti_patterns: [] };

  const processBrainTable = async (
    rows: { id: number; sourceRefsJson: string }[],
    table: typeof principlesTable | typeof rulesTable | typeof playbooksTable | typeof antiPatternsTable,
    tableKey: keyof typeof deletedBrainIds
  ) => {
    for (const row of rows) {
      const refs = parseSourceRefs(row.sourceRefsJson);
      const remaining = refs.filter((id) => !docIdSet.has(id));
      if (remaining.length === refs.length) continue;
      if (remaining.length === 0) {
        await db.delete(table).where(eq(table.id, row.id));
        deletedBrainIds[tableKey].push(row.id);
      } else {
        await db.update(table).set({ sourceRefsJson: JSON.stringify(remaining) }).where(eq(table.id, row.id));
      }
    }
  };

  await Promise.all([
    processBrainTable(principles, principlesTable, "principles"),
    processBrainTable(rules, rulesTable, "rules"),
    processBrainTable(playbooks, playbooksTable, "playbooks"),
    processBrainTable(antiPatterns, antiPatternsTable, "anti_patterns"),
  ]);

  await db.delete(documentChunksTable).where(inArray(documentChunksTable.documentId, docIds));
  await db.delete(documentsTable).where(inArray(documentsTable.id, docIds));

  fireAndForget(async () => {
    await Promise.all([
      deleteFromSupabase("documents", docIds),
      deleteFromSupabase("principles", deletedBrainIds.principles),
      deleteFromSupabase("rules", deletedBrainIds.rules),
      deleteFromSupabase("playbooks", deletedBrainIds.playbooks),
      deleteFromSupabase("anti_patterns", deletedBrainIds.anti_patterns),
    ]);
  });

  res.json({ deleted: docIds.length });
});

router.delete("/documents/:id", async (req: Request, res: Response): Promise<void> => {
  const parsed = GetDocumentParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid document id" }); return; }
  const cascade = req.query.cascade === "true";
  const docId = parsed.data.id;

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, docId)).limit(1);
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

  const deletedBrainIds: Record<string, number[]> = { principles: [], rules: [], playbooks: [], anti_patterns: [] };

  if (cascade) {
    const [principles, rules, playbooks, antiPatterns] = await Promise.all([
      db.select({ id: principlesTable.id, sourceRefsJson: principlesTable.sourceRefsJson }).from(principlesTable),
      db.select({ id: rulesTable.id, sourceRefsJson: rulesTable.sourceRefsJson }).from(rulesTable),
      db.select({ id: playbooksTable.id, sourceRefsJson: playbooksTable.sourceRefsJson }).from(playbooksTable),
      db.select({ id: antiPatternsTable.id, sourceRefsJson: antiPatternsTable.sourceRefsJson }).from(antiPatternsTable),
    ]);

    const processTable = async (rows: { id: number; sourceRefsJson: string }[], table: typeof principlesTable | typeof rulesTable | typeof playbooksTable | typeof antiPatternsTable, tableKey: keyof typeof deletedBrainIds) => {
      for (const row of rows) {
        const refs = parseSourceRefs(row.sourceRefsJson);
        if (!refs.includes(docId)) continue;
        if (refs.length === 1) {
          await db.delete(table).where(eq(table.id, row.id));
          deletedBrainIds[tableKey].push(row.id);
        } else {
          await db.update(table).set({ sourceRefsJson: JSON.stringify(refs.filter((id) => id !== docId)) }).where(eq(table.id, row.id));
        }
      }
    };

    await Promise.all([
      processTable(principles, principlesTable, "principles"),
      processTable(rules, rulesTable, "rules"),
      processTable(playbooks, playbooksTable, "playbooks"),
      processTable(antiPatterns, antiPatternsTable, "anti_patterns"),
    ]);
  }

  await db.delete(documentChunksTable).where(eq(documentChunksTable.documentId, docId));
  await db.delete(documentsTable).where(eq(documentsTable.id, docId));

  fireAndForget(async () => {
    await Promise.all([
      deleteFromSupabase("documents", [docId]),
      deleteFromSupabase("principles", deletedBrainIds.principles),
      deleteFromSupabase("rules", deletedBrainIds.rules),
      deleteFromSupabase("playbooks", deletedBrainIds.playbooks),
      deleteFromSupabase("anti_patterns", deletedBrainIds.anti_patterns),
    ]);
  });

  res.json({ deleted: true, cascade });
});

export default router;
