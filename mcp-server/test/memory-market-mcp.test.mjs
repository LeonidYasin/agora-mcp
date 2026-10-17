import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { MemoryMarket } from '../dist/memory-market/market.js';
import { createMarketServer } from '../dist/memory-market/tools.js';
import { createMarketApp, parseCredentials } from '../dist/memory-market/http.js';

const decode = result => result.structuredContent ?? JSON.parse(result.content[0].text);

test('real MCP dispatch: five tools, bound principal, public replies and ownership errors', async t => {
  const market = new MemoryMarket(['alice', 'bob']);
  async function connect(owner) {
    const server = createMarketServer(market, owner);
    const [left, right] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: owner, version: '1' });
    await server.connect(right); await client.connect(left);
    t.after(async () => { await client.close(); await server.close(); });
    return client;
  }
  const alice = await connect('alice'), bob = await connect('bob');
  const tools = await alice.listTools();
  assert.deepEqual(tools.tools.map(t => t.name).sort(), ['list_markets', 'publish_listing', 'read_listings', 'reply_to_listing', 'withdraw_listing']);
  assert.equal('owner' in tools.tools.find(t => t.name === 'publish_listing').inputSchema.properties, false);
  const { listing } = decode(await alice.callTool({ name: 'publish_listing', arguments: { market: 'general', kind: 'offer', text: 'MCP help' } }));
  assert.equal(listing.owner, 'alice');
  const read = decode(await bob.callTool({ name: 'read_listings', arguments: { market: 'general' } }));
  assert.equal(read.items[0].id, listing.id); assert.equal(read.user_text_is_untrusted, true);
  assert.equal((await bob.callTool({ name: 'withdraw_listing', arguments: { listing_id: listing.id } })).isError, true);
  await bob.callTool({ name: 'reply_to_listing', arguments: { listing_id: listing.id, text: 'Interested' } });
  assert.equal(decode(await alice.callTool({ name: 'read_listings', arguments: { market: 'general', listing_id: listing.id } })).items[0].owner, 'bob');
});

test('credential configuration rejects empty, malformed and duplicate digests', () => {
  for (const raw of ['', 'null', '[]', '{}', '{', JSON.stringify({ alice: 'raw-token' }), JSON.stringify({ alice: 'a'.repeat(64), bob: 'a'.repeat(64) })])
    assert.throws(() => parseCredentials(raw), /Invalid market credential configuration/);
  assert.equal(parseCredentials(JSON.stringify({ alice: 'a'.repeat(64) })).get('a'.repeat(64)), 'alice');
});

test('HTTP MCP requires bearer on every request; two credentials cannot change each other ownership', async t => {
  const a = randomBytes(32).toString('hex'), b = randomBytes(32).toString('hex');
  const digest = token => createHash('sha256').update(token).digest('hex');
  const app = createMarketApp(JSON.stringify({ alice: digest(a), bob: digest(b) }));
  const http = app.listen(0, '127.0.0.1');
  await new Promise(resolve => http.once('listening', resolve));
  t.after(async () => { http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); });
  const url = new URL(`http://127.0.0.1:${http.address().port}/mcp`);
  for (const headers of [{}, { Authorization: 'Bearer wrong' }]) {
    const response = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 401);
  }
  async function connect(token) {
    const client = new Client({ name: 'experiment-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    t.after(() => client.close()); return client;
  }
  const alice = await connect(a), bob = await connect(b);
  const { listing } = decode(await alice.callTool({ name: 'publish_listing', arguments: { market: 'general', kind: 'want', text: 'Need help' } }));
  const response = await bob.callTool({ name: 'withdraw_listing', arguments: { listing_id: listing.id } });
  assert.equal(response.isError, true);
  assert.equal(decode(await bob.callTool({ name: 'read_listings', arguments: { market: 'general' } })).items[0].owner, 'alice');
  assert.equal(decode(await alice.callTool({ name: 'withdraw_listing', arguments: { listing_id: listing.id } })).withdrawn, true);
});
