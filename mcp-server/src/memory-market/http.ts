import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MemoryMarket, LIMITS } from './market.js';
import { createMarketServer } from './tools.js';

export function parseCredentials(raw: string | undefined): Map<string, string> {
  if (!raw || raw.length > 20000) throw new Error('Invalid market credential configuration');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Invalid market credential configuration'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid market credential configuration');
  const rows = Object.entries(value);
  if (!rows.length || rows.length > LIMITS.principals) throw new Error('Invalid market credential configuration');
  const credentials = new Map<string, string>();
  for (const [principal, digest] of rows) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(principal) || typeof digest !== 'string' ||
        !/^[0-9a-f]{64}$/.test(digest) || credentials.has(digest)) throw new Error('Invalid market credential configuration');
    credentials.set(digest, principal);
  }
  return credentials;
}

/** Separate loopback app; importing never starts a listener or touches PostgreSQL. */
export function createMarketApp(rawCredentials: string) {
  const credentials = parseCredentials(rawCredentials);
  const market = new MemoryMarket([...credentials.values()]);
  const app = createMcpExpressApp({ host: '127.0.0.1' });
  app.post('/mcp', async (req, res) => {
    const header = req.headers.authorization;
    const match = typeof header === 'string' && header.length <= 1024 ? /^Bearer ([^\s]+)$/i.exec(header) : null;
    const principal = match ? credentials.get(createHash('sha256').update(match[1]).digest('hex')) : undefined;
    if (!principal) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'unauthorized' }); return;
    }
    const server = createMarketServer(market, principal);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
      void transport.close(); void server.close();
    }
  });
  app.get('/mcp', (_req, res) => { res.status(405).json({ error: 'method_not_allowed' }); });
  app.get('/health', (_req, res) => { res.json({ ok: true, experiment: true, durable: false }); });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.AGORA_MEMORY_MARKET !== '1') throw new Error('Experiment requires AGORA_MEMORY_MARKET=1');
  const app = createMarketApp(process.env.AGORA_MARKET_TOKENS_JSON ?? '');
  const http = app.listen(3012, '127.0.0.1', () => console.log('Agora memory-market experiment: loopback port 3012; non-durable'));
  const shutdown = () => { http.close(); http.closeIdleConnections(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
