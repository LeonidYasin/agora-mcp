import { lookup } from "node:dns/promises";
import express, { type Express, type Request, type Response } from "express";
import type { IdentityProvider } from "./google-oidc.js";
import {
  ACCESS_TTL_SECONDS,
  CODE_TTL_SECONDS,
  OAUTH_SCOPE,
  REFRESH_TTL_SECONDS,
  TRANSACTION_TTL_SECONDS,
  type OAuthClientRecord,
  type OAuthConfig,
  type OAuthStore,
  type TokenAuthMethod,
  appendQuery,
  authorizationServerMetadata,
  canonicalResource,
  cleanName,
  escapeHtml,
  isBlockedHost,
  isPrivateAddress,
  metadataPaths,
  protectedResourceMetadata,
  randomToken,
  safeEqual,
  sha256,
  validateRedirectUri,
  verifyPkce,
} from "./oauth-core.js";

const COOKIE = "agora_oauth_tx";
const hits = new Map<string, number[]>();

export type MetadataFetcher = (url: string) => Promise<Record<string, unknown>>;

export type OAuthHttpDeps = {
  config: OAuthConfig;
  store: OAuthStore;
  identity: IdentityProvider | null;
  fetchMetadata?: MetadataFetcher;
  now?: () => Date;
};

export function mountOAuth(app: Express, deps: OAuthHttpDeps): void {
  const paths = metadataPaths(deps.config);
  for (const path of paths.resource) app.get(path, (_req, res) => json(res, protectedResourceMetadata(deps.config)));
  for (const path of paths.authorization) app.get(path, (_req, res) => json(res, authorizationServerMetadata(deps.config)));
  app.get("/authorize", (req, res) => void authorize(req, res, deps));
  app.get("/oauth/google/callback", (req, res) => void googleCallback(req, res, deps));
  app.post("/oauth/consent", express.urlencoded({ extended: false }), (req, res) => void consent(req, res, deps));
  app.post("/register", (req, res) => void register(req, res, deps));
  app.post("/token", express.urlencoded({ extended: false }), (req, res) => void token(req, res, deps));
  app.post("/revoke", express.urlencoded({ extended: false }), (req, res) => void revoke(req, res, deps));
}

async function authorize(req: Request, res: Response, deps: OAuthHttpDeps): Promise<void> {
  if (limited(req, "authorize", 30, 10 * 60 * 1000)) return text(res, 429, "Too many login attempts.");
  if (!deps.identity) return text(res, 503, "Google login is not configured on this Agora server.");
  const query = req.query;
  const client = await resolveClient(deps, query.client_id, query.redirect_uri);
  if (!client) return text(res, 400, "Unknown client or redirect URI.");
  const redirectUri = String(query.redirect_uri);
  const fail = (error: string) => res.redirect(appendQuery(redirectUri, { error, state: typeof query.state === "string" ? query.state : "" }));
  if (query.response_type !== "code") return fail("unsupported_response_type");
  if (typeof query.state !== "string" || query.state.length < 1 || query.state.length > 512) return fail("invalid_request");
  if (query.code_challenge_method !== "S256" || typeof query.code_challenge !== "string" || !/^[\w.~-]{43,128}$/.test(query.code_challenge)) return fail("invalid_request");
  if (query.scope !== undefined && query.scope !== OAUTH_SCOPE) return fail("invalid_scope");
  if (!canonicalResource(query.resource, deps.config.resource)) return fail("invalid_target");
  const id = randomToken();
  const now = (deps.now ?? (() => new Date()))();
  await deps.store.saveTransaction({
    id,
    clientId: client.clientId,
    clientName: client.clientName,
    redirectUri,
    codeChallenge: query.code_challenge,
    resource: deps.config.resource,
    scope: OAUTH_SCOPE,
    state: query.state,
    expiresAt: new Date(now.getTime() + TRANSACTION_TTL_SECONDS * 1000),
    userId: null,
  });
  setTxCookie(res, deps, id);
  res.redirect(deps.identity.authorizationUrl(id));
}

