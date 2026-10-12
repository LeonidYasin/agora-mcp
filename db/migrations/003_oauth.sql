-- MCP OAuth accounts, client registration, and revocable resource-bound tokens.
-- Legacy users.token_hash remains valid for clients that can only send a bearer header.

CREATE TABLE identities (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issuer       TEXT NOT NULL,
    subject      TEXT NOT NULL,
    email        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (issuer, subject)
);

CREATE TABLE oauth_clients (
    client_id                    TEXT PRIMARY KEY,
    client_secret_hash           TEXT,
    client_name                  TEXT NOT NULL,
    redirect_uris                TEXT[] NOT NULL,
    token_endpoint_auth_method   TEXT NOT NULL CHECK (token_endpoint_auth_method IN ('none', 'client_secret_basic', 'client_secret_post')),
    allow_refresh                BOOLEAN NOT NULL DEFAULT true,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE oauth_transactions (
    id              TEXT PRIMARY KEY,
    client_id       TEXT NOT NULL,
    client_name     TEXT NOT NULL,
    redirect_uri    TEXT NOT NULL,
    code_challenge  TEXT NOT NULL,
    resource        TEXT NOT NULL,
    scope           TEXT NOT NULL,
    state           TEXT NOT NULL,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    expires_at      TIMESTAMPTZ NOT NULL,
    consumed_at     TIMESTAMPTZ
);

CREATE TABLE oauth_codes (
    code_hash       TEXT PRIMARY KEY,
    client_id       TEXT NOT NULL,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri    TEXT NOT NULL,
    code_challenge  TEXT NOT NULL,
    resource        TEXT NOT NULL,
    scope           TEXT NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ
);

CREATE TABLE oauth_tokens (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id            TEXT NOT NULL,
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id            TEXT NOT NULL,
    access_token_hash    TEXT NOT NULL UNIQUE,
    refresh_token_hash   TEXT UNIQUE,
    resource             TEXT NOT NULL,
    scope                TEXT NOT NULL,
    access_expires_at    TIMESTAMPTZ NOT NULL,
    refresh_expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at           TIMESTAMPTZ,
    refresh_used_at      TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX oauth_tokens_family_idx ON oauth_tokens(family_id);
