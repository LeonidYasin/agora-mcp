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
    throw new Error(
      "EmbeddingService.embed() is not configured — set EMBEDDING_PROVIDER (ollama|openai)."
    );
  }
}

/**
 * Calls a local/self-hosted Ollama instance's embeddings endpoint
 * (e.g. `nomic-embed-text`, per docs/synapse-protocol.md's provider table).
 */
export class OllamaEmbeddingService implements EmbeddingService {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string
  ) {}

  async embed(text: string, role: ItemRole): Promise<number[]> {
    const prefixed = ROLE_PREFIX[role] + text;
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: prefixed }),
    });
    if (!response.ok) {
      throw new Error(`Ollama embeddings request failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
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
    private readonly model: string
  ) {}

  async embed(text: string, role: ItemRole): Promise<number[]> {
    const prefixed = ROLE_PREFIX[role] + text;
    const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: prefixed }),
    });
    if (!response.ok) {
      throw new Error(`Embeddings request failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
  }
}

/**
 * Picks a provider from environment variables:
 *   EMBEDDING_PROVIDER = "ollama" | "openai" | unset
 *   EMBEDDING_MODEL    = model name (required for ollama/openai)
 *   EMBEDDING_BASE_URL = provider base URL
 *                        (default http://127.0.0.1:11434 for ollama,
 *                         https://api.openai.com for openai)
 *   EMBEDDING_API_KEY  = required for openai
 *
 * NOTE: whatever model you pick, `vector(1024)` in
 * db/migrations/001_init.sql must match its output dimension
 * (e.g. bge-m3/multilingual-e5-large = 1024; adjust the migration if you
 * pick a different-dimension model).
 */
export function createEmbeddingService(): EmbeddingService {
  const provider = process.env.EMBEDDING_PROVIDER;

  if (provider === "ollama") {
    const baseUrl = process.env.EMBEDDING_BASE_URL ?? "http://127.0.0.1:11434";
    const model = process.env.EMBEDDING_MODEL;
    if (!model) throw new Error("EMBEDDING_MODEL is required when EMBEDDING_PROVIDER=ollama");
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
