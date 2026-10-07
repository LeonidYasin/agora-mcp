/**
 * Wire-format shapes shared across the author's project ecosystem
 * (NoKing, Civis, synapse, synapse2, agora-mcp, mcp-server) — see
 * docs/synapse-protocol.md ("Synapse Protocol v0") for the canonical
 * schema. This file maps agora-mcp's internal Postgres rows onto that
 * shared JSON shape, so tool output stays interoperable even though the
 * internal column names (raw_text, user_id, ...) differ from the
 * protocol's field names (text, owner_id, ...).
 *
 * agora-mcp's own DB schema is NOT changed to match the protocol
 * verbatim — only what crosses the MCP tool boundary is shaped this way.
 */

export const SYNAPSE_SCHEMA = "synapse/v0" as const;

export interface SynapseItem {
  schema: typeof SYNAPSE_SCHEMA;
  item_id: string;
  type: "offer" | "want";
  owner_id: string;
  text: string;
  category: string | null;
  tags: string[] | null;
  geo: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SynapseMatch {
  schema: typeof SYNAPSE_SCHEMA;
  match_id: string;
  item_a: string; // offer
  item_b: string; // want
  owner_a: string;
  owner_b: string;
  score: number;
  source: "embedding" | "keyword" | "hybrid";
  created_at: string;
  outcome: "unknown" | "accepted" | "rejected" | "exchanged";
}

export interface InternalItemRow {
  id: string;
  user_id: string;
  type: "offer" | "want";
  raw_text: string;
  category: string | null;
  tags: string[] | null;
  geo: string | null;
  active: boolean;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface InternalMatchRow {
  candidate: InternalItemRow;
  match_id: string;
  offer_item_id: string;
  want_item_id: string;
  owner_a: string;
  owner_b: string;
  score: number;
  created_at: string | Date;
  outcome: string;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function toSynapseItem(row: InternalItemRow): SynapseItem {
  return {
    schema: SYNAPSE_SCHEMA,
    item_id: row.id,
    type: row.type,
    owner_id: row.user_id,
    text: row.raw_text,
    category: row.category,
    tags: row.tags,
    geo: row.geo,
    active: row.active,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

const VALID_OUTCOMES: SynapseMatch["outcome"][] = ["unknown", "accepted", "rejected", "exchanged"];

function toOutcome(status: string): SynapseMatch["outcome"] {
  return (VALID_OUTCOMES as string[]).includes(status) ? (status as SynapseMatch["outcome"]) : "unknown";
}

export function toSynapseMatch(row: InternalMatchRow): SynapseMatch {
  return {
    schema: SYNAPSE_SCHEMA,
    match_id: row.match_id,
    item_a: row.offer_item_id,
    item_b: row.want_item_id,
    owner_a: row.owner_a,
    owner_b: row.owner_b,
    score: row.score,
    source: "embedding",
    created_at: toIso(row.created_at),
    outcome: toOutcome(row.outcome),
  };
}