async function googleCallback(req: Request, res: Response, deps: OAuthHttpDeps): Promise<void> {
  if (!deps.identity) return text(res, 503, "Google login is not configured on this Agora server.");
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!state || readCookie(req, COOKIE) !== state) return text(res, 400, "Login session was missing or did not match. Start again from the AI client.");
  const transaction = await deps.store.getTransaction(state);
  if (!transaction) return text(res, 400, "Login session expired. Start again from the AI client.");
  if (typeof req.query.error === "string") {
    await deps.store.consumeTransaction(state);
    return res.redirect(appendQuery(transaction.redirectUri, { error: "access_denied", state: transaction.state }));
  }
  if (typeof req.query.code !== "string") return text(res, 400, "Google did not return a login code.");
  try {
    const identity = await deps.identity.exchange(req.query.code);
    const userId = await deps.store.findOrCreateUser(identity);
    if (!await deps.store.setTransactionUser(state, userId)) return text(res, 400, "Login session expired. Start again from the AI client.");
    consentPage(res, deps, transaction.clientName, state);
  } catch (error) {
    console.error("Google login failed:", error instanceof Error ? error.name : "unknown");
    text(res, 502, "Google login could not be verified. No Agora account was changed.");
  }
}

async function consent(req: Request, res: Response, deps: OAuthHttpDeps): Promise<void> {
  const id = typeof req.body?.tx === "string" ? req.body.tx : "";
  if (!id || readCookie(req, COOKIE) !== id) return text(res, 400, "Login session was missing. Start again from the AI client.");
  const decision = req.body?.decision === "allow" ? "allow" : "deny";
  const transaction = decision === "allow" ? await deps.store.getTransaction(id) : await deps.store.consumeTransaction(id);
  if (!transaction) return text(res, 400, "Login session expired. Start again from the AI client.");
  if (decision !== "allow") {
    clearTxCookie(res, deps);
    return res.redirect(appendQuery(transaction.redirectUri, { error: "access_denied", state: transaction.state }));
  }
  if (!transaction.userId) return text(res, 400, "Google login was not completed.");
  const consumed = await deps.store.consumeTransaction(id);
  if (!consumed?.userId) return text(res, 400, "Login session expired. Start again from the AI client.");
  const code = randomToken();
  const now = (deps.now ?? (() => new Date()))();
  await deps.store.saveCode(sha256(code), {
    clientId: consumed.clientId,
    userId: consumed.userId,
    redirectUri: consumed.redirectUri,
    codeChallenge: consumed.codeChallenge,
    resource: consumed.resource,
    scope: consumed.scope,
    expiresAt: new Date(now.getTime() + CODE_TTL_SECONDS * 1000),
  });
  clearTxCookie(res, deps);
  res.redirect(appendQuery(consumed.redirectUri, { code, state: consumed.state }));
}

async function register(req: Request, res: Response, deps: OAuthHttpDeps): Promise<void> {
  if (limited(req, "register", 20, 60 * 60 * 1000)) return jsonError(res, 429, "invalid_request", "Too many registrations.");
  const body = req.body ?? {};
  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length < 1 || body.redirect_uris.length > 8) {
    return jsonError(res, 400, "invalid_client_metadata", "redirect_uris must contain 1 to 8 URIs.");
  }
  const redirectUris = body.redirect_uris.map(validateRedirectUri);
  if (redirectUris.some((uri: string | null) => !uri)) return jsonError(res, 400, "invalid_redirect_uri", "Redirect URI must be https, or http on localhost.");
  const method = body.token_endpoint_auth_method ?? "none";
  if (method !== "none" && method !== "client_secret_basic" && method !== "client_secret_post") {
    return jsonError(res, 400, "invalid_client_metadata", "Unsupported token endpoint authentication method.");
  }
  const secret = method === "none" ? null : randomToken();
  const client: OAuthClientRecord = {
    clientId: `agora_${randomToken(24)}`,
    clientSecretHash: secret ? sha256(secret) : null,
    clientName: cleanName(body.client_name, "MCP client"),
    redirectUris: redirectUris as string[],
    tokenEndpointAuthMethod: method,
    allowRefresh: body.grant_types === undefined || (Array.isArray(body.grant_types) && body.grant_types.includes("refresh_token")),
  };
  await deps.store.saveClient(client);
  const response: Record<string, unknown> = {
    client_id: client.clientId,
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: method,
    grant_types: client.allowRefresh ? ["authorization_code", "refresh_token"] : ["authorization_code"],
    response_types: ["code"],
    client_secret_expires_at: 0,
  };
  if (secret) response.client_secret = secret;
  res.status(201).json(response);
}

async function token(req: Request, res: Response, deps: OAuthHttpDeps): Promise<void> {
  noStore(res);
  const body = req.body ?? {};
  const client = await authenticateClient(req, deps);
  if (!client) return jsonError(res, 401, "invalid_client", "Client authentication failed.");
  if (!canonicalResource(body.resource, deps.config.resource)) return jsonError(res, 400, "invalid_target", "Resource does not match this Agora server.");
  if (body.grant_type === "authorization_code") return authorizationCodeGrant(res, deps, client, body);
  if (body.grant_type === "refresh_token") return refreshGrant(res, deps, client, body);
  return jsonError(res, 400, "unsupported_grant_type", "Unsupported grant type.");
}

