import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { brandsTable } from "./brand";

export const runTypeEnum = pgEnum("run_type", [
  "knowledge_answer",
  "brand_mapping",
  "strategy_start",
]);

export const runStatusEnum = pgEnum("run_status", [
  "pending",
  "processing",
  "done",
  "error",
]);

export const mappingRunSourceTypeEnum = pgEnum("mapping_run_source_type", [
  "document_chunk",
  "principle",
  "rule",
  "playbook",
  "anti_pattern",
]);

export const mappingRunsTable = pgTable("mapping_runs", {
  id: serial("id").primaryKey(),
  brandId: integer("brand_id").references(() => brandsTable.id, {
    onDelete: "set null",
  }),
  query: text("query"),
  runType: runTypeEnum("run_type").notNull(),
  status: runStatusEnum("status").notNull().default("done"),
  outputJson: text("output_json").notNull().default("{}"),
  rationale_summary: text("rationale_summary"),
  missing_data: text("missing_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMappingRunSchema = createInsertSchema(mappingRunsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertMappingRun = z.infer<typeof insertMappingRunSchema>;
export type MappingRun = typeof mappingRunsTable.$inferSelect;

export const mappingRunSourcesTable = pgTable("mapping_run_sources", {
  id: serial("id").primaryKey(),
  mappingRunId: integer("mapping_run_id")
    .notNull()
    .references(() => mappingRunsTable.id, { onDelete: "cascade" }),
  sourceType: mappingRunSourceTypeEnum("source_type").notNull(),
  sourceId: integer("source_id").notNull(),
});

export const insertMappingRunSourceSchema = createInsertSchema(
  mappingRunSourcesTable
).omit({ id: true });
export type InsertMappingRunSource = z.infer<typeof insertMappingRunSourceSchema>;
export type MappingRunSource = typeof mappingRunSourcesTable.$inferSelect;
