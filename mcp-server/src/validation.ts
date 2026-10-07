import { z } from "zod";

export const submitSchema = {
  text: z.string().trim().min(1).max(8000).describe("Public offer/want text; do not include private credentials or sensitive personal data"),
  category: z.string().trim().min(1).max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  geo: z.string().trim().min(1).max(200).optional().describe("Public free-form location; not yet used as a search filter"),
};
export const itemIdSchema = z.string().uuid().describe("Item UUID");
export const searchSchema = {
  item_id: itemIdSchema,
  limit: z.number().int().positive().max(50).optional(),
};
