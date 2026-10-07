import { createHash } from "node:crypto";
import { ToolError } from "./errors.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { getUserIdByTokenHash } from "./db.js";

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/**
 * Stage 0 auth (see docs/architecture.md): invite-only, no OAuth dance yet.
 * The founder creates a `users` row and hands the invitee an opaque bearer
 * token out-of-band. Only the token's SHA-256 hash is ever stored/compared.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function extractBearerToken(extra: ToolExtra): string | null {
  const header = extra.requestInfo?.headers?.["authorization"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1] : null;
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
  const userId = await getUserIdByTokenHash(hashToken(token));
  if (!userId) {
    throw new AuthError("Invalid or unrecognized token.");
  }
  return userId;
}
