import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryMarket, LIMITS } from '../dist/memory-market/market.js';

const code = expected => error => error.code === expected;

test('global listing/reply capacities refuse without silently dropping retained rows', () => {
  let now = 1_000_000;
  const owners = Array.from({ length: 100 }, (_, i) => `p${i}`);
  const market = new MemoryMarket(owners, () => now);
  const listings = [];
  for (let i = 0; i < LIMITS.listings; i++) {
    listings.push(market.publish(owners[i % 50], 'general', 'offer', `offer${i}`).listing);
    now += LIMITS.cadenceMs;
  }
  assert.throws(() => market.publish('p98', 'general', 'want', 'overflow'), code('market_capacity'));
  const oldest = market.read('p98', 'general', { limit: 1 });
  assert.equal(oldest.items[0].id, listings[0].id);
  for (let i = 0; i < LIMITS.replies; i++) {
    market.reply('p99', listings[Math.floor(i / LIMITS.perListingReplies)].id, `reply${i}`);
    now += LIMITS.cadenceMs;
  }
  assert.throws(() => market.reply('p99', listings[101].id, 'overflow'), code('reply_capacity'));
  assert.equal(market.read('p98', 'general', { listing_id: listings[0].id, limit: 100 }).items.length, 50);
  market.withdraw('p0', listings[0].id);
  market.publish('p98', 'general', 'want', 'new slot');
  market.reply('p99', listings[101].id, 'new reply slot');
  assert.equal(market.read('p98', 'general', { listing_id: listings[101].id }).items.length, 1);
});

test('invalid market configuration, NFC duplicates, reply text and cross-market read rejection', () => {
  for (const rooms of [[], ['general', 'general'], ['bad:scope'], Array.from({ length: 17 }, (_, i) => `m${i}`)])
    assert.throws(() => new MemoryMarket(['alice'], Date.now, rooms), code('invalid_markets'));
  let now = 1_000_000;
  const market = new MemoryMarket(['alice', 'bob'], () => now);
  const item = market.publish('alice', 'general', 'offer', 'cafe\u0301').listing;
  assert.equal(item.text, 'café'); now += LIMITS.cadenceMs;
  assert.throws(() => market.publish('alice', 'general', 'offer', 'CAFÉ'), code('duplicate_listing'));
  assert.throws(() => market.reply('bob', item.id, 'x'.repeat(501)), code('invalid_text'));
  assert.throws(() => market.read('bob', 'development', { listing_id: item.id }), code('listing_unavailable'));
  market.reply('bob', item.id, 'valid');
});
