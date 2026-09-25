# @corbits/embedding

One API for every embedding provider. Point at any OpenAI-compatible `/v1/embeddings` endpoint, swap models with a config change, and get ordered vectors back.

OpenAI, Ollama, TEI, vLLM, and Jina all serve the same wire shape. This package is one code path over that shape, with parameters for what varies between providers:

- `dimensions` — Matryoshka truncation for models that support it, including OpenAI `text-embedding-3` (down to 256), Jina v3 (32), and Jina v4 (128). Sent only when set, so models without MRL stay happy.
- `encodingFormat` — `float` (default) or compact `base64`.
- `batchSize` — inputs per request (default 32). Tune it to provider caps and per-request token ceilings.

## Install

```bash
bun add @corbits/embedding
```

Runs on Bun >= 1.2 or Node >= 24. The built `dist/` entry is the default import.

## Quickstart

```ts
import { embedTexts } from "@corbits/embedding";

const config = {
  baseURL: "http://localhost:11434/v1",
  model: "nomic-embed-text",
};

const vectors = await embedTexts(["a", "b"], config);
console.log(vectors.length, vectors[0]?.length); // 2 768
```

`embedTexts(texts, config, options?)` batches sequentially, posts each batch to
`{baseURL}/embeddings`, and returns vectors in input order. `options` is
optional: `deps` (defaults to global `fetch` and `createDefaultScheduler()`),
`retryPolicy`, `extractRetryAfterMs`, and `signal`.

## Dimensionality

`probeEmbedDims(config)` embeds one probe string and reports the length received. Dimensionality follows the provider and the `dimensions` setting, so callers that persist vectors discover it at startup and treat a model swap as a migration. Representative widths: 1536 for OpenAI `text-embedding-3-small`, 768 for `nomic-embed-text`, 384 for `bge-small-en-v1.5`.

## Errors

Every failure — transport, HTTP status, or a 200 with an unexpected body — throws `EmbeddingRequestError` (`extends Error`), carrying the classified `InferenceError` as `reason` and the request `url`. A config that fails `EmbedConfigSchema` throws before any request.

## Using with Interchange

Transport, error classification, and retry build on `@intx/inference`: requests go through `deps.fetch`, failures classify into `InferenceError` just like chat calls, and `createDefaultRetryPolicy` guides backoff. A 429 from an embeddings endpoint behaves like one from a chat endpoint, and credential failures short-circuit. `@intx/inference` and `@intx/types` are peer dependencies, so the host's Interchange version is the one used.

## License

LGPL-2.1-only — see [`LICENSE`](LICENSE).
