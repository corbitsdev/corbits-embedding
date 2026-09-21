# @corbits/embedding

Embedding client for OpenAI-compatible `/v1/embeddings` endpoints. Given a
`baseURL`, a model, and some texts, `embedTexts` batches them, posts each batch,
validates the response, and returns vectors in input order.

One wire format, not a provider switch. OpenAI, Ollama, TEI, vLLM and Jina all
serve `/v1/embeddings` — what differs between them is parameters:

- `dimensions` — Matryoshka truncation, supported by OpenAI text-embedding-3
  (down to 256), Jina v3 (32) and v4 (128). Models without MRL reject it, so it
  is only sent when set.
- `encodingFormat` — `float` or `base64`.
- `batchSize` — providers cap inputs per request; OpenAI rejects arrays over
  2048, and a smaller batch is also how you stay under a token ceiling.

Transport, error classification and retry come from `@intx/inference` rather
than being reimplemented here: `deps.fetch` is the single request path,
failures become an `InferenceError` through the same classifiers a chat call
uses, and `createDefaultRetryPolicy` decides whether to back off or abort. A 429
from an embedding endpoint therefore behaves exactly as one from a chat
endpoint, and a `credential_failure` aborts immediately rather than retrying a
bad key.

## Installation

Not published to npm yet. Until a registry publish, `npm install @corbits/embedding`
404s. Git is the install path.

```bash
bun add github:corbitsdev/corbits-embedding
```

Requires Node >= 20 or Bun >= 1.2. The default export is built `dist/`; native Node
does not load this package's extensionless TypeScript source.

```ts
import { createDefaultScheduler } from "@intx/inference";
import { embedTexts, probeEmbedDims } from "@corbits/embedding";

// Only `fetch` and `scheduler` are needed — a full harness `Dependencies`
// also satisfies this if you already have one.
const deps = { fetch, scheduler: createDefaultScheduler() };

const config = {
  baseURL: "http://localhost:11434/v1", // include the provider's version prefix
  model: "nomic-embed-text",
};

const dims = await probeEmbedDims(config, { deps });
const [vector] = await embedTexts(["hello world"], config, { deps });
```

## Dimensionality is discovered, never assumed

`probeEmbedDims` embeds one probe string and reports the length it got back.
Dimensionality is not knowable from a model name — it varies by provider and is
changed by `dimensions` — so a caller that persists vectors must discover it.
Defaults differ enough to matter: 1536 for OpenAI `text-embedding-3-small`, 768
for `nomic-embed-text`, 384 for `bge-small-en-v1.5`. Swapping models is a
migration, not a config change.

## Errors

Every failure — transport, HTTP status, or a 200 whose body is not JSON —
raises `ModelRequestError`, carrying the classified `InferenceError` as `reason`
and the URL.

Note that `@corbits/embedding` and `@corbits/reranking` each carry their own
copy of this class until the shared transport is upstreamed, so `instanceof`
does not hold across the two. Catching both? Discriminate on
`error.name === "ModelRequestError"`.

## Transport exports

The barrel re-exports the transport `embedTexts` is built on, for sibling
one-shot JSON clients that want the same classified, retried request path
without touching `@intx/inference` internals:

- `runJSONRequest` — one JSON POST with error classification and retry.
- `extractRetryAfterMs` — the default `Retry-After` reader, overridable per
  call via `extractRetryAfterMs`.
- `ModelRequestError` — the error every failure mode raises, carrying the
  classified `InferenceError` as `reason` and the URL.
- Types `RunRequestOptions` and `RetryAfterExtractor`.

## Versioning

Semver. Released manually with `bun run build && npm publish` once CI is green.

## Development

```bash
bun install
bun test ./src
bunx tsc --noEmit
```

## License

LGPL-2.1-only — see [`LICENSE`](LICENSE).
