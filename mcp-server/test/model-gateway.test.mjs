import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { OpenAICompatibleGateway, createChatService } from '../dist/model-gateway.js';
import { createEmbeddingService, OpenAICompatibleEmbeddingService } from '../dist/embeddings.js';
const vector = [1, ...Array(1023).fill(0)];
async function server(handler, fn) {
  const app = http.createServer(handler);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${app.address().port}`); }
  finally { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); }
}
async function body(req) { let text = ''; for await (const chunk of req) text += chunk; return JSON.parse(text); }

test('root, versioned and custom API bases do not duplicate v1', async () => {
  for (const [suffix, expected] of [['', '/v1/embeddings'], ['/v1/', '/v1/embeddings'],
    ['/proxy/v1', '/proxy/v1/embeddings'], ['/custom-api/', '/custom-api/embeddings']]) {
    await server(async (req, res) => {
      assert.equal(req.url, expected);
      assert.equal(req.headers.authorization, 'Bearer fixture-key');
      const data = await body(req);
      assert.equal(data.model, 'embedding-alias'); assert.equal(data.encoding_format, 'float');
      assert.match(data.input, /^Represent this want/);
      res.end(JSON.stringify({ data: [{ embedding: vector }] }));
    }, async url => assert.deepEqual(await new OpenAICompatibleEmbeddingService(
      url + suffix, 'fixture-key', 'embedding-alias').embed('найти врача', 'want'), vector));
  }
});

test('optional chat has independent model/key and bounded output tokens', async () => {
  await server(async (req, res) => {
    const data = await body(req);
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(data.model, 'chat-alias'); assert.equal(data.max_tokens, 120);
    assert.equal(data.stream, false); assert.equal(req.headers.authorization, 'Bearer chat-fixture');
    assert.deepEqual(data.messages, [{ role: 'user', content: 'Привет' }]);
    res.end(JSON.stringify({ choices: [{ message: { content: 'Здравствуйте' } }] }));
  }, async url => {
    const service = createChatService({ LLM_PROVIDER: 'litellm', LLM_BASE_URL: url,
      LLM_MODEL: 'chat-alias', LLM_API_KEY: 'chat-fixture' });
    assert.equal(await service.chat([{ role: 'user', content: 'Привет', extra: 'ignored' }], 120), 'Здравствуйте');
  });
});

test('chat supports configured max_completion_tokens instead of silently sending both fields', async () => {
  await server(async (req, res) => {
    const data = await body(req);
    assert.equal(data.max_completion_tokens, 100); assert.equal(data.max_tokens, undefined);
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  }, async url => assert.equal(await new OpenAICompatibleGateway({ baseUrl: url, model: 'm',
    tokenField: 'max_completion_tokens' }).chat([{ role: 'user', content: 'hi' }], 100), 'ok'));
});

test('explicit configuration, aliases and legacy embedding defaults', () => {
  assert.equal(createChatService({}), null);
  for (const provider of ['openai', 'openai-compatible', 'litellm']) {
    const service = createEmbeddingService({ EMBEDDING_PROVIDER: provider,
      EMBEDDING_BASE_URL: 'https://example.invalid/v1', EMBEDDING_MODEL: 'alias', EMBEDDING_API_KEY: 'fixture' });
    assert.ok(service instanceof OpenAICompatibleEmbeddingService);
  }
  assert.throws(() => createEmbeddingService({ EMBEDDING_PROVIDER: 'litellm', EMBEDDING_MODEL: 'alias',
    EMBEDDING_API_KEY: 'fixture' }), /BASE_URL/);
  assert.throws(() => createEmbeddingService({ EMBEDDING_PROVIDER: 'unknown' }), /Unsupported/);
  assert.throws(() => createChatService({ LLM_PROVIDER: 'unknown' }), /Unsupported/);
  assert.throws(() => createChatService({ LLM_PROVIDER: 'litellm' }), /LLM_BASE_URL/);
  for (const url of ['http://example.com', 'file:///tmp/test', 'https://user:pass@example.com',
    'https://example.com?key=secret', 'https://example.com#fragment'])
    assert.throws(() => new OpenAICompatibleGateway({ baseUrl: url, model: 'm' }), /Invalid model API/);
  for (const options of [{ model: '' }, { timeoutMs: 0 }, { timeoutMs: Infinity }, { apiKey: 'x\ny' },
    { tokenField: 'unsupported' }])
    assert.throws(() => new OpenAICompatibleGateway({ baseUrl: 'https://example.invalid', model: 'm', ...options }));
});

test('invalid requests fail before transport', async () => {
  const gateway = new OpenAICompatibleGateway({ baseUrl: 'https://example.invalid', model: 'm' });
  for (const messages of [[], [{ role: 'tool', content: 'x' }], [{ role: 'user', content: '' }],
    [{ role: 'user', content: 'x'.repeat(64001) }]])
    await assert.rejects(gateway.chat(messages, 1), /Invalid text chat/);
  for (const limit of [0, 8193, NaN, 1.1])
    await assert.rejects(gateway.chat([{ role: 'user', content: 'x' }], limit), /Invalid text chat/);
  await assert.rejects(gateway.embedding(''), /Invalid embedding input/);
});

test('redirects cannot forward credentials to another endpoint', async () => {
  let forwarded = false;
  await server((_req, res) => { forwarded = true; res.end('{}'); }, async target => {
    await server((_req, res) => { res.writeHead(307, { Location: target }); res.end(); }, async url => {
      await assert.rejects(new OpenAICompatibleGateway({ baseUrl: url, model: 'm', apiKey: 'private-fixture' })
        .embedding('text'), /unavailable/);
    });
  });
  assert.equal(forwarded, false);
});

test('HTTP/quota errors never expose provider bodies, retry or fall back', async () => {
  let calls = 0;
  await server((_req, res) => { calls++; res.writeHead(429); res.end('private-response-key'); }, async url => {
    await assert.rejects(new OpenAICompatibleGateway({ baseUrl: url, model: 'm', apiKey: 'private-key' })
      .embedding('text'), error => /unavailable/.test(error.message) && !/private/.test(error.message));
  });
  assert.equal(calls, 1);
});

test('malformed and oversized responses rejected without leaking body', async () => {
  for (const payload of ['not-json', 'x'.repeat(1048577)]) {
    await server((_req, res) => res.end(payload), async url =>
      assert.rejects(new OpenAICompatibleGateway({ baseUrl: url, model: 'm' }).embedding('x'), /unavailable/));
  }
  for (const data of [{}, { choices: [{ message: { content: null } }] },
    { choices: [{ message: { content: 'text', tool_calls: [{}] } }] }]) {
    await server((_req, res) => res.end(JSON.stringify(data)), async url =>
      assert.rejects(new OpenAICompatibleGateway({ baseUrl: url, model: 'm' })
        .chat([{ role: 'user', content: 'hi' }], 10), /unsupported text/));
  }
  await server((_req, res) => res.end(JSON.stringify({ data: [{ embedding: Array(768).fill(1) }] })),
    async url => assert.rejects(new OpenAICompatibleEmbeddingService(url, 'fixture', 'm').embed('x', 'offer'), /invalid vector/));
});

test('timeout bounds stalled response and body', async () => {
  for (const sendHeaders of [false, true]) {
    await server((_req, res) => { if (sendHeaders) { res.writeHead(200); res.write('{'); } }, async url =>
      assert.rejects(new OpenAICompatibleGateway({ baseUrl: url, model: 'm', timeoutMs: 50 }).embedding('x'), /timed out/));
  }
});
