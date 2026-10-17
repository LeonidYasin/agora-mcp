import test from 'node:test';
import assert from 'node:assert/strict';
import { eligiblePool, evaluateRanking, lexicalRanker } from './support/matching-evaluation.mjs';
import { cases, item, NOW } from './fixtures/russian-matching.mjs';

const run = (fixture, overrides = {}) => evaluateRanking({ query: fixture.query,
  candidates: fixture.candidates, now: NOW, method: 'exact-token-jaccard-v1',
  ranker: lexicalRanker, limit: 1, ...overrides });

for (const fixture of cases) {
  test(`RU corpus baseline characterization: ${fixture.id}`, async () => {
    const ids = new Set(fixture.candidates.map(row => row.id));
    assert.ok([...fixture.relevant, ...fixture.incompatible].every(id => ids.has(id)));
    assert.ok(fixture.relevant.every(id => !fixture.incompatible.includes(id)));
    const result = await run(fixture);
    assert.equal(result.results[0]?.id ?? null, fixture.lexicalTop);
    assert.equal(result.exhaustiveSearch, false);
    assert.equal(result.scoreIsProbability, false);
    if (fixture.lexicalTop && !fixture.relevant.includes(fixture.lexicalTop)) {
      // Known deficiency remains visible. This passing regression is NOT semantic success.
      assert.ok(fixture.incompatible.includes(fixture.lexicalTop));
    }
  });
}

test('eligibility gates apply before ranker: kind, owner, room, active, TTL and ID', async () => {
  const query = item('source', 'ремонт', { kind: 'want' });
  const candidates = [item('good', 'ремонт'),
    item('own', 'ремонт', { owner: query.owner }),
    item('same-kind', 'ремонт', { kind: 'want' }),
    item('withdrawn', 'ремонт', { active: false }),
    item('expired', 'ремонт', { expiresAt: NOW }),
    item('other-room', 'ремонт', { market: 'housing' }),
    item(query.id, 'ремонт', { owner: 'someone-else' })];
  let called = false;
  const result = await run({ query, candidates }, { ranker: (source, pool) => {
    called = true;
    assert.deepEqual(pool.map(row => row.id), ['good']);
    assert.ok(Object.isFrozen(source) && Object.isFrozen(pool) && Object.isFrozen(pool[0]));
    assert.equal(source.relevant, undefined);
    return [{ id: 'good', score: 0.6 }];
  } });
  assert.ok(called);
  assert.equal(result.eligibleCount, 1);
});

test('all-ineligible pool returns empty without invoking ranker', async () => {
  const query = item('source', 'ремонт', { kind: 'want' });
  const result = await run({ query, candidates: [item('want', 'ремонт', { kind: 'want' })] },
    { ranker: () => { throw new Error('must not call'); } });
  assert.deepEqual(result.results, []);
});

test('rejects malformed records, duplicate IDs, invalid clock, pool and limit', async () => {
  const fixture = cases[0];
  for (const overrides of [{ now: NaN }, { limit: 0 }, { limit: 51 }, { limit: 1.1 },
    { candidates: [item('dup', 'x'), item('dup', 'y')] },
    { candidates: [item('bad', 'x', { kind: 'unknown' })] },
    { candidates: [item('bad', 'x', { expiresAt: Infinity })] },
    { candidates: [item('bad', '')] }, { candidates: Array(1001).fill(item('x', 'x')) }])
    await assert.rejects(run(fixture, overrides));
  for (const overrides of [{ active: false }, { expiresAt: NOW }])
    assert.throws(() => eligiblePool({ ...fixture.query, ...overrides }, [], NOW), /unavailable_query/);
});

test('rejects invented, excluded, repeated IDs and non-finite scores, including hidden tail', async () => {
  const fixture = { query: item('q', 'ремонт', { kind: 'want' }),
    candidates: [item('a', 'ремонт'), item('b', 'ремонт'), item('excluded', 'ремонт', { kind: 'want' })] };
  for (const rows of [null, [{ id: 'invented', score: 1 }], [{ id: 'excluded', score: 1 }],
    [{ id: 'a', score: NaN }], [{ id: 'a', score: Infinity }],
    [{ id: 'a', score: '0.5' }], [{ id: 'a', score: 1 }, { id: 'a', score: 0.9 }],
    [{ id: 'a', score: 1 }, { id: 'invented', score: 0.9 }]])
    await assert.rejects(run(fixture, { ranker: async () => rows }), /invalid_ranking/);
});

test('ranker errors propagate; provider failure must not become a successful empty result', async () => {
  await assert.rejects(run(cases[0], { ranker: async () => { throw new Error('quota_exhausted'); } }),
    /quota_exhausted/);
});

test('rank order preserved, finite negative scores allowed, inputs unchanged', async () => {
  const fixture = cases[0], before = structuredClone(fixture);
  const result = await run(fixture, { limit: 2,
    ranker: () => [{ id: 'pizza', score: -0.1 }, { id: 'bike', score: -0.5 }] });
  assert.deepEqual(result.results.map(row => row.id), ['pizza', 'bike']);
  assert.deepEqual(fixture, before);
});

test('lexical ties deterministic and unrelated text may produce no results', () => {
  const query = item('q', 'текст');
  assert.deepEqual(lexicalRanker(query, [item('z', 'текст'), item('a', 'текст')])
    .map(row => row.id), ['a', 'z']);
  assert.deepEqual(lexicalRanker(query, [item('x', 'дерево')]), []);
});
