import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryMarket, LIMITS } from '../dist/memory-market/market.js';

function fixture() {
  let now = 1_000_000;
  const market = new MemoryMarket(['alice', 'bob']);
  const timed = new MemoryMarket(['alice', 'bob'], () => now);
  return { market: timed, tick: (ms = LIMITS.cadenceMs) => { now += ms; }, fresh: market };
}
const code = value => error => error.code === value;

test('publish/read/reply/withdraw across two owners; no mutation through returned objects', () => {
  const { market } = fixture();
  const { listing } = market.publish('alice', 'development', 'offer', 'Помогу с MCP');
  listing.text = 'tampered';
  const page = market.read('bob', 'development');
  assert.equal(page.items[0].text, 'Помогу с MCP');
  assert.equal(page.durable, false); assert.equal(page.history_complete, false);
  const { reply } = market.reply('bob', listing.id, 'Мне нужно');
  assert.equal(reply.owner, 'bob');
  assert.equal(market.read('alice', 'development', { listing_id: listing.id }).items.length, 1);
  assert.throws(() => market.withdraw('bob', listing.id), code('listing_unavailable_or_not_yours'));
  assert.deepEqual(market.withdraw('alice', listing.id), { withdrawn: true, durable: false });
  assert.equal(market.read('bob', 'development').items.length, 0);
  assert.throws(() => market.reply('bob', listing.id, 'again'), code('listing_unavailable'));
});

test('server principals, market IDs and text bounds cannot be bypassed', () => {
  const { market } = fixture();
  assert.throws(() => market.publish('mallory', 'general', 'offer', 'x'), code('unauthorized'));
  assert.throws(() => market.publish('alice', 'unknown', 'offer', 'x'), code('unknown_market'));
  for (const text of ['', '   ', 'x'.repeat(501), 'x\u0000'])
    assert.throws(() => market.publish('alice', 'general', 'offer', text), code('invalid_text'));
  const value = market.publish('alice', 'general', 'offer', '😀'.repeat(500));
  assert.equal(Array.from(value.listing.text).length, 500);
});

test('shared write cadence, failed operations do not consume cadence; withdrawal always allowed', () => {
  const { market, tick } = fixture();
  const item = market.publish('alice', 'general', 'want', 'x').listing;
  assert.throws(() => market.publish('alice', 'general', 'want', 'y'), code('rate_limited'));
  assert.throws(() => market.reply('alice', item.id, 'self'), code('self_reply_not_allowed'));
  market.reply('bob', item.id, 'hi');
  assert.throws(() => market.publish('bob', 'general', 'offer', 'z'), code('rate_limited'));
  tick();
  assert.throws(() => market.publish('alice', 'general', 'want', 'X'), code('duplicate_listing'));
  market.publish('alice', 'general', 'want', 'y');
  market.withdraw('alice', item.id);
});

test('expiry removes both listing and replies, frees active owner quota', () => {
  const { market, tick } = fixture();
  const item = market.publish('alice', 'general', 'offer', 'x').listing;
  market.reply('bob', item.id, 'hi'); tick(LIMITS.ttlMs);
  assert.equal(market.read('bob', 'general').items.length, 0);
  assert.throws(() => market.read('bob', 'general', { listing_id: item.id }), code('listing_unavailable'));
  market.publish('alice', 'general', 'offer', 'x');
});

test('cursor paging is scoped, bounded, continuous and invalid after restart', () => {
  const { market, tick, fresh } = fixture();
  for (let i = 0; i < 3; i++) { market.publish('alice', 'general', 'offer', `item${i}`); tick(); }
  const first = market.read('bob', 'general', { kind: 'offer', limit: 2 });
  assert.equal(first.items.length, 2); assert.equal(first.has_more, true);
  const second = market.read('bob', 'general', { kind: 'offer', cursor: first.next_cursor });
  assert.equal(second.items.length, 1);
  assert.throws(() => market.read('bob', 'general', { cursor: first.next_cursor }), code('invalid_cursor'));
  assert.throws(() => fresh.read('bob', 'general', { kind: 'offer', cursor: first.next_cursor }), code('invalid_cursor'));
  for (const cursor of ['x'.repeat(201), first.next_cursor.replace(/:[0-9]+$/, ':9007199254740992')])
    assert.throws(() => market.read('bob', 'general', { kind: 'offer', cursor }), code('invalid_cursor'));
  for (const limit of [0, -1, 101, 1.5, NaN]) assert.throws(() => market.read('bob', 'general', { limit }), code('invalid_limit'));
  const idle = market.read('bob', 'general', { kind: 'offer', cursor: second.next_cursor });
  assert.equal(idle.items.length, 0); assert.equal(idle.next_cursor, second.next_cursor);
  market.publish('alice', 'general', 'offer', 'later');
  assert.equal(market.read('bob', 'general', { kind: 'offer', cursor: idle.next_cursor }).items.length, 1);
});

test('owner capacity is explicit and withdrawal frees a slot', () => {
  const { market, tick } = fixture(); let id;
  for (let i = 0; i < LIMITS.perOwner; i++) { id = market.publish('alice', 'general', 'want', `need${i}`).listing.id; tick(); }
  assert.throws(() => market.publish('alice', 'general', 'want', 'overflow'), code('owner_capacity'));
  market.withdraw('alice', id); market.publish('alice', 'general', 'want', 'overflow');
});

test('reply cap and duplicate guard are explicit; filters do not mix cursors', () => {
  const { market, tick } = fixture(); const item = market.publish('alice', 'general', 'offer', 'x').listing;
  market.reply('bob', item.id, 'first'); tick();
  assert.throws(() => market.reply('bob', item.id, 'FIRST'), code('duplicate_reply'));
  for (let i = 1; i < LIMITS.perListingReplies; i++) { market.reply('bob', item.id, `reply${i}`); tick(); }
  assert.throws(() => market.reply('bob', item.id, 'overflow'), code('thread_capacity'));
  assert.throws(() => market.read('bob', 'general', { listing_id: item.id, kind: 'offer' }), code('ambiguous_read_scope'));
  const page = market.read('bob', 'general', { listing_id: item.id });
  assert.throws(() => market.read('bob', 'general', { cursor: page.next_cursor }), code('invalid_cursor'));
});

test('bounded configuration and returned market list are independent', () => {
  for (const people of [[], ['alice', 'alice'], ['bad name'], Array.from({ length: 101 }, (_, i) => `p${i}`)])
    assert.throws(() => new MemoryMarket(people), code('invalid_principals'));
  const { market } = fixture();
  const list = market.listMarkets('alice'); list.markets[0].id = 'tampered';
  assert.equal(market.listMarkets('alice').markets[0].id, 'general');
});
