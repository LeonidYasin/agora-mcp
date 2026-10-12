import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const OAUTH_SCOPE = "agora:use";
export const ACCESS_TTL_SECONDS = 60 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
export const CODE_TTL_SECONDS = 5 * 60;
export const TRANSACTION_TTL_SECONDS = 10 * 60;

export type TokenAuthMethod = "none" | "client_secret_basic" | "client_secret_post";

export type OAuthClientRecord = {
  clientId: string;
  clientSecretHash: string | null;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: TokenAuthMethod;
  allowRefresh: boolean;
};

export type AuthTransaction = {
  id: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  state: string;
  expiresAt: Date;
  userId: string | null;
};

export type AuthCodeRecord = {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  expiresAt: Date;
};

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

export type StoredAccess = {
  userId: string;
  clientId: string;
  resource: string;
  scope: string;
  familyId: string;
};

export interface OAuthStore {
  saveClient(client: OAuthClientRecord): Promise<void>;
  getClient(clientId: string): Promise<OAuthClientRecord | null>;
  saveTransaction(transaction: AuthTransaction): Promise<void>;
  getTransaction(id: string): Promise<AuthTransaction | null>;
  setTransactionUser(id: string, userId: string): Promise<boolean>;
  consumeTransaction(id: string): Promise<AuthTransaction | null>;
  saveCode(codeHash: string, code: AuthCodeRecord): Promise<void>;
  consumeCode(codeHash: string): Promise<AuthCodeRecord | null>;
  saveTokenFamily(params: {
    familyId: string;
    userId: string;
    clientId: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    resource: string;
    scope: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
  }): Promise<void>;
  getAccessToken(accessTokenHash: string, resource: string): Promise<StoredAccess | null>;
  rotateRefreshToken(params: {
    refreshTokenHash: string;
    resource: string;
    clientId: string;
    newAccessTokenHash: string;
    newRefreshTokenHash: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
  }): Promise<StoredAccess | null>;
  revokeToken(tokenHash: string): Promise<void>;
  findOrCreateUser(params: {
    issuer: string;
    subject: string;
    displayName: string | null;
    email: string | null;
  }): Promise<string>;
}

export type OAuthConfig = {
  issuer: string;
  resource: string;
  metadataUrl: string;
  cookiePath: string;
  cookieSecure: boolean;
  google: { clientId: string; clientSecret: string; redirectUri: string } | null;
};

export function readOAuthConfig(env: NodeJS.ProcessEnv): OAuthConfig | null {
  const raw = env.AGORA_PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  if (!raw) return null;
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    return null;
  }
  const loopback = isLoopbackHost(base.hostname);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && loopback)) return null;
  if (base.username || base.password || base.search || base.hash) return null;
  const issuer = base.toString().replace(/\/$/, "");
  const clientId = env.GOOGLE_CLIENT_ID?.trim() || "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() || "";
  const google = clientId && clientSecret
    ? { clientId, clientSecret, redirectUri: `${issuer}/oauth/google/callback` }
    : null;
  const pathname = base.pathname === "/" ? "/" : base.pathname.replace(/\/$/, "");
  return {
    issuer,
    resource: `${issuer}/mcp`,
    metadataUrl: `${issuer}/.well-known/oauth-protected-resource`,
    cookiePath: pathname,
    cookieSecure: base.protocol === "https:",
    google,
  };
}

export function wwwAuthenticate(config: OAuthConfig | null, error?: "invalid_token"): string {
  const parts = ['Bearer realm="agora"'];
  if (error) parts.push(`error="${error}"`);
  if (config) {
    parts.push(`resource_metadata="${config.metadataUrl}"`);
    parts.push(`scope="${OAUTH_SCOPE}"`);
  }
  return parts.join(", ");
}

export function protectedResourceMetadata(config: OAuthConfig): Record<string, unknown> {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: [OAUTH_SCOPE],
  };
}

export function authorizationServerMetadata(config: OAuthConfig): Record<string, unknown> {
  return {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/authorize`,
    token_endpoint: `${config.issuer}/token`,
    registration_endpoint: `${config.issuer}/register`,
    revocation_endpoint: `${config.issuer}/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    client_id_metadata_document_supported: true,
    scopes_supported: [OAUTH_SCOPE],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
  };
}

export function metadataPaths(config: OAuthConfig): { resource: string[]; authorization: string[] } {
  const base = new URL(config.issuer);
  const prefix = base.pathname === "/" ? "" : base.pathname.replace(/\/$/, "");
  const resourceSuffix = `${prefix}/mcp`.replace(/^\//, "");
  const authorization = [
    "/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
  ];
  if (prefix) {
    authorization.push(`/.well-known/oauth-authorization-server${prefix}`);
    authorization.push(`/.well-known/openid-configuration${prefix}`);
  }
  return {
    resource: [
      "/.well-known/oauth-protected-resource",
      `/.well-known/oauth-protected-resource/${resourceSuffix}`,
    ],
    authorization,
  };
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!/^[\w.~-]{43,128}$/.test(verifier)) return false;
  return safeEqual(pkceS256(verifier), challenge);
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function validateRedirectUri(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 8 || value.length > 500) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:" && isLoopbackHost(host)) return value;
  if (url.protocol !== "https:") return null;
  if (isBlockedHost(host)) return null;
  return value;
}

export function canonicalResource(value: unknown, expected: string): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  let actual: URL;
  let wanted: URL;
  try {
    actual = new URL(value);
    wanted = new URL(expected);
  } catch {
    return null;
  }
  if (actual.username || actual.password || actual.search || actual.hash) return null;
  const key = (url: URL) => `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  return key(actual) === key(wanted) ? expected : null;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function isBlockedHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (isLoopbackHost(normalized) || normalized.endsWith(".local") || normalized === "metadata.google.internal") return true;
  if (!isIP(normalized)) return false;
  return isPrivateAddress(normalized);
}

export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase();
  if (ip.includes(":")) {
    const mapped = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:");
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

export function cleanName(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim() : "";
  return (text || fallback).slice(0, 200);
}

export function appendQuery(target: string, params: Record<string, string>): string {
  const url = new URL(target);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
