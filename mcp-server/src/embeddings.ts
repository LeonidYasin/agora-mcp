/**
 * Embedding service abstraction.
 *
 * Every offer/want is embedded server-side with the SAME model and an
 * explicit role prefix, so vectors from different items land in a
 * comparable space and offer/want matching can be done asymmetrically
 * (an offer embedding is meant to be compared against want embeddings,
 * not other offer embeddings). See docs/architecture.md and
 * docs/synapse-protocol.md ("Инструкционные эмбеддинги") for the reasoning
 * behind role-prefixed embeddings and the provider table this mirrors.
 */

import { ToolError } from "./errors.js";

export const EMBEDDING_DIMENSION = 1024;

export function validateEmbedding(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== EMBEDDING_DIMENSION ||
      !value.every((v) => typeof v === "number" && Number.isFinite(v) && Number.isFinite(Math.fround(v))) ||
      !value.some((v) => Math.fround(v) !== 0)) {
    throw new ToolError("Embedding provider returned an invalid vector; expected 1024 finite values and nonzero norm.");
  }
  return value;
}

async function requestEmbedding(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new ToolError("Embedding provider unavailable.");
    return await response.json();
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError("Embedding provider unavailable or request timed out.");
  }
}

function readVector(data: unknown, provider: "ollama" | "openai"): number[] {
  const payload = data as { embeddings?: unknown[]; data?: Array<{ embedding?: unknown }> } | null;
  const vector = provider === "ollama"
    ? payload?.embeddings?.[0]
    : payload?.data?.[0]?.embedding;
  return validateEmbedding(vector);
}

export type ItemRole = "offer" | "want";

const ROLE_PREFIX: Record<ItemRole, string> = {
  offer: "Represent this offer for matching against user wants: ",
  want: "Represent this want for finding relevant offers: ",
};

export interface EmbeddingService {
  embed(text: string, role: ItemRole): Promise<number[]>;
}

/** Throws until a real provider is configured. Useful for tests/dry-runs. */
export class UnimplementedEmbeddingService implements EmbeddingService {
  async embed(text: string, role: ItemRole): Promise<number[]> {
    void ROLE_PREFIX[role];
    void text;
    throw new ToolError(
      "EmbeddingService.embed() is not configured — set EMBEDDING_PROVIDER (ollama|openai)."
    );
  }
}

/**
 * Calls a local/self-hosted Ollama instance's embeddings endpoint
 * (default model: bge-m3, per docs/synapse-protocol.md's provider table).
 */
export class OllamaEmbeddingService implements EmbeddingService {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly timeoutMs = 15000
  ) {}

  async embed(text: string, role: ItemRole): Promise<number[]> {
    const prefixed = ROLE_PREFIX[role] + text;
    // /api/embed is the current endpoint (batch-capable, returns `embeddings`);
    // the older /api/embeddings (singular `prompt`/`embedding`) is deprecated.
    const data = await requestEmbedding(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: prefixed }),
    }, this.timeoutMs);
    return readVector(data, "ollama");
  }
}

/**
 * Calls any OpenAI-compatible `/v1/embeddings` endpoint. Works with the
 * real OpenAI API or a self-hosted compatible server (vLLM, TEI, etc.).
 * Role prefixing is baked into the input text (see docs/synapse-protocol.md:
 * the `openai` provider has no native instruction-prefix mechanism, so we
 * use the same short role-prefix convention as the other providers).
 */
export class OpenAICompatibleEmbeddingService implements EmbeddingService {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs = 15000
  ) {}

  async embed(text: string, role: ItemRole): Promise<number[]> {
    const prefixed = ROLE_PREFIX[role] + text;
    const data = await requestEmbedding(`${this.baseUrl}/v1/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: prefixed }),
    }, this.timeoutMs);
    return readVector(data, "openai");
  }
}

/**
 * Picks a provider from environment variables:
 *   EMBEDDING_PROVIDER = "ollama" | "openai" | unset
 *   EMBEDDING_MODEL    = model name
 *                        (default "bge-m3" for ollama — 1024-dim,
 *                         multilingual; required, no default, for openai)
 *   EMBEDDING_BASE_URL = provider base URL
 *                        (default http://127.0.0.1:11434 for ollama,
 *                         https://api.openai.com for openai)
 *   EMBEDDING_API_KEY  = required for openai
 *
 * NOTE: whatever model you pick, `vector(1024)` in
 * db/migrations/001_init.sql must match its output dimension
 * (bge-m3 and mxbai-embed-large are both 1024; nomic-embed-text is 768 —
 * adjust the migration if you switch to a different-dimension model).
 */
export function createEmbeddingService(): EmbeddingService {
  const provider = process.env.EMBEDDING_PROVIDER;

  if (provider === "ollama") {
    const baseUrl = process.env.EMBEDDING_BASE_URL ?? "http://127.0.0.1:11434";
    // bge-m3 (1024-dim, multilingual) matches vector(1024) in
    // db/migrations/001_init.sql and docs/architecture.md's stated choice
    // (Leonid's users write in both Russian and English).
    const model = process.env.EMBEDDING_MODEL ?? "bge-m3";
    return new OllamaEmbeddingService(baseUrl, model);
  }

  if (provider === "openai") {
    const baseUrl = process.env.EMBEDDING_BASE_URL ?? "https://api.openai.com";
    const model = process.env.EMBEDDING_MODEL;
    const apiKey = process.env.EMBEDDING_API_KEY;
    if (!model) throw new Error("EMBEDDING_MODEL is required when EMBEDDING_PROVIDER=openai");
    if (!apiKey) throw new Error("EMBEDDING_API_KEY is required when EMBEDDING_PROVIDER=openai");
    return new OpenAICompatibleEmbeddingService(baseUrl, apiKey, model);
  }

  console.warn(
    "EMBEDDING_PROVIDER not set (expected 'ollama' or 'openai') — " +
      "submit_offer/submit_want will fail until one is configured."
  );
  return new UnimplementedEmbeddingService();
}
