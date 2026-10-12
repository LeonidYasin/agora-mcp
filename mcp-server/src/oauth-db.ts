import type pg from "pg";
import { pool } from "./db.js";
import type {
  AuthCodeRecord,
  AuthTransaction,
  OAuthClientRecord,
  OAuthStore,
  StoredAccess,
  TokenAuthMethod,
} from "./oauth-core.js";

type Queryable = Pick<pg.Pool, "query"> | pg.PoolClient;

function uniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export class PgOAuthStore implements OAuthStore {
  constructor(private readonly db: Pick<pg.Pool, "query" | "connect"> = pool) {}

  async saveClient(client: OAuthClientRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO oauth_clients
         (client_id, client_secret_hash, client_name, redirect_uris, token_endpoint_auth_method, allow_refresh)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [client.clientId, client.clientSecretHash, client.clientName, client.redirectUris, client.tokenEndpointAuthMethod, client.allowRefresh]
    );
  }

  async getClient(clientId: string): Promise<OAuthClientRecord | null> {
    const result = await this.db.query<{
      client_id: string;
      client_secret_hash: string | null;
      client_name: string;
      redirect_uris: string[];
      token_endpoint_auth_method: TokenAuthMethod;
      allow_refresh: boolean;
    }>(
      `SELECT client_id, client_secret_hash, client_name, redirect_uris, token_endpoint_auth_method, allow_refresh
       FROM oauth_clients WHERE client_id = $1`,
      [clientId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      clientId: row.client_id,
      clientSecretHash: row.client_secret_hash,
      clientName: row.client_name,
      redirectUris: row.redirect_uris,
      tokenEndpointAuthMethod: row.token_endpoint_auth_method,
      allowRefresh: row.allow_refresh,
    };
  }

  async saveTransaction(transaction: AuthTransaction): Promise<void> {
    await this.db.query(`DELETE FROM oauth_transactions WHERE expires_at < now() - interval '1 day'`);
    await this.db.query(
      `INSERT INTO oauth_transactions
         (id, client_id, client_name, redirect_uri, code_challenge, resource, scope, state, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [transaction.id, transaction.clientId, transaction.clientName, transaction.redirectUri, transaction.codeChallenge,
        transaction.resource, transaction.scope, transaction.state, transaction.expiresAt]
    );
  }

  async getTransaction(id: string): Promise<AuthTransaction | null> {
    const result = await this.db.query<{
      id: string; client_id: string; client_name: string; redirect_uri: string; code_challenge: string;
      resource: string; scope: string; state: string; expires_at: Date; user_id: string | null;
    }>(
      `SELECT id, client_id, client_name, redirect_uri, code_challenge, resource, scope, state, expires_at, user_id
       FROM oauth_transactions
       WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()`,
      [id]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      clientId: row.client_id,
      clientName: row.client_name,
      redirectUri: row.redirect_uri,
      codeChallenge: row.code_challenge,
      resource: row.resource,
      scope: row.scope,
      state: row.state,
      expiresAt: row.expires_at,
      userId: row.user_id,
    };
  }

  async setTransactionUser(id: string, userId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE oauth_transactions SET user_id = $2
       WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()`,
      [id, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async consumeTransaction(id: string): Promise<AuthTransaction | null> {
    const result = await this.db.query<{
      id: string; client_id: string; client_name: string; redirect_uri: string; code_challenge: string;
      resource: string; scope: string; state: string; expires_at: Date; user_id: string | null;
    }>(
      `UPDATE oauth_transactions SET consumed_at = now()
       WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()
       RETURNING id, client_id, client_name, redirect_uri, code_challenge, resource, scope, state, expires_at, user_id`,
      [id]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id, clientId: row.client_id, clientName: row.client_name, redirectUri: row.redirect_uri,
      codeChallenge: row.code_challenge, resource: row.resource, scope: row.scope, state: row.state,
      expiresAt: row.expires_at, userId: row.user_id,
    };
  }

  async saveCode(codeHash: string, code: AuthCodeRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO oauth_codes
         (code_hash, client_id, user_id, redirect_uri, code_challenge, resource, scope, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [codeHash, code.clientId, code.userId, code.redirectUri, code.codeChallenge, code.resource, code.scope, code.expiresAt]
    );
  }

  async consumeCode(codeHash: string): Promise<AuthCodeRecord | null> {
    const result = await this.db.query<{
      client_id: string; user_id: string; redirect_uri: string; code_challenge: string;
      resource: string; scope: string; expires_at: Date;
    }>(
      `UPDATE oauth_codes SET used_at = now()
       WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING client_id, user_id, redirect_uri, code_challenge, resource, scope, expires_at`,
      [codeHash]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      clientId: row.client_id, userId: row.user_id, redirectUri: row.redirect_uri,
      codeChallenge: row.code_challenge, resource: row.resource, scope: row.scope, expiresAt: row.expires_at,
    };
  }

  async saveTokenFamily(params: {
    familyId: string; userId: string; clientId: string; accessTokenHash: string; refreshTokenHash: string;
    resource: string; scope: string; accessExpiresAt: Date; refreshExpiresAt: Date;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO oauth_tokens
         (family_id, user_id, client_id, access_token_hash, refresh_token_hash, resource, scope, access_expires_at, refresh_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [params.familyId, params.userId, params.clientId, params.accessTokenHash, params.refreshTokenHash,
        params.resource, params.scope, params.accessExpiresAt, params.refreshExpiresAt]
    );
  }

  async getAccessToken(accessTokenHash: string, resource: string): Promise<StoredAccess | null> {
    const result = await this.db.query<{ user_id: string; client_id: string; resource: string; scope: string; family_id: string }>(
      `SELECT user_id, client_id, resource, scope, family_id
       FROM oauth_tokens
       WHERE access_token_hash = $1 AND resource = $2 AND revoked_at IS NULL AND access_expires_at > now()`,
      [accessTokenHash, resource]
    );
    const row = result.rows[0];
    if (!row) return null;
    return { userId: row.user_id, clientId: row.client_id, resource: row.resource, scope: row.scope, familyId: row.family_id };
  }

  async rotateRefreshToken(params: {
    refreshTokenHash: string; resource: string; clientId: string; newAccessTokenHash: string; newRefreshTokenHash: string;
    accessExpiresAt: Date; refreshExpiresAt: Date;
  }): Promise<StoredAccess | null> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{
        family_id: string; user_id: string; client_id: string; resource: string; scope: string;
        revoked_at: Date | null; refresh_used_at: Date | null; refresh_expires_at: Date;
      }>(
        `SELECT family_id, user_id, client_id, resource, scope, revoked_at, refresh_used_at, refresh_expires_at
         FROM oauth_tokens WHERE refresh_token_hash = $1 FOR UPDATE`,
        [params.refreshTokenHash]
      );
      const row = current.rows[0];
      if (!row || row.resource !== params.resource || row.client_id !== params.clientId) {
        await client.query("COMMIT");
        return null;
      }
      const reuse = row.revoked_at || row.refresh_used_at || row.refresh_expires_at.getTime() <= Date.now();
      if (reuse) {
        await client.query(`UPDATE oauth_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [row.family_id]);
        await client.query("COMMIT");
        return null;
      }
      await client.query(
        `UPDATE oauth_tokens SET refresh_used_at = now(), revoked_at = now() WHERE refresh_token_hash = $1`,
        [params.refreshTokenHash]
      );
      await client.query(
        `INSERT INTO oauth_tokens
           (family_id, user_id, client_id, access_token_hash, refresh_token_hash, resource, scope, access_expires_at, refresh_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [row.family_id, row.user_id, row.client_id, params.newAccessTokenHash, params.newRefreshTokenHash,
          row.resource, row.scope, params.accessExpiresAt, params.refreshExpiresAt]
      );
      await client.query("COMMIT");
      return { userId: row.user_id, clientId: row.client_id, resource: row.resource, scope: row.scope, familyId: row.family_id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeToken(tokenHash: string): Promise<void> {
    await this.db.query(
      `UPDATE oauth_tokens SET revoked_at = now()
       WHERE family_id = (
         SELECT family_id FROM oauth_tokens
         WHERE access_token_hash = $1 OR refresh_token_hash = $1
         LIMIT 1
       ) AND revoked_at IS NULL`,
      [tokenHash]
    );
  }

  async findOrCreateUser(params: { issuer: string; subject: string; displayName: string | null; email: string | null }): Promise<string> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const userId = await insertIdentity(client, params);
      await client.query("COMMIT");
      return userId;
    } catch (error) {
      await client.query("ROLLBACK");
      if (!uniqueViolation(error)) throw error;
    } finally {
      client.release();
    }
    const existing = await this.db.query<{ user_id: string }>(
      `SELECT user_id FROM identities WHERE issuer = $1 AND subject = $2`,
      [params.issuer, params.subject]
    );
    if (!existing.rows[0]) throw new Error("Could not create Agora account.");
    return existing.rows[0].user_id;
  }
}

async function insertIdentity(client: Queryable, params: { issuer: string; subject: string; displayName: string | null; email: string | null }): Promise<string> {
  const existing = await client.query<{ user_id: string }>(
    `SELECT user_id FROM identities WHERE issuer = $1 AND subject = $2`,
    [params.issuer, params.subject]
  );
  if (existing.rows[0]) return existing.rows[0].user_id;
  const created = await client.query<{ id: string }>(
    `INSERT INTO users (external_id, display_name) VALUES ($1, $2) RETURNING id`,
    [`${params.issuer}|${params.subject}`, params.displayName]
  );
  await client.query(
    `INSERT INTO identities (user_id, issuer, subject, email) VALUES ($1, $2, $3, $4)`,
    [created.rows[0].id, params.issuer, params.subject, params.email]
  );
  return created.rows[0].id;
}

export async function getUserIdByAccessToken(tokenHash: string, resource: string): Promise<string | null> {
  const store = new PgOAuthStore();
  const token = await store.getAccessToken(tokenHash, resource);
  return token?.userId ?? null;
}
