import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { validateEmbedding, OllamaEmbeddingService, OpenAICompatibleEmbeddingService } from '../dist/embeddings.js';

const vector = [1, ...Array(1023).fill(0)];
test('embedding validation accepts only finite nonzero 1024-dimensional vectors', () => {
  assert.deepEqual(validateEmbedding(vector), vector);
  for (const value of [null, [], Array(768).fill(1), Array(1024).fill(0), [...vector.slice(0, -1), NaN], [...vector.slice(0, -1), Infinity], [...vector.slice(0, -1), '1'], Array(1024).fill(1e100), Array(1024).fill(1e-100)]) {
    assert.throws(() => validateEmbedding(value), /invalid vector/);
  }
});

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('Ollama sends role prefix and validates response', async () => {
  await withServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(req.url, '/api/embed');
    assert.match(JSON.parse(body).input, /^Represent this offer/);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ embeddings: [vector] }));
  }, async url => assert.deepEqual(await new OllamaEmbeddingService(url, 'test').embed('hello', 'offer'), vector));
});

test('OpenAI-compatible provider uses expected endpoint, prefix and response shape', async () => {
  await withServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(req.url, '/v1/embeddings');
    assert.equal(req.headers.authorization, 'Bearer test-fixture');
    assert.match(JSON.parse(body).input, /^Represent this want/);
    res.end(JSON.stringify({ data: [{ embedding: vector }] }));
  }, async url => assert.deepEqual(await new OpenAICompatibleEmbeddingService(url, 'test-fixture', 'test').embed('hello', 'want'), vector));
});

test('provider errors do not expose response bodies', async () => {
  await withServer((_req, res) => { res.writeHead(500); res.end('private-provider-detail'); }, async url => {
    await assert.rejects(new OllamaEmbeddingService(url, 'test').embed('hello', 'offer'), error => {
      assert.match(error.message, /unavailable/);
      assert.ok(!error.message.includes('private-provider-detail')); return true;
    });
  });
});

test('malformed provider output is rejected', async () => {
  await withServer((_req, res) => res.end(JSON.stringify({ embeddings: [[]] })), async url => {
    await assert.rejects(new OllamaEmbeddingService(url, 'test').embed('hello', 'offer'), /invalid vector/);
  });
});

test('embedding request has a real deadline', async () => {
  await withServer(() => {}, async url => {
    await assert.rejects(new OllamaEmbeddingService(url, 'test', 50).embed('hello', 'offer'), /timed out/);
  });
});
