import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  pgEnum,
  numeric,
  customType,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { brandsTable } from "./brand";

export const rawTextStatusEnum = pgEnum("raw_text_status", [
  "pending",
  "processing",
  "done",
  "error",
]);

export const sourceTypeEnum = pgEnum("source_type_doc", [
  "pdf",
  "doc",
  "text",
  "markdown",
  "web_import",
]);

export const domainTagEnum = pgEnum("domain_tag", [
  "seo",
  "geo",
  "aeo",
  "content",
  "entity",
  "general",
]);

export const trustLevelEnum = pgEnum("trust_level", ["high", "medium", "low"]);

export const embeddingVectorType = customType<{
  data: number[];
  config: { dimensions: number };
  configRequired: true;
}>({
  dataType(config) {
    return `vector(${config.dimensions})`;
  },
  toDriver(value: number[]) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: unknown) {
    if (typeof value === "string") {
      return value.slice(1, -1).split(",").map(Number);
    }
    return value as number[];
  },
});

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  brandId: integer("brand_id").references(() => brandsTable.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  sourceType: sourceTypeEnum("source_type").notNull().default("text"),
  domainTag: domainTagEnum("domain_tag").notNull().default("general"),
  author: text("author"),
  sourceUrl: text("source_url"),
  storagePath: text("storage_path").notNull().default(""),
  rawTextStatus: rawTextStatusEnum("raw_text_status").notNull().default("pending"),
  errorMessage: text("error_message"),
  trustLevel: trustLevelEnum("trust_level").notNull().default("medium"),
  sourceOrg: text("source_org"),
  authorityTier: text("authority_tier"),
  classifierConfidence: numeric("classifier_confidence", { precision: 4, scale: 3 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;

export const documentChunksTable = pgTable("document_chunks", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id")
    .notNull()
    .references(() => documentsTable.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  chunkText: text("chunk_text").notNull(),
  tokenCount: integer("token_count").notNull().default(0),
  domainTag: domainTagEnum("domain_tag").default("general"),
  sourceConfidence: numeric("source_confidence", { precision: 4, scale: 3 }),
  metadataJson: text("metadata_json"),
  embeddingVector: embeddingVectorType("embedding_vector", { dimensions: 1536 }),
  // HNSW index is created via lib/db/migrations/0001_pgvector_hnsw.sql (not managed by drizzle-kit).
  // Similarity search: SELECT * FROM document_chunks ORDER BY embedding_vector <=> $1::vector LIMIT $2
});

export const insertDocumentChunkSchema = createInsertSchema(documentChunksTable).omit({
  id: true,
});
export type InsertDocumentChunk = z.infer<typeof insertDocumentChunkSchema>;
export type DocumentChunk = typeof documentChunksTable.$inferSelect;

export const dataAssetTypeEnum = pgEnum("data_asset_type", [
  "rankings_csv",
  "traffic_csv",
  "geo_snapshot_csv",
  "competitor_csv",
]);

export const uploadedDataAssetsTable = pgTable("uploaded_data_assets", {
  id: serial("id").primaryKey(),
  brandId: integer("brand_id")
    .notNull()
    .references(() => brandsTable.id, { onDelete: "cascade" }),
  assetType: dataAssetTypeEnum("asset_type").notNull(),
  filename: text("filename").notNull(),
  storagePath: text("storage_path").notNull(),
  rowCount: integer("row_count"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUploadedDataAssetSchema = createInsertSchema(
  uploadedDataAssetsTable
).omit({ id: true, uploadedAt: true });
export type InsertUploadedDataAsset = z.infer<typeof insertUploadedDataAssetSchema>;
export type UploadedDataAsset = typeof uploadedDataAssetsTable.$inferSelect;
