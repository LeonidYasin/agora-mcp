import pg from "pg";
import type { InternalItemRow, InternalMatchRow } from "./protocol.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function getUserIdByTokenHash(tokenHash: string): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE token_hash = $1`,
    [tokenHash]
  );
  return result.rows[0]?.id ?? null;
}

export async function insertItem(params: {
  userId: string;
  type: "offer" | "want";
  text: string;
  category?: string;
  tags?: string[];
  geo?: string;
  embedding: number[];
}): Promise<string> {
  const { userId, type, text, category, tags, geo, embedding } = params;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO items (user_id, type, raw_text, category, tags, geo, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [userId, type, text, category ?? null, tags ?? null, geo ?? null, JSON.stringify(embedding)]
  );
  return result.rows[0].id;
}

export async function getUserItems(userId: string): Promise<InternalItemRow[]> {
  const result = await pool.query<InternalItemRow>(
    `SELECT id, user_id, type, raw_text, category, tags, geo, active, created_at, updated_at
     FROM items WHERE user_id = $1 AND active = true
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function deactivateItem(userId: string, itemId: string): Promise<void> {
  await pool.query(
    `UPDATE items SET active = false, updated_at = now() WHERE id = $1 AND user_id = $2`,
    [itemId, userId]
  );
}

/**
 * Cross-matches an item against items of the opposite type, ranked by
 * cosine distance (pgvector `<=>` operator), then upserts each candidate
 * into `matches` so outcome/status can evolve later (Stage 2 behavioral
 * feedback hooks into this same row via `outcome`).
 */
export async function searchMatches(params: {
  itemId: string;
  limit: number;
}): Promise<InternalMatchRow[]> {
  const { itemId, limit } = params;

  const candidates = await pool.query<{
    item_id: string;
    owner_user_id: string;
    type: "offer" | "want";
    score: number;
  }>(
    `WITH source AS (
       SELECT embedding, type FROM items WHERE id = $1
     )
     SELECT i.id AS item_id, i.user_id AS owner_user_id, i.type,
            1 - (i.embedding <=> source.embedding) AS score
     FROM items i, source
     WHERE i.active = true
       AND i.type <> source.type
       AND i.id <> $1
     ORDER BY i.embedding <=> source.embedding
     LIMIT $2`,
    [itemId, limit]
  );

  if (candidates.rows.length === 0) return [];

  const sourceRow = await pool.query<{ type: "offer" | "want"; user_id: string }>(
    `SELECT type, user_id FROM items WHERE id = $1`,
    [itemId]
  );
  const source = sourceRow.rows[0];
  if (!source) return [];

  const rows: InternalMatchRow[] = [];
  for (const candidate of candidates.rows) {
    const offerItemId = source.type === "offer" ? itemId : candidate.item_id;
    const wantItemId = source.type === "want" ? itemId : candidate.item_id;
    const ownerA = source.type === "offer" ? source.user_id : candidate.owner_user_id;
    const ownerB = source.type === "want" ? source.user_id : candidate.owner_user_id;

    const upserted = await pool.query<{ id: string; outcome: string; created_at: string }>(
      `INSERT INTO matches (offer_item_id, want_item_id, score, outcome)
       VALUES ($1, $2, $3, 'unknown')
       ON CONFLICT (offer_item_id, want_item_id)
       DO UPDATE SET score = EXCLUDED.score
       RETURNING id, outcome, created_at`,
      [offerItemId, wantItemId, candidate.score]
    );
    const match = upserted.rows[0];

    rows.push({
      match_id: match.id,
      offer_item_id: offerItemId,
      want_item_id: wantItemId,
      owner_a: ownerA,
      owner_b: ownerB,
      score: candidate.score,
      created_at: match.created_at,
      outcome: match.outcome,
    });
  }
  return rows;
}
