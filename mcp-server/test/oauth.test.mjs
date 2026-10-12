import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { pkceS256, readOAuthConfig, validateRedirectUri, canonicalResource, isPrivateAddress, wwwAuthenticate } from '../dist/oauth-core.js';
import { MemoryOAuthStore } from '../dist/oauth-memory.js';
import { mountOAuth } from '../dist/oauth-http.js';

const redirect = 'http://127.0.0.1:9/callback';

test('redirect and resource validation rejects open redirects and foreign resources', () => {
  assert.equal(validateRedirectUri('javascript:alert(1)'), null);
  assert.equal(validateRedirectUri('http://example.com/callback'), null);
  assert.equal(validateRedirectUri('https://client.example/callback#frag'), null);
  assert.equal(validateRedirectUri(redirect), redirect);
  const expected = 'https://agora.example/agora/mcp';
  assert.equal(canonicalResource('https://Agora.example/agora/mcp/', expected), expected);
  assert.equal(canonicalResource('https://agora.example/other/mcp', expected), null);
  assert.equal(isPrivateAddress('169.254.169.254'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});

test('PKCE S256 matches only the original verifier', () => {
  const verifier = 'a'.repeat(43);
  assert.equal(pkceS256(verifier).length > 40, true);
  assert.notEqual(pkceS256(verifier), pkceS256('b'.repeat(43)));
});

test('public base URL accepts the shared prefix and rejects insecure public hosts', () => {
  const config = readOAuthConfig({ AGORA_PUBLIC_BASE_URL: 'https://leonid-mcp.duckdns.org/agora/' });
  assert.equal(config.resource, 'https://leonid-mcp.duckdns.org/agora/mcp');
  assert.equal(config.metadataUrl, 'https://leonid-mcp.duckdns.org/agora/.well-known/oauth-protected-resource');
  assert.equal(config.cookiePath, '/agora');
  assert.equal(readOAuthConfig({ AGORA_PUBLIC_BASE_URL: 'http://agora.example' }), null);
  assert.match(wwwAuthenticate(config), /resource_metadata="https:\/\/leonid-mcp\.duckdns\.org\/agora\/\.well-known\/oauth-protected-resource"/);
});

test('OAuth login creates separate owners and does not return a token before consent', async () => {
  const config = readOAuthConfig({ AGORA_PUBLIC_BASE_URL: 'http://127.0.0.1:9' });
  const store = new MemoryOAuthStore();
  const app = express();
  app.use(express.json());
  mountOAuth(app, {
    config,
    store,
    identity: {
      authorizationUrl: (state) => `https://accounts.google.example/auth?state=${encodeURIComponent(state)}`,
      exchange: async (code) => ({ issuer: 'https://accounts.google.com', subject: code, displayName: code, email: null }),
    },
    fetchMetadata: async () => ({ client_id: 'https://client.example/metadata.json', client_name: 'Example', redirect_uris: [redirect], token_endpoint_auth_method: 'none' }),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const metadata = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
    assert.equal(metadata.resource, config.resource);
    assert.deepEqual(metadata.authorization_servers, [config.issuer]);
    const asMetadata = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    assert.deepEqual(asMetadata.code_challenge_methods_supported, ['S256']);
    assert.equal(asMetadata.client_id_metadata_document_supported, true);

    const registered = await fetch(`${base}/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Test client', redirect_uris: [redirect], token_endpoint_auth_method: 'none' }),
    });
    assert.equal(registered.status, 201);
    const client = await registered.json();
    const verifier = 'verifier-value-with-enough-length-1234567890';
    const challenge = pkceS256(verifier);
    const resource = encodeURIComponent(config.resource);
    const start = await fetch(`${base}/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256&resource=${resource}&state=client-state&scope=agora:use`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    const cookie = start.headers.get('set-cookie').split(';')[0];
    const tx = new URL(start.headers.get('location')).searchParams.get('state');
    const callback = await fetch(`${base}/oauth/google/callback?code=google-user-b&state=${tx}`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(callback.status, 200);
    assert.match(await callback.text(), /Разрешить/);
    const consent = await fetch(`${base}/oauth/consent`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: `tx=${tx}&decision=allow`, redirect: 'manual',
    });
    const granted = new URL(consent.headers.get('location'));
    assert.equal(granted.searchParams.get('state'), 'client-state');
    const code = granted.searchParams.get('code');
    const first = await tokenRequest(base, { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, redirect_uri: redirect, resource: config.resource });
    assert.equal(first.status, 200);
    const tokens = await first.json();
    assert.equal(tokens.token_type, 'Bearer');
    assert.ok(tokens.refresh_token);
    const replay = await tokenRequest(base, { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, redirect_uri: redirect, resource: config.resource });
    assert.equal(replay.status, 400);

    const refreshed = await tokenRequest(base, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id, resource: config.resource });
    assert.equal(refreshed.status, 200);
    const nextTokens = await refreshed.json();
    const reused = await tokenRequest(base, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id, resource: config.resource });
    assert.equal(reused.status, 400);
    const familyRevoked = await tokenRequest(base, { grant_type: 'refresh_token', refresh_token: nextTokens.refresh_token, client_id: client.client_id, resource: config.resource });
    assert.equal(familyRevoked.status, 400);

    const secondStart = await fetch(`${base}/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256&resource=${resource}&state=other`, { redirect: 'manual' });
    const secondCookie = secondStart.headers.get('set-cookie').split(';')[0];
    const secondTx = new URL(secondStart.headers.get('location')).searchParams.get('state');
    await fetch(`${base}/oauth/google/callback?code=google-user-c&state=${secondTx}`, { headers: { cookie: secondCookie } });
    const secondConsent = await fetch(`${base}/oauth/consent`, {
      method: 'POST', headers: { cookie: secondCookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: `tx=${secondTx}&decision=allow`, redirect: 'manual',
    });
    const secondCode = new URL(secondConsent.headers.get('location')).searchParams.get('code');
    await tokenRequest(base, { grant_type: 'authorization_code', code: secondCode, code_verifier: verifier, client_id: client.client_id, redirect_uri: redirect, resource: config.resource });
    assert.equal(store.users.size, 2);

    const badRedirect = await fetch(`${base}/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent('https://evil.example/steal')}&code_challenge=${challenge}&code_challenge_method=S256&resource=${resource}&state=x`, { redirect: 'manual' });
    assert.equal(badRedirect.status, 400);
    assert.equal(badRedirect.headers.get('location'), null);
  } finally {
    server.closeAllConnections?.();
    server.close();
    server.unref();
  }
});

function tokenRequest(base, fields) {
  return fetch(`${base}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
}
