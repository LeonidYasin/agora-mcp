import { createHash } from "node:crypto";
import { ToolError } from "./errors.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { getUserIdByTokenHash } from "./db.js";
import { readOAuthConfig } from "./oauth-core.js";
import { getUserIdByAccessToken } from "./oauth-db.js";

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/**
 * Accepts either an OAuth access token issued by this server or a legacy
 * pilot bearer token. Only SHA-256 hashes are stored. See docs/identity-and-access.md.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function bearerFromHeader(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
  return match ? match[1] : null;
}

function extractBearerToken(extra: ToolExtra): string | null {
  return bearerFromHeader(extra.requestInfo?.headers?.["authorization"]);
}

/**
 * OAuth access tokens are checked before legacy pilot tokens. An expired or
 * revoked OAuth token does not fall through to a different account.
 */
export async function resolveUserId(token: string, resource: string | null): Promise<string | null> {
  const hash = hashToken(token);
  if (resource) {
    const oauthUser = await getUserIdByAccessToken(hash, resource);
    if (oauthUser) return oauthUser;
  }
  return getUserIdByTokenHash(hash);
}

export class AuthError extends ToolError {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Resolves the calling user's internal UUID from the request's
 * `Authorization: Bearer <token>` header. Every tool handler that needs
 * to know "who is calling" should start by awaiting this.
 */
export async function requireUserId(extra: ToolExtra): Promise<string> {
  const token = extractBearerToken(extra);
  if (!token) {
    throw new AuthError("Missing Authorization: Bearer <token> header.");
  }
  const userId = await resolveUserId(token, readOAuthConfig(process.env)?.resource ?? null);
  if (!userId) {
    throw new AuthError("Invalid or unrecognized token.");
  }
  return userId;
}
