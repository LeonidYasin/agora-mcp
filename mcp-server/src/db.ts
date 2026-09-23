import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export interface Item {
  id: string;
  user_id: string;
  type: "offer" | "want";
  raw_text: string;
  category: string | null;
  tags: string[] | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export async function insertItem(params: {
  userId: string;
  type: "offer" | "want";
  text: string;
  category?: string;
  tags?: string[];
  embedding: number[];
}): Promise<string> {
  const { userId, type, text, category, tags, embedding } = params;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO items (user_id, type, raw_text, category, tags, embedding)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [userId, type, text, category ?? null, tags ?? null, JSON.stringify(embedding)]
  );
  return result.rows[0].id;
}

export async function getUserItems(userId: string): Promise<Item[]> {
  const result = await pool.query<Item>(
    `SELECT id, user_id, type, raw_text, category, tags, active, created_at, updated_at
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
 * cosine distance (pgvector `<=>` operator).
 */
export async function searchMatches(params: {
  itemId: string;
  limit: number;
}): Promise<Array<{ item_id: string; owner_user_id: string; text: string; category: string | null; score: number }>> {
  const { itemId, limit } = params;
  const result = await pool.query(
    `WITH source AS (
       SELECT embedding, type FROM items WHERE id = $1
     )
     SELECT i.id AS item_id, i.user_id AS owner_user_id, i.raw_text AS text,
            i.category, 1 - (i.embedding <=> source.embedding) AS score
     FROM items i, source
     WHERE i.active = true
       AND i.type <> source.type
       AND i.id <> $1
     ORDER BY i.embedding <=> source.embedding
     LIMIT $2`,
    [itemId, limit]
  );
  return result.rows;
}
