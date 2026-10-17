/** Embedding capability, independent of chat LLM; one consistent vector space per dataset. */
import { ToolError } from './errors.js';
import { OpenAICompatibleGateway } from './model-gateway.js';

export const EMBEDDING_DIMENSION = 1024;
export function validateEmbedding(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== EMBEDDING_DIMENSION ||
      !value.every(v => typeof v === 'number' && Number.isFinite(v) && Number.isFinite(Math.fround(v))) ||
      !value.some(v => Math.fround(v) !== 0)) {
    throw new ToolError('Embedding provider returned an invalid vector; expected 1024 finite values and nonzero norm.');
  }
  return value;
}

async function requestEmbedding(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new ToolError('Embedding provider unavailable.');
    return await response.json();
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError('Embedding provider unavailable or request timed out.');
  }
}
export type ItemRole = 'offer' | 'want';
const ROLE_PREFIX: Record<ItemRole, string> = {
  offer: 'Represent this offer for matching against user wants: ',
  want: 'Represent this want for finding relevant offers: ',
};
export interface EmbeddingService { embed(text: string, role: ItemRole): Promise<number[]>; }

/** Existing role prefixes remain unchanged: modifying them requires a vector-space plan. */
export class UnimplementedEmbeddingService implements EmbeddingService {
  async embed(text: string, role: ItemRole): Promise<number[]> {
    void text; void role;
    throw new ToolError('EmbeddingService.embed() is not configured — set EMBEDDING_PROVIDER (ollama|openai|openai-compatible|litellm).');
  }
}

/** Existing native Ollama adapter; no local installation or model download implied. */
export class OllamaEmbeddingService implements EmbeddingService {
  constructor(private readonly baseUrl: string, private readonly model: string,
    private readonly timeoutMs = 15000) {}
  async embed(text: string, role: ItemRole): Promise<number[]> {
    const data = await requestEmbedding(`${this.baseUrl}/api/embed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: ROLE_PREFIX[role] + text }),
    }, this.timeoutMs) as { embeddings?: unknown[] } | null;
    return validateEmbedding(data?.embeddings?.[0]);
  }
}

/** Direct compatible API or ready-made gateway (e.g. LiteLLM), not necessarily OpenAI. */
export class OpenAICompatibleEmbeddingService implements EmbeddingService {
  private readonly gateway: OpenAICompatibleGateway;
  constructor(baseUrl: string, apiKey: string, model: string, timeoutMs = 15000) {
    this.gateway = new OpenAICompatibleGateway({ baseUrl, apiKey, model, timeoutMs });
  }
  async embed(text: string, role: ItemRole): Promise<number[]> {
    return validateEmbedding(await this.gateway.embedding(ROLE_PREFIX[role] + text));
  }
}

/** env injection permits config tests without modifying global process.env or secrets. */
export function createEmbeddingService(env: NodeJS.ProcessEnv = process.env): EmbeddingService {
  const provider = env.EMBEDDING_PROVIDER;
  if (provider === 'ollama') {
    return new OllamaEmbeddingService(env.EMBEDDING_BASE_URL ?? 'http://127.0.0.1:11434',
      env.EMBEDDING_MODEL ?? 'bge-m3');
  }
  if (provider && ['openai', 'openai-compatible', 'litellm'].includes(provider)) {
    // Preserve legacy openai default. New aliases must explicitly choose their endpoint.
    const baseUrl = env.EMBEDDING_BASE_URL ?? (provider === 'openai' ? 'https://api.openai.com' : undefined);
    if (!baseUrl?.trim()) throw new Error('EMBEDDING_BASE_URL is required for this provider.');
    if (!env.EMBEDDING_MODEL?.trim()) throw new Error('EMBEDDING_MODEL is required for this provider.');
    if (!env.EMBEDDING_API_KEY?.trim()) throw new Error('EMBEDDING_API_KEY is required for this provider.');
    return new OpenAICompatibleEmbeddingService(baseUrl, env.EMBEDDING_API_KEY, env.EMBEDDING_MODEL);
  }
  if (provider) throw new Error('Unsupported EMBEDDING_PROVIDER; use ollama, openai, openai-compatible or litellm.');
  console.warn('EMBEDDING_PROVIDER not set — submit_offer/submit_want will fail until one is configured.');
  return new UnimplementedEmbeddingService();
}

// Persisted items use vector(1024). Other dimensions need a NEW migration and reindexing.
// Different models, even with 1024 dimensions, must never be silently mixed or used as fallback.
