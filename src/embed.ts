import { type } from "arktype";
import type { BuiltRequest } from "@intx/inference";
import type { RetryPolicy } from "@intx/types/runtime";

import {
  runJSONRequest,
  type RequestDependencies,
  type RetryAfterExtractor,
} from "./request.js";

/**
 * `/v1/embeddings` is the one wire format worth supporting — OpenAI, Ollama,
 * TEI, vLLM and Jina all serve it. What differs between them is parameters, not
 * shape, so this is one code path with knobs rather than a provider switch.
 */
export const EmbedConfigSchema = type({
  /** Provider root including any version prefix, e.g. `http://host:11434/v1`. */
  baseURL: "string",
  model: "string",
  "apiKey?": "string",
  /**
   * Matryoshka truncation. Supported by OpenAI text-embedding-3 (down to 256),
   * Jina v3 (32) and v4 (128); rejected by models without MRL, so it is only
   * sent when set.
   */
  "dimensions?": "number > 0",
  /** `float` is the default; `base64` is denser on the wire. */
  "encodingFormat?": "'float'|'base64'",
  /**
   * Inputs per request. Providers cap this — OpenAI rejects arrays over 2048 —
   * and a smaller batch is also how you stay under a per-request token ceiling.
   */
  "batchSize?": "number.integer >= 1",
  "timeoutMs?": "number > 0",
});
export type EmbedConfig = typeof EmbedConfigSchema.infer;

/**
 * `index` is echoed on every entry and is authoritative: the reply is not
 * promised in request order. `embedding` is `number[]` for `float` and a
 * base64-packed little-endian float32 buffer for `base64`.
 */
const EmbedResponse = type({
  data: type({
    index: "number",
    embedding: "number[] | string",
  }).array(),
});

const DEFAULT_BATCH_SIZE = 32;
const PROBE_TEXT = "embedding dimension probe";

export type EmbedOptions = {
  deps: RequestDependencies;
  retryPolicy?: RetryPolicy;
  /**
   * Reads `Retry-After` off a failed response, for a provider that signals
   * pacing its own way. Named after `ProviderAdapter.extractRetryAfterMs`.
   * There is no adapter object here because every provider serves the one
   * `/v1/embeddings` shape, so this hangs off the options instead.
   */
  extractRetryAfterMs?: RetryAfterExtractor;
  signal?: AbortSignal;
};

function buildRequest(
  config: EmbedConfig,
  input: readonly string[],
): BuiltRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (config.apiKey !== undefined) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }

  return {
    url: `${config.baseURL}/embeddings`,
    headers,
    body: JSON.stringify({
      model: config.model,
      input,
      ...(config.dimensions !== undefined
        ? { dimensions: config.dimensions }
        : {}),
      ...(config.encodingFormat !== undefined
        ? { encoding_format: config.encodingFormat }
        : {}),
    }),
  };
}

/** Unpacks the `base64` encoding: a little-endian float32 buffer. */
function decodeBase64Embedding(encoded: string): number[] {
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  const floats = new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  return Array.from(floats);
}

/**
 * Read vectors back in request order.
 *
 * Placement is by the echoed `index`, never by reply position, and a reply that
 * does not carry exactly one entry per input is rejected. Callers pair these
 * vectors with their own texts positionally, so a reordered or short reply
 * would not fail — it would silently persist text/vector pairs that are wrong.
 */
function parseResponse(
  body: unknown,
  url: string,
  expected: number,
): number[][] {
  const parsed = EmbedResponse(body);
  if (parsed instanceof type.errors) {
    throw new Error(
      `${url}: malformed embeddings response — ${parsed.summary}`,
    );
  }
  if (parsed.data.length !== expected) {
    throw new Error(
      `${url}: expected ${expected} embeddings, got ${parsed.data.length}`,
    );
  }

  const vectors = new Array<number[] | undefined>(expected);
  for (const entry of parsed.data) {
    const taken = entry.index in vectors;
    if (entry.index < 0 || entry.index >= expected || taken) {
      throw new Error(`${url}: bad embedding index ${entry.index}`);
    }
    vectors[entry.index] =
      typeof entry.embedding === "string"
        ? decodeBase64Embedding(entry.embedding)
        : entry.embedding;
  }

  // No slot is empty: the count matches and every index was distinct.
  return vectors as number[][];
}

function batches(
  input: readonly string[],
  size: number,
): (readonly string[])[] {
  const out: (readonly string[])[] = [];
  for (let i = 0; i < input.length; i += size) {
    out.push(input.slice(i, i + size));
  }
  return out;
}

/**
 * Embed texts in order. Batches are sequential rather than concurrent: a
 * provider that rate-limits will otherwise see the whole corpus at once, and
 * the retry policy is per request, not per burst.
 */
export async function embedTexts(
  texts: readonly string[],
  config: EmbedConfig,
  options: EmbedOptions,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError(
      `batchSize must be an integer >= 1, got ${batchSize}: a batch size below 1 would never advance through the input`,
    );
  }

  const vectors: number[][] = [];
  for (const batch of batches(texts, batchSize)) {
    const request = buildRequest(config, batch);
    const body = await runJSONRequest(request, {
      deps: options.deps,
      ...(options.retryPolicy !== undefined
        ? { retryPolicy: options.retryPolicy }
        : {}),
      ...(config.timeoutMs !== undefined
        ? { timeoutMs: config.timeoutMs }
        : {}),
      ...(options.extractRetryAfterMs !== undefined
        ? { extractRetryAfterMs: options.extractRetryAfterMs }
        : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
    vectors.push(...parseResponse(body, request.url, batch.length));
  }
  return vectors;
}

/**
 * Discover a model's output dimensionality by embedding one probe string.
 *
 * Dimensionality is not knowable from the model name — it varies by provider
 * and is changed by `dimensions` — so callers that persist vectors must
 * discover it rather than assume.
 */
export async function probeEmbedDims(
  config: EmbedConfig,
  options: EmbedOptions,
): Promise<number> {
  const [vector] = await embedTexts([PROBE_TEXT], config, options);
  if (vector === undefined) {
    throw new Error(`${config.baseURL}: embed probe returned no vector`);
  }
  return vector.length;
}