async function authorizationCodeGrant(res: Response, deps: OAuthHttpDeps, client: OAuthClientRecord, body: Record<string, string>): Promise<void> {
  if (body.redirect_uri !== undefined && !client.redirectUris.includes(body.redirect_uri)) {
    return jsonError(res, 400, "invalid_grant", "Authorization grant is invalid.");
  }
  if (typeof body.code !== "string" || typeof body.code_verifier !== "string") return jsonError(res, 400, "invalid_request", "Missing code or verifier.");
  const code = await deps.store.consumeCode(sha256(body.code));
  if (!code || code.clientId !== client.clientId || !verifyPkce(body.code_verifier, code.codeChallenge)) {
    return jsonError(res, 400, "invalid_grant", "Authorization grant is invalid.");
  }
  if (body.redirect_uri !== undefined && body.redirect_uri !== code.redirectUri) return jsonError(res, 400, "invalid_grant", "Authorization grant is invalid.");
  await issue(res, deps, client, code.userId, code.scope);
}

async function refreshGrant(res: Response, deps: OAuthHttpDeps, client: OAuthClientRecord, body: Record<string, string>): Promise<void> {
  if (!client.allowRefresh || typeof body.refresh_token !== "string") return jsonError(res, 400, "invalid_grant", "Refresh token is invalid.");
  const now = (deps.now ?? (() => new Date()))();
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const rotated = await deps.store.rotateRefreshToken({
    refreshTokenHash: sha256(body.refresh_token),
    resource: deps.config.resource,
    clientId: client.clientId,
    newAccessTokenHash: sha256(accessToken),
    newRefreshTokenHash: sha256(refreshToken),
    accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_SECONDS * 1000),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_SECONDS * 1000),
  });
  if (!rotated) return jsonError(res, 400, "invalid_grant", "Refresh token is invalid.");
  tokenResponse(res, accessToken, refreshToken);
}

async function revoke(req: Request, res: Response, deps: OAuthHttpDeps): Promise<void> {
  noStore(res);
  const client = await authenticateClient(req, deps);
  if (!client) return jsonError(res, 401, "invalid_client", "Client authentication failed.");
  const tokenValue = typeof req.body?.token === "string" ? req.body.token : "";
  if (tokenValue) await deps.store.revokeToken(sha256(tokenValue));
  res.status(200).end();
}

async function issue(res: Response, deps: OAuthHttpDeps, client: OAuthClientRecord, userId: string, scope: string): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const accessToken = randomToken();
  const refreshToken = randomToken();
  await deps.store.saveTokenFamily({
    familyId: randomToken(16),
    userId,
    clientId: client.clientId,
    accessTokenHash: sha256(accessToken),
    refreshTokenHash: sha256(refreshToken),
    resource: deps.config.resource,
    scope,
    accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_SECONDS * 1000),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_SECONDS * 1000),
  });
  tokenResponse(res, client.allowRefresh ? accessToken : accessToken, client.allowRefresh ? refreshToken : undefined);
}

function tokenResponse(res: Response, accessToken: string, refreshToken?: string): void {
  const body: Record<string, unknown> = { access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_TTL_SECONDS, scope: OAUTH_SCOPE };
  if (refreshToken) body.refresh_token = refreshToken;
  res.json(body);
}

async function resolveClient(deps: OAuthHttpDeps, clientId: unknown, redirectUri: unknown): Promise<OAuthClientRecord | null> {
  if (typeof clientId !== "string" || typeof redirectUri !== "string" || !validateRedirectUri(redirectUri)) return null;
  const client = clientId.startsWith("https://") ? await loadMetadataClient(deps, clientId) : await deps.store.getClient(clientId);
  if (!client || !client.redirectUris.includes(redirectUri)) return null;
  return client;
}

