import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const brandsTable = pgTable("brands", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  icpDescription: text("icp_description"),
  positioningStatement: text("positioning_statement"),
  targetGeographiesJson: text("target_geographies_json"),
  productTruthsJson: text("product_truths_json"),
  toneDescriptorsJson: text("tone_descriptors_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBrandSchema = createInsertSchema(brandsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBrand = z.infer<typeof insertBrandSchema>;
export type Brand = typeof brandsTable.$inferSelect;

export const competitorsTable = pgTable("competitors", {
  id: serial("id").primaryKey(),
  brandId: integer("brand_id")
    .notNull()
    .references(() => brandsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCompetitorSchema = createInsertSchema(competitorsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCompetitor = z.infer<typeof insertCompetitorSchema>;
export type Competitor = typeof competitorsTable.$inferSelect;
