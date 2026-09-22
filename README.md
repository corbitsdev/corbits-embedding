# @corbits/embedding

One API for every embedding provider. Point at any OpenAI-compatible `/v1/embeddings` endpoint, swap models with a config change, and get ordered vectors back.

OpenAI, Ollama, TEI, vLLM, and Jina all serve the same wire shape. This package is one code path over that shape, with parameters for what varies between providers:

- `dimensions` — Matryoshka truncation for models that support it, including OpenAI `text-embedding-3` (down to 256), Jina v3 (32), and Jina v4 (128). Sent only when set, so models without MRL stay happy.
- `encodingFormat` — `float` (default) or compact `base64`.
- `batchSize` — inputs per request (default 32). Tune it to provider caps and per-request token ceilings.

Transport, error classification, and retry build on `@intx/inference`: requests go through the shared `deps.fetch` path, failures classify into `InferenceError` just like chat calls, and `createDefaultRetryPolicy` guides backoff. A 429 from an embeddings endpoint behaves like one from a chat endpoint, and credential failures short-circuit.

## Install

```bash
bun add @corbits/embedding
```

Runs on Bun >= 1.2 or Node >= 24. The built `dist/` entry is the default import.

## Quickstart

This package never touches credential storage or config sources — it takes an
already-built `EmbedConfig`. Where that config comes from is the host's
choice; `@corbits/memory`, for example, reads it straight from
`EMBED_BASE_URL`/`EMBED_MODEL`/`EMBED_API_KEY` env vars, all-or-nothing on the
first two. A host wraps `embedTexts` in a function of its own that builds the
config once (at startup, or per call) and probes dimensionality up front so a
later model swap is caught as a migration, not a silent width mismatch.

```ts
import { createDefaultScheduler } from "@intx/inference";
import {
  embedTexts,
  probeEmbedDims,
  type EmbedConfig,
} from "@corbits/embedding";

export function loadEmbedConfig(): EmbedConfig | undefined {
  const baseURL = process.env["EMBED_BASE_URL"];
  const model = process.env["EMBED_MODEL"];
  if (baseURL === undefined || model === undefined) return undefined;

  const apiKey = process.env["EMBED_API_KEY"];
  return { baseURL, model, ...(apiKey !== undefined ? { apiKey } : {}) };
}

export async function embed(
  texts: readonly string[],
  config: EmbedConfig,
): Promise<number[][]> {
  const deps = { fetch, scheduler: createDefaultScheduler() };
  return embedTexts(texts, config, { deps });
}

// At startup: fail fast if the configured model's width doesn't match
// what's already stored.
const config = loadEmbedConfig();
if (config !== undefined) {
  const deps = { fetch, scheduler: createDefaultScheduler() };
  const dims = await probeEmbedDims(config, { deps });
}
```

`embedTexts(texts, config, options)` batches sequentially, posts each batch to
`{baseURL}/embeddings`, and returns vectors in input order. `options` carries
`deps` (a host's real `fetch` plus `createDefaultScheduler()`, the production
scheduler), with optional `retryPolicy`, `extractRetryAfterMs`, and `signal`.

## Dimensionality

`probeEmbedDims(config, { deps })` embeds one probe string and reports the length received. Dimensionality follows the provider and the `dimensions` setting, so callers that persist vectors discover it at startup and treat a model swap as a migration. Representative widths: 1536 for OpenAI `text-embedding-3-small`, 768 for `nomic-embed-text`, 384 for `bge-small-en-v1.5`.

## Errors

Every failure mode — transport, HTTP status, or a 200 with an unexpected body — raises `ModelRequestError`, carrying the classified `InferenceError` as `reason` plus the request URL. The embedding and reranking packages each carry their own copy of this class while the shared transport is upstreamed, so code catching both discriminates on `error.name === "ModelRequestError"`.

## Lower-level: transport

The barrel also re-exports the one-shot JSON transport `embedTexts` is built on, for sibling clients that want the same classified, retried request path:

- `runJSONRequest` — one JSON POST with error classification and retry.
- `extractRetryAfterMs` — default `Retry-After` reader, overridable per call.
- `ModelRequestError` — error for every failure mode, with `reason` and URL.
- Types `RunRequestOptions` and `RetryAfterExtractor`.

## Interchange

Built on the shared `@intx/inference` transport, so an embeddings call fails and retries the same way a chat call does: same `deps.fetch` path, same `InferenceError` classification, same `createDefaultRetryPolicy` backoff. A retrieval pipeline typically pairs `probeEmbedDims` at startup with `embedTexts` batches at ingest and query time, as described above.

## Versioning

Semver. Releases run `bun run build && npm publish` with green CI.

## Development

```bash
bun install
bun test ./src
bunx tsc --noEmit
```

## License

LGPL-2.1-only — see [`LICENSE`](LICENSE).
