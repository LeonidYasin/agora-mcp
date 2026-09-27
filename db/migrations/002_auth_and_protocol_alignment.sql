-- agora-mcp: Stage 0 auth + alignment with docs/synapse-protocol.md (synapse/v0)

-- Stage 0 is invite-only (see docs/architecture.md): the founder creates a
-- row per invited user and hands them an opaque bearer token out-of-band.
-- Only the SHA-256 hash of the token is stored.
ALTER TABLE users ADD COLUMN token_hash TEXT UNIQUE;

-- geo is part of the shared item schema (docs/synapse-protocol.md, item.geo)
-- used for optional hybrid-search filtering.
ALTER TABLE items ADD COLUMN geo TEXT;

-- Align match status values with the protocol's `match.outcome` vocabulary
-- (unknown | accepted | rejected | exchanged) so agora-mcp's search_matches
-- output needs no translation layer for the "outcome" field.
ALTER TABLE matches RENAME COLUMN status TO outcome;
ALTER TABLE matches ALTER COLUMN outcome SET DEFAULT 'unknown';
UPDATE matches SET outcome = 'unknown' WHERE outcome = 'suggested';
UPDATE matches SET outcome = 'exchanged' WHERE outcome = 'completed';
UPDATE matches SET outcome = 'accepted' WHERE outcome = 'contacted';
ALTER TABLE matches ADD CONSTRAINT matches_outcome_check
    CHECK (outcome IN ('unknown', 'accepted', 'rejected', 'exchanged'));
