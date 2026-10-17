/** Thin OpenAI-compatible client; provider translation belongs in e.g. LiteLLM. */
import { ToolError } from './errors.js';

const MAX_RESPONSE_BYTES = 1_048_576;
export type TextMessage = { role: 'system' | 'user' | 'assistant'; content: string };
type TokenField = 'max_tokens' | 'max_completion_tokens';
type Options = { baseUrl: string; model: string; apiKey?: string; timeoutMs?: number;
  tokenField?: TokenField };

function apiBase(value: string): string {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) throw new Error();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/v1';
    return url.toString().replace(/\/+$/, '');
  } catch { throw new Error('Invalid model API base URL; use HTTPS or loopback HTTP without credentials/query/fragment.'); }
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error();
      chunks.push(part.value);
    }
    const data = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export class OpenAICompatibleGateway {
  private readonly base: string;
  private readonly timeout: number;
  constructor(private readonly options: Options) {
    this.base = apiBase(options.baseUrl);
    this.timeout = options.timeoutMs ?? 15000;
    if (!options.model?.trim() || options.model.length > 256 || /[\r\n]/.test(options.model) ||
        !Number.isInteger(this.timeout) || this.timeout < 1 || this.timeout > 120000 ||
        (options.apiKey !== undefined && (!options.apiKey.trim() || /[\r\n]/.test(options.apiKey))) ||
        (options.tokenField !== undefined && !['max_tokens', 'max_completion_tokens'].includes(options.tokenField)))
      throw new Error('Invalid model connector configuration.');
  }
  private async post(endpoint: 'embeddings' | 'chat/completions', body: Record<string, unknown>) {
    try {
      const response = await fetch(`${this.base}/${endpoint}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.timeout),
        headers: { 'Content-Type': 'application/json',
          ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}) },
        body: JSON.stringify({ ...body, model: this.options.model }),
      });
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(); }
      return await boundedJson(response);
    } catch { throw new ToolError('Model API unavailable or request timed out.'); }
  }
  /** Caller owns role prefixes, vector validation and persisted vector-space compatibility. */
  async embedding(input: string): Promise<unknown> {
    if (typeof input !== 'string' || !input.trim() || input.length > 16000)
      throw new ToolError('Invalid embedding input.');
    const data = await this.post('embeddings', { input, encoding_format: 'float' }) as
      { data?: Array<{ embedding?: unknown }> } | null;
    if (!Array.isArray(data?.data) || data.data.length !== 1)
      throw new ToolError('Model API returned an invalid embedding response.');
    return data.data[0]?.embedding;
  }
  /** Text only, no streaming/tools/vision. No automatic retries, routes or paid fallback. */
  async chat(messages: TextMessage[], maxOutputTokens: number): Promise<string> {
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 100 ||
        !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 8192 ||
        messages.some(m => !m || !['system', 'user', 'assistant'].includes(m.role) ||
          typeof m.content !== 'string' || !m.content.trim() || m.content.length > 64000) ||
        messages.reduce((sum, m) => sum + m.content.length, 0) > 64000)
      throw new ToolError('Invalid text chat request or output token limit.');
    const data = await this.post('chat/completions', {
      messages: messages.map(m => ({ role: m.role, content: m.content })), stream: false,
      [this.options.tokenField ?? 'max_tokens']: maxOutputTokens,
    }) as { choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }> } | null;
    const message = data?.choices?.[0]?.message;
    if (typeof message?.content !== 'string' || !message.content.trim() || message.tool_calls)
      throw new ToolError('Model API returned an unsupported text chat response.');
    return message.content;
  }
}

/** Optional capability: never constructed or called by existing marketplace tools. */
export function createChatService(env: NodeJS.ProcessEnv = process.env): OpenAICompatibleGateway | null {
  if (!env.LLM_PROVIDER) return null;
  if (!['openai-compatible', 'litellm'].includes(env.LLM_PROVIDER))
    throw new Error('Unsupported LLM_PROVIDER; use openai-compatible or litellm.');
  for (const name of ['LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY'])
    if (!env[name]?.trim()) throw new Error(`${name} is required when LLM_PROVIDER is set.`);
  if (env.LLM_TOKEN_FIELD && !['max_tokens', 'max_completion_tokens'].includes(env.LLM_TOKEN_FIELD))
    throw new Error('Invalid LLM_TOKEN_FIELD.');
  return new OpenAICompatibleGateway({ baseUrl: env.LLM_BASE_URL!, model: env.LLM_MODEL!,
    apiKey: env.LLM_API_KEY!, tokenField: env.LLM_TOKEN_FIELD as TokenField | undefined });
}