async function loadMetadataClient(deps: OAuthHttpDeps, clientId: string): Promise<OAuthClientRecord | null> {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || isBlockedHost(url.hostname) || url.username || url.password) return null;
  try {
    const document = await (deps.fetchMetadata ?? fetchClientMetadata)(clientId);
    if (document.client_id !== clientId) return null;
    const redirects = Array.isArray(document.redirect_uris) ? document.redirect_uris.filter((uri): uri is string => validateRedirectUri(uri) === uri) : [];
    if (redirects.length === 0) return null;
    const method = document.token_endpoint_auth_method ?? "none";
    if (method !== "none") return null;
    return {
      clientId,
      clientSecretHash: null,
      clientName: cleanName(document.client_name, url.hostname),
      redirectUris: redirects,
      tokenEndpointAuthMethod: "none",
      allowRefresh: document.grant_types === undefined || (Array.isArray(document.grant_types) && document.grant_types.includes("refresh_token")),
    };
  } catch (error) {
    console.error("Client metadata fetch failed:", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

export async function fetchClientMetadata(url: string): Promise<Record<string, unknown>> {
  const target = new URL(url);
  const addresses = await lookup(target.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((item) => isPrivateAddress(item.address) || isBlockedHost(item.address))) {
    throw new Error("Client metadata host is not allowed.");
  }
  const response = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(5000) });
  if (!response.ok || response.headers.get("location")) throw new Error("Client metadata was not available.");
  const text = await response.text();
  if (text.length > 65536) throw new Error("Client metadata is too large.");
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Client metadata must be a JSON object.");
  return parsed as Record<string, unknown>;
}

async function authenticateClient(req: Request, deps: OAuthHttpDeps): Promise<OAuthClientRecord | null> {
  const body = req.body ?? {};
  const basic = basicAuth(req);
  const clientId = basic?.clientId ?? (typeof body.client_id === "string" ? body.client_id : "");
  const secret = basic?.secret ?? (typeof body.client_secret === "string" ? body.client_secret : "");
  if (!clientId) return null;
  if (clientId.startsWith("https://")) {
    if (secret) return null;
    return loadMetadataClient(deps, clientId);
  }
  const client = await deps.store.getClient(clientId);
  if (!client) return null;
  if (client.tokenEndpointAuthMethod === "none") return secret ? null : client;
  if (!secret || !client.clientSecretHash || !safeEqual(sha256(secret), client.clientSecretHash)) return null;
  if (client.tokenEndpointAuthMethod === "client_secret_basic" && !basic) return null;
  if (client.tokenEndpointAuthMethod === "client_secret_post" && basic) return null;
  return client;
}

function basicAuth(req: Request): { clientId: string; secret: string } | null {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(value ?? "");
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 1) return null;
  return { clientId: decodeURIComponent(decoded.slice(0, separator)), secret: decodeURIComponent(decoded.slice(separator + 1)) };
}

function consentPage(res: Response, deps: OAuthHttpDeps, clientName: string, id: string): void {
  const name = escapeHtml(clientName);
  const action = escapeHtml(`${deps.config.issuer}/oauth/consent`);
  const tx = escapeHtml(id);
  noStore(res);
  res.type("html").send(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agora</title><meta http-equiv="content-security-policy" content="default-src 'none'; style-src 'unsafe-inline'">
</head><body style="font:16px/1.45 system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem">
<h1>Подключить Agora</h1>
<p><strong>${name}</strong> запрашивает доступ к вашим объявлениям «предлагаю» и «хочу».</p>
<p>Allow <strong>${name}</strong> to publish and search as your Agora account. This does not grant votes, payments, or access to another participant.</p>
<form method="post" action="${action}">
<input type="hidden" name="tx" value="${tx}">
<button name="decision" value="allow" type="submit">Разрешить / Allow</button>
<button name="decision" value="deny" type="submit">Отклонить / Deny</button>
</form></body></html>`);
}

function setTxCookie(res: Response, deps: OAuthHttpDeps, id: string): void {
  const secure = deps.config.cookieSecure ? "; Secure" : "";
  res.append("Set-Cookie", `${COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=${deps.config.cookiePath}; Max-Age=${TRANSACTION_TTL_SECONDS}${secure}`);
}

function clearTxCookie(res: Response, deps: OAuthHttpDeps): void {
  const secure = deps.config.cookieSecure ? "; Secure" : "";
  res.append("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=${deps.config.cookiePath}; Max-Age=0${secure}`);
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

function limited(req: Request, action: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const key = `${action}:${req.ip ?? "unknown"}`;
  const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > limit;
}

function json(res: Response, body: Record<string, unknown>): void {
  noStore(res);
  res.json(body);
}

function jsonError(res: Response, status: number, error: string, description: string): void {
  noStore(res);
  res.status(status).json({ error, error_description: description });
}

function text(res: Response, status: number, message: string): void {
  noStore(res);
  res.status(status).type("text").send(message);
}

function noStore(res: Response): void {
  res.set("Cache-Control", "no-store");
  res.set("X-Frame-Options", "DENY");
}
