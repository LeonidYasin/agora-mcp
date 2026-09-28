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

/**
 * Returns true only if a row actually changed — i.e. the item exists, belongs
 * to `userId`, and was still active. Callers must not report success for a no-op.
 */
export async function deactivateItem(userId: string, itemId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE items SET active = false, updated_at = now()
     WHERE id = $1 AND user_id = $2 AND active = true`,
    [itemId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Cross-matches one of the caller's own items against OTHER users' items of the
 * opposite type, ranked by cosine distance (pgvector `<=>`), then upserts each
 * candidate into `matches` so `outcome` can evolve later (Stage 1/2 behavioral
 * feedback writes to this same row).
 *
 * Returns null when the item doesn't exist, isn't active, or isn't owned by
 * `userId` — deliberately indistinguishable, so callers can't probe for other
 * users' item ids. A user's own items are never returned as candidates.
 */
export async function searchMatches(params: {
  userId: string;
  itemId: string;
  limit: number;
}): Promise<InternalMatchRow[] | null> {
  const { userId, itemId, limit } = params;

  const sourceRow = await pool.query<{ type: "offer" | "want" }>(
    `SELECT type FROM items WHERE id = $1 AND user_id = $2 AND active = true`,
    [itemId, userId]
  );
  const source = sourceRow.rows[0];
  if (!source) return null;

  // GREATEST(0, ...): cosine similarity can be negative for some models, but the
  // synapse/v0 `match.score` contract is [0, 1].
  const candidates = await pool.query<{
    item_id: string;
    owner_user_id: string;
    score: number;
  }>(
    `SELECT i.id AS item_id, i.user_id AS owner_user_id,
            GREATEST(0, 1 - (i.embedding <=> s.embedding)) AS score
     FROM items i, (SELECT embedding FROM items WHERE id = $1) s
     WHERE i.active = true
       AND i.type <> $3::item_type
       AND i.user_id <> $2
     ORDER BY i.embedding <=> s.embedding
     LIMIT $4`,
    [itemId, userId, source.type, limit]
  );

  const rows: InternalMatchRow[] = [];
  for (const candidate of candidates.rows) {
    const offerItemId = source.type === "offer" ? itemId : candidate.item_id;
    const wantItemId = source.type === "want" ? itemId : candidate.item_id;
    const ownerA = source.type === "offer" ? userId : candidate.owner_user_id;
    const ownerB = source.type === "want" ? userId : candidate.owner_user_id;

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
