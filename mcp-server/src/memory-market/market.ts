import { randomUUID } from 'node:crypto';

export class MarketError extends Error {
  constructor(public readonly code: string, public readonly retryAfterMs?: number) {
    super(code);
  }
}

type Kind = 'offer' | 'want';
type Listing = { id: string; sequence: number; market: string; kind: Kind; text: string;
  owner: string; created_at: number; expires_at: number };
type Reply = { id: string; sequence: number; listing_id: string; text: string;
  owner: string; created_at: number; expires_at: number };
export const LIMITS = Object.freeze({ text: 500, markets: 16, principals: 100,
  listings: 1000, replies: 5000, perOwner: 20, perListingReplies: 50,
  cadenceMs: 10_000, ttlMs: 86_400_000, page: 100 });
const DEFAULT_MARKETS = ['general', 'development', 'learning', 'goods', 'housing'];

/** Single-process, non-durable experiment. Published text is untrusted data. */
export class MemoryMarket {
  private readonly epoch = randomUUID();
  private sequence = 0;
  private readonly listings = new Map<string, Listing>();
  private readonly replies = new Map<string, Reply>();
  private readonly lastWrite = new Map<string, number>();
  private readonly markets: readonly string[];
  private readonly principals: ReadonlySet<string>;
  constructor(principals: string[], private readonly clock: () => number = Date.now,
              markets: string[] = DEFAULT_MARKETS) {
    if (!principals.length || principals.length > LIMITS.principals ||
        new Set(principals).size !== principals.length ||
        principals.some(p => !/^[A-Za-z0-9_-]{1,64}$/.test(p))) throw new MarketError('invalid_principals');
    if (!markets.length || markets.length > LIMITS.markets || new Set(markets).size !== markets.length ||
        markets.some(m => !/^[a-z0-9-]{1,32}$/.test(m))) throw new MarketError('invalid_markets');
    this.principals = new Set(principals);
    this.markets = [...markets];
  }
  private auth(owner: string) {
    if (!this.principals.has(owner)) throw new MarketError('unauthorized');
  }
  private market(name: string) {
    if (!this.markets.includes(name)) throw new MarketError('unknown_market');
  }
  private text(value: string) {
    if (typeof value !== 'string') throw new MarketError('invalid_text');
    const text = value.normalize('NFC').trim();
    if (!text || Array.from(text).length > LIMITS.text || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))
      throw new MarketError('invalid_text');
    return text;
  }
  private prune(now: number) {
    for (const [id, item] of this.listings) if (item.expires_at <= now) this.listings.delete(id);
    for (const [id, reply] of this.replies)
      if (reply.expires_at <= now || !this.listings.has(reply.listing_id)) this.replies.delete(id);
  }
  private cadence(owner: string, now: number) {
    const previous = this.lastWrite.get(owner);
    if (previous !== undefined && now - previous < LIMITS.cadenceMs)
      throw new MarketError('rate_limited', LIMITS.cadenceMs - (now - previous));
  }
  private page<T extends { sequence: number }>(items: T[], scope: string, cursor?: string, limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.page) throw new MarketError('invalid_limit');
    let after = 0;
    if (cursor !== undefined) {
      if (typeof cursor !== 'string' || cursor.length > 200) throw new MarketError('invalid_cursor');
      const parts = cursor.split(':');
      if (parts.length !== 3 || parts[0] !== this.epoch || parts[1] !== scope || !/^(0|[1-9][0-9]*)$/.test(parts[2]))
        throw new MarketError('invalid_cursor');
      after = Number(parts[2]);
      if (!Number.isSafeInteger(after) || after > this.sequence) throw new MarketError('invalid_cursor');
    }
    const eligible = items.filter(item => item.sequence > after);
    const selected = eligible.slice(0, limit).map(item => ({ ...item }));
    const next = selected.at(-1)?.sequence ?? after;
    return { items: selected, next_cursor: `${this.epoch}:${scope}:${next}`,
      has_more: eligible.length > selected.length, history_complete: false,
      retention: 'active_window_only', durable: false };
  }
  listMarkets(owner: string) {
    this.auth(owner);
    const now = this.clock(); this.prune(now);
    return { markets: this.markets.map(id => ({ id,
      active_listings: [...this.listings.values()].filter(item => item.market === id).length })),
      limits: { ...LIMITS }, durable: false };
  }
  publish(owner: string, market: string, kind: Kind, value: string) {
    this.auth(owner); this.market(market);
    if (kind !== 'offer' && kind !== 'want') throw new MarketError('invalid_kind');
    const text = this.text(value), now = this.clock(); this.prune(now);
    this.cadence(owner, now);
    const owned = [...this.listings.values()].filter(item => item.owner === owner);
    if (owned.some(item => item.market === market && item.kind === kind && item.text.toLocaleLowerCase() === text.toLocaleLowerCase()))
      throw new MarketError('duplicate_listing');
    if (owned.length >= LIMITS.perOwner) throw new MarketError('owner_capacity');
    if (this.listings.size >= LIMITS.listings) throw new MarketError('market_capacity');
    const listing: Listing = { id: randomUUID(), sequence: ++this.sequence, market, kind, text,
      owner, created_at: now, expires_at: now + LIMITS.ttlMs };
    this.listings.set(listing.id, listing); this.lastWrite.set(owner, now);
    return { listing: { ...listing }, durable: false };
  }
  read(owner: string, market: string, options: { kind?: Kind; listing_id?: string; cursor?: string; limit?: number } = {}) {
    this.auth(owner); this.market(market);
    if (options.kind !== undefined && options.kind !== 'offer' && options.kind !== 'want') throw new MarketError('invalid_kind');
    const now = this.clock(); this.prune(now);
    if (options.listing_id !== undefined) {
      if (options.kind !== undefined) throw new MarketError('ambiguous_read_scope');
      const listing = this.listings.get(options.listing_id);
      if (!listing || listing.market !== market) throw new MarketError('listing_unavailable');
      return { listing: { ...listing }, ...this.page([...this.replies.values()].filter(r => r.listing_id === listing.id),
        `reply-${listing.id}`, options.cursor, options.limit) };
    }
    return this.page([...this.listings.values()].filter(item => item.market === market &&
      (options.kind === undefined || item.kind === options.kind)), `feed-${market}-${options.kind ?? 'all'}`, options.cursor, options.limit);
  }
  reply(owner: string, listingId: string, value: string) {
    this.auth(owner);
    const text = this.text(value), now = this.clock(); this.prune(now);
    const listing = this.listings.get(listingId);
    if (!listing) throw new MarketError('listing_unavailable');
    if (listing.owner === owner) throw new MarketError('self_reply_not_allowed');
    this.cadence(owner, now);
    const previous = [...this.replies.values()].filter(reply => reply.listing_id === listingId);
    if (previous.some(reply => reply.owner === owner && reply.text.toLocaleLowerCase() === text.toLocaleLowerCase()))
      throw new MarketError('duplicate_reply');
    if (previous.length >= LIMITS.perListingReplies) throw new MarketError('thread_capacity');
    if (this.replies.size >= LIMITS.replies) throw new MarketError('reply_capacity');
    const reply: Reply = { id: randomUUID(), sequence: ++this.sequence, listing_id: listingId, text,
      owner, created_at: now, expires_at: listing.expires_at };
    this.replies.set(reply.id, reply); this.lastWrite.set(owner, now);
    return { reply: { ...reply }, durable: false };
  }
  withdraw(owner: string, listingId: string) {
    this.auth(owner); this.prune(this.clock());
    const listing = this.listings.get(listingId);
    if (!listing || listing.owner !== owner) throw new MarketError('listing_unavailable_or_not_yours');
    this.listings.delete(listingId);
    for (const [id, reply] of this.replies) if (reply.listing_id === listingId) this.replies.delete(id);
    // Withdrawal is never rate-limited: users must be able to remove their data.
    return { withdrawn: true, durable: false };
  }
}
