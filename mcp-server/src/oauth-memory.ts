import type {
  AuthCodeRecord,
  AuthTransaction,
  OAuthClientRecord,
  OAuthStore,
  StoredAccess,
} from "./oauth-core.js";

export class MemoryOAuthStore implements OAuthStore {
  readonly users = new Map<string, string>();
  private clients = new Map<string, OAuthClientRecord>();
  private transactions = new Map<string, AuthTransaction & { consumed: boolean }>();
  private codes = new Map<string, AuthCodeRecord & { used: boolean }>();
  private tokens: Array<StoredAccess & {
    accessTokenHash: string;
    refreshTokenHash: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
    revoked: boolean;
    refreshUsed: boolean;
  }> = [];

  async saveClient(client: OAuthClientRecord): Promise<void> {
    this.clients.set(client.clientId, client);
  }

  async getClient(clientId: string): Promise<OAuthClientRecord | null> {
    return this.clients.get(clientId) ?? null;
  }

  async saveTransaction(transaction: AuthTransaction): Promise<void> {
    this.transactions.set(transaction.id, { ...transaction, consumed: false });
  }

  async getTransaction(id: string): Promise<AuthTransaction | null> {
    const found = this.transactions.get(id);
    if (!found || found.consumed || found.expiresAt.getTime() <= Date.now()) return null;
    return found;
  }

  async setTransactionUser(id: string, userId: string): Promise<boolean> {
    const found = this.transactions.get(id);
    if (!found || found.consumed || found.expiresAt.getTime() <= Date.now()) return false;
    found.userId = userId;
    return true;
  }

  async consumeTransaction(id: string): Promise<AuthTransaction | null> {
    const found = await this.getTransaction(id);
    if (!found) return null;
    this.transactions.get(id)!.consumed = true;
    return found;
  }

  async saveCode(codeHash: string, code: AuthCodeRecord): Promise<void> {
    this.codes.set(codeHash, { ...code, used: false });
  }

  async consumeCode(codeHash: string): Promise<AuthCodeRecord | null> {
    const found = this.codes.get(codeHash);
    if (!found || found.used || found.expiresAt.getTime() <= Date.now()) return null;
    found.used = true;
    return found;
  }

  async saveTokenFamily(params: {
    familyId: string;
    userId: string;
    clientId: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    resource: string;
    scope: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
  }): Promise<void> {
    this.tokens.push({ ...params, revoked: false, refreshUsed: false });
  }

  async getAccessToken(accessTokenHash: string, resource: string): Promise<StoredAccess | null> {
    const found = this.tokens.find((token) => token.accessTokenHash === accessTokenHash && !token.revoked
      && token.resource === resource && token.accessExpiresAt.getTime() > Date.now());
    return found ? { userId: found.userId, clientId: found.clientId, resource: found.resource, scope: found.scope, familyId: found.familyId } : null;
  }

  async rotateRefreshToken(params: {
    refreshTokenHash: string;
    resource: string;
    clientId: string;
    newAccessTokenHash: string;
    newRefreshTokenHash: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
  }): Promise<StoredAccess | null> {
    const found = this.tokens.find((token) => token.refreshTokenHash === params.refreshTokenHash);
    if (!found || found.resource !== params.resource || found.clientId !== params.clientId) return null;
    if (found.revoked || found.refreshUsed || found.refreshExpiresAt.getTime() <= Date.now()) {
      for (const token of this.tokens) if (token.familyId === found.familyId) token.revoked = true;
      return null;
    }
    found.refreshUsed = true;
    found.revoked = true;
    this.tokens.push({
      familyId: found.familyId,
      userId: found.userId,
      clientId: found.clientId,
      accessTokenHash: params.newAccessTokenHash,
      refreshTokenHash: params.newRefreshTokenHash,
      resource: found.resource,
      scope: found.scope,
      accessExpiresAt: params.accessExpiresAt,
      refreshExpiresAt: params.refreshExpiresAt,
      revoked: false,
      refreshUsed: false,
    });
    return { userId: found.userId, clientId: found.clientId, resource: found.resource, scope: found.scope, familyId: found.familyId };
  }

  async revokeToken(tokenHash: string): Promise<void> {
    const found = this.tokens.find((token) => token.accessTokenHash === tokenHash || token.refreshTokenHash === tokenHash);
    if (!found) return;
    for (const token of this.tokens) if (token.familyId === found.familyId) token.revoked = true;
  }

  async findOrCreateUser(params: { issuer: string; subject: string; displayName: string | null; email: string | null }): Promise<string> {
    const key = `${params.issuer}\n${params.subject}`;
    const existing = this.users.get(key);
    if (existing) return existing;
    const id = `user-${this.users.size + 1}`;
    this.users.set(key, id);
    return id;
  }
}
