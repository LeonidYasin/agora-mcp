-- agora-mcp: initial schema (Stage 0)
-- Requires the pgvector extension.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

CREATE TABLE users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id  TEXT UNIQUE NOT NULL, -- e.g. telegram id or oauth subject
    display_name TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE item_type AS ENUM ('offer', 'want');

-- Embedding dimension depends on the chosen model (e.g. 1024 for bge-m3 /
-- multilingual-e5-large). Adjust before running in a real environment.
CREATE TABLE items (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       item_type NOT NULL,
    raw_text   TEXT NOT NULL,
    category   TEXT,
    tags       TEXT[],
    embedding  vector(1024),
    active     BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX items_user_id_idx ON items(user_id);
CREATE INDEX items_type_idx ON items(type);
CREATE INDEX items_category_idx ON items(category);
CREATE INDEX items_active_idx ON items(active);

-- Approximate nearest-neighbor index for cosine similarity search.
CREATE INDEX items_embedding_hnsw_idx ON items
    USING hnsw (embedding vector_cosine_ops);

-- Suggested/confirmed matches between a want and an offer.
CREATE TABLE matches (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    want_item_id  UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    score         FLOAT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'suggested', -- suggested | contacted | completed | rejected
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (offer_item_id, want_item_id)
);

CREATE INDEX matches_offer_item_idx ON matches(offer_item_id);
CREATE INDEX matches_want_item_idx ON matches(want_item_id);
