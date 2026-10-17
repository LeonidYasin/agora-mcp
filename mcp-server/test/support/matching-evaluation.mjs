/** Offline evaluation only. Not imported by the MCP server; no IO or provider calls. */
const MAX_POOL = 1000;
function listing(value) {
  if (!value || typeof value !== 'object') throw new Error('invalid_listing');
  for (const key of ['id', 'owner', 'market']) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 128)
      throw new Error('invalid_listing');
  }
  if (!['offer', 'want'].includes(value.kind) || typeof value.active !== 'boolean' ||
      typeof value.text !== 'string' || !value.text.trim() || value.text.length > 8000 ||
      !Number.isSafeInteger(value.expiresAt)) throw new Error('invalid_listing');
  return Object.freeze({ id: value.id, owner: value.owner, market: value.market,
    kind: value.kind, active: value.active, text: value.text, expiresAt: value.expiresAt });
}

/** These are corpus gates, not authorization. Production must load an authorized query. */
export function eligiblePool(query, candidates, now) {
  if (!Number.isSafeInteger(now)) throw new Error('invalid_clock');
  const source = listing(query);
  if (!source.active || source.expiresAt <= now) throw new Error('unavailable_query');
  if (!Array.isArray(candidates) || candidates.length > MAX_POOL) throw new Error('invalid_pool');
  const rows = candidates.map(listing), seen = new Set();
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error('duplicate_candidate');
    seen.add(row.id);
  }
  return Object.freeze(rows.filter(row => row.id !== source.id && row.owner !== source.owner &&
    row.market === source.market && row.kind !== source.kind && row.active && row.expiresAt > now));
}

function tokens(text) {
  return new Set(text.normalize('NFC').toLowerCase().replaceAll('ё', 'е')
    .match(/[\p{L}\p{N}]+/gu) ?? []);
}

/** Deliberately weak exact-token baseline: no stemming, synonyms or negation parsing. */
export function lexicalRanker(query, candidates) {
  const q = tokens(query.text);
  return candidates.map(row => {
    const words = tokens(row.text);
    const common = [...q].filter(word => words.has(word)).length;
    const union = new Set([...q, ...words]).size;
    return { id: row.id, score: union ? common / union : 0 };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Ranker sees only frozen query + eligible records, never corpus relevance labels. */
export async function evaluateRanking({ query, candidates, now, limit = 5, method, ranker }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('invalid_limit');
  if (typeof method !== 'string' || !method.trim() || method.length > 100 || typeof ranker !== 'function')
    throw new Error('invalid_ranker');
  const source = listing(query), pool = eligiblePool(source, candidates, now);
  const raw = pool.length ? await ranker(source, pool) : [];
  if (!Array.isArray(raw) || raw.length > pool.length) throw new Error('invalid_ranking');
  const allowed = new Set(pool.map(row => row.id)), seen = new Set();
  for (const row of raw) {
    if (!row || typeof row.id !== 'string' || !allowed.has(row.id) || seen.has(row.id) ||
        typeof row.score !== 'number' || !Number.isFinite(row.score)) throw new Error('invalid_ranking');
    seen.add(row.id);
  }
  // Validate the entire response before truncation; invalid hidden tail must fail too.
  const results = raw.slice(0, limit).map(row => ({ id: row.id, score: row.score }));
  return { method, results, eligibleCount: pool.length, returnedCount: results.length,
    evaluatedScope: 'supplied_eligible_pool', exhaustiveSearch: false,
    scoreIsProbability: false };
}
