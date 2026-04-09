import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  pgEnum,
  numeric,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { embeddingVectorType } from "./document";

export const brainStatusEnum = pgEnum("brain_status", ["canonical", "candidate"]);
export const riskLevelEnum = pgEnum("risk_level", ["high", "medium", "low"]);
export const ruleTypeEnum = pgEnum("rule_type", [
  "diagnostic",
  "mapping",
  "scoring",
  "warning",
]);
export const brainDomainTagEnum = pgEnum("brain_domain_tag", [
  "seo",
  "geo",
  "aeo",
  "content",
  "entity",
  "general",
]);

export const principlesTable = pgTable("principles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  statement: text("statement").notNull(),
  explanation: text("explanation"),
  domainTag: brainDomainTagEnum("domain_tag").notNull().default("general"),
  confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
  sourceCount: integer("source_count").notNull().default(1),
  sourceRefsJson: text("source_refs_json").notNull().default("[]"),
  status: brainStatusEnum("status").notNull().default("candidate"),
  contested: boolean("contested").notNull().default(false),
  conflictPairId: integer("conflict_pair_id"),
  // HNSW index created via lib/db/migrations/0002_brain_embeddings.sql (not managed by drizzle-kit)
  embeddingVector: embeddingVectorType("embedding_vector", { dimensions: 1536 }),
  negationEmbeddingVector: embeddingVectorType("negation_embedding_vector", { dimensions: 1536 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPrincipleSchema = createInsertSchema(principlesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPrinciple = z.infer<typeof insertPrincipleSchema>;
export type Principle = typeof principlesTable.$inferSelect;

export const rulesTable = pgTable("rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ruleType: ruleTypeEnum("rule_type").notNull().default("diagnostic"),
  ifCondition: text("if_condition").notNull(),
  thenLogic: text("then_logic").notNull(),
  domainTag: brainDomainTagEnum("domain_tag").notNull().default("general"),
  confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
  sourceRefsJson: text("source_refs_json").notNull().default("[]"),
  status: brainStatusEnum("status").notNull().default("candidate"),
  contested: boolean("contested").notNull().default(false),
  conflictPairId: integer("conflict_pair_id"),
  // HNSW index created via lib/db/migrations/0002_brain_embeddings.sql (not managed by drizzle-kit)
  embeddingVector: embeddingVectorType("embedding_vector", { dimensions: 1536 }),
  negationEmbeddingVector: embeddingVectorType("negation_embedding_vector", { dimensions: 1536 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRuleSchema = createInsertSchema(rulesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertRule = z.infer<typeof insertRuleSchema>;
export type Rule = typeof rulesTable.$inferSelect;

export const antiPatternsTable = pgTable("anti_patterns", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  signalsJson: text("signals_json").notNull().default("[]"),
  domainTag: brainDomainTagEnum("domain_tag").notNull().default("general"),
  riskLevel: riskLevelEnum("risk_level").notNull().default("medium"),
  sourceRefsJson: text("source_refs_json").notNull().default("[]"),
  status: brainStatusEnum("status").notNull().default("candidate"),
  contested: boolean("contested").notNull().default(false),
  conflictPairId: integer("conflict_pair_id"),
  // HNSW index created via lib/db/migrations/0002_brain_embeddings.sql (not managed by drizzle-kit)
  embeddingVector: embeddingVectorType("embedding_vector", { dimensions: 1536 }),
  negationEmbeddingVector: embeddingVectorType("negation_embedding_vector", { dimensions: 1536 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAntiPatternSchema = createInsertSchema(antiPatternsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAntiPattern = z.infer<typeof insertAntiPatternSchema>;
export type AntiPattern = typeof antiPatternsTable.$inferSelect;

export const playbooksTable = pgTable("playbooks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  summary: text("summary").notNull(),
  useWhen: text("use_when"),
  avoidWhen: text("avoid_when"),
  expectedOutcomes: text("expected_outcomes"),
  domainTag: brainDomainTagEnum("domain_tag").notNull().default("general"),
  confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
  sourceRefsJson: text("source_refs_json").notNull().default("[]"),
  status: brainStatusEnum("status").notNull().default("candidate"),
  contested: boolean("contested").notNull().default(false),
  conflictPairId: integer("conflict_pair_id"),
  // HNSW index created via lib/db/migrations/0002_brain_embeddings.sql (not managed by drizzle-kit)
  embeddingVector: embeddingVectorType("embedding_vector", { dimensions: 1536 }),
  negationEmbeddingVector: embeddingVectorType("negation_embedding_vector", { dimensions: 1536 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPlaybookSchema = createInsertSchema(playbooksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPlaybook = z.infer<typeof insertPlaybookSchema>;
export type Playbook = typeof playbooksTable.$inferSelect;

export const playbookStepsTable = pgTable("playbook_steps", {
  id: serial("id").primaryKey(),
  playbookId: integer("playbook_id")
    .notNull()
    .references(() => playbooksTable.id, { onDelete: "cascade" }),
  stepOrder: integer("step_order").notNull(),
  stepTitle: text("step_title").notNull(),
  stepDescription: text("step_description"),
});

export const insertPlaybookStepSchema = createInsertSchema(playbookStepsTable).omit({
  id: true,
});
export type InsertPlaybookStep = z.infer<typeof insertPlaybookStepSchema>;
export type PlaybookStep = typeof playbookStepsTable.$inferSelect;

export const examplesTable = pgTable("examples", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  domainTag: brainDomainTagEnum("domain_tag").notNull().default("general"),
  sourceRefsJson: text("source_refs_json").notNull().default("[]"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertExampleSchema = createInsertSchema(examplesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertExample = z.infer<typeof insertExampleSchema>;
export type Example = typeof examplesTable.$inferSelect;
