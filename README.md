# @corbits/embedding

One API for every embedding provider. Point at any OpenAI-compatible `/v1/embeddings` endpoint, swap models with a config change, and get ordered vectors back.

OpenAI, Ollama, TEI, vLLM, and Jina all serve the same wire shape. This package is one code path over that shape, with parameters for what varies between providers:

- `dimensions` — Matryoshka truncation for models that support it, including OpenAI `text-embedding-3` (down to 256), Jina v3 (32), and Jina v4 (128). Sent only when set, so models without MRL stay happy.
- `encodingFormat` — `float` (default) or compact `base64`.
- `batchSize` — inputs per request (default 32). Tune it to provider caps and per-request token ceilings.

Transport, error classification, and retry build on `@intx/inference`: requests go through the shared `deps.fetch` path, failures classify into `InferenceError` just like chat calls, and `createDefaultRetryPolicy` guides backoff. A 429 from an embeddings endpoint behaves like one from a chat endpoint, and credential failures short-circuit.

## Runtime support

Runs on Bun >= 1.2 or Node >= 24. The built `dist/` entry is the default import.

## Quickstart

```bash
bun add @corbits/embedding
```

`embedTexts(texts, config, options)` batches sequentially, posts each batch to `{baseURL}/embeddings`, and returns vectors in input order. Options carry `deps`, with optional `retryPolicy`, `extractRetryAfterMs`, and `signal`.

```ts
import { createDefaultScheduler } from "@intx/inference";
import {
  embedTexts,
  probeEmbedDims,
  type EmbedConfig,
} from "@corbits/embedding";

const config: EmbedConfig = {
  baseURL: "http://localhost:11434/v1", // provider root, version prefix included
  model: "nomic-embed-text",
};
const deps = { fetch, scheduler: createDefaultScheduler() };

const dims = await probeEmbedDims(config, { deps });
const [vector] = await embedTexts(["hello world"], config, { deps });
if (vector === undefined) throw new Error("embed probe returned no vector");
console.log({ dims, length: vector.length });
```

## How it works

`probeEmbedDims(config, { deps })` embeds one probe string and reports the length received. Dimensionality follows the provider and the `dimensions` setting, so callers that persist vectors discover it at startup and treat a model swap as a migration. Representative widths: 1536 for OpenAI `text-embedding-3-small`, 768 for `nomic-embed-text`, 384 for `bge-small-en-v1.5`.

Every failure mode — transport, HTTP status, or a 200 with an unexpected body — raises `ModelRequestError`, carrying the classified `InferenceError` as `reason` plus the request URL. The embedding and reranking packages each carry their own copy of this class while the shared transport is upstreamed, so code catching both discriminates on `error.name === "ModelRequestError"`.

The barrel also re-exports the one-shot JSON transport `embedTexts` is built on, for sibling clients that want the same classified, retried request path: `runJSONRequest`, `extractRetryAfterMs`, `ModelRequestError`, and types `RunRequestOptions` and `RetryAfterExtractor`.

Interchange hubs and ingestion workers use this package for embeddings behind the shared `@intx/inference` transport: same fetch path, same error taxonomy, and same retry behavior as chat. Memory and retrieval pipelines pair `probeEmbedDims` at startup with `embedTexts` batches at ingest and query time.

## Development

```bash
bun install
bun test ./src
bunx tsc --noEmit
```

## License

LGPL-2.1-only — see [`LICENSE`](LICENSE).
