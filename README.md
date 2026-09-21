# @corbits/embedding

Embedding client for OpenAI-compatible `/v1/embeddings` endpoints. Given a
`baseURL`, a model, and some texts, `embedTexts` batches them, posts each
batch, validates the reply, and returns vectors in input order.

One wire format, not a provider switch — OpenAI, Ollama, TEI, vLLM, and Jina
all serve `/v1/embeddings`.

## Install

```bash
npm install @corbits/embedding
pnpm add @corbits/embedding
yarn add @corbits/embedding
bun add @corbits/embedding
```

Requires Node >= 24 or Bun >= 1.2. The published export is built `dist/`;
native Node does not load this package's TypeScript source.

## Use

```ts
import { createDefaultScheduler } from "@intx/inference";
import { embedTexts } from "@corbits/embedding";

const deps = { fetch, scheduler: createDefaultScheduler() };
const [vector] = await embedTexts(
  ["hello world"],
  { baseURL: "http://localhost:11434/v1", model: "nomic-embed-text" },
  { deps },
);
```

Only `fetch` and `scheduler` are required — a full harness `Dependencies`
satisfies this if you already have one.

## Full example

```ts
import { createDefaultScheduler } from "@intx/inference";
import { embedTexts, probeEmbedDims } from "@corbits/embedding";

const deps = { fetch, scheduler: createDefaultScheduler() };
const config = {
  baseURL: "https://api.openai.com/v1",
  model: "text-embedding-3-small",
  apiKey: process.env.OPENAI_API_KEY,
  // dimensions: 256,          // Matryoshka truncation; sent only when set
  // encodingFormat: "float",  // or "base64"
  // batchSize: 32,            // OpenAI rejects arrays over 2048
};

const dims = await probeEmbedDims(config, { deps });
const vectors = await embedTexts(
  ["staging deploys run from main", "on-call rotation is weekly"],
  config,
  { deps },
);

console.log(dims, vectors[0]?.length);
```

`probeEmbedDims` embeds one probe string and reports the length it got back.
Dimensionality is not knowable from a model name — it varies by provider and
is changed by `dimensions` — so a caller that persists vectors must discover
it. Swapping models is a migration, not a config change.

Failures raise `ModelRequestError` (transport, HTTP status, or a 200 whose
body is not JSON), carrying the classified `InferenceError` as `reason` and
the URL. `@corbits/embedding` and `@corbits/reranking` each carry their own
copy of this class, so `instanceof` does not hold across the two — catch on
`error.name === "ModelRequestError"`.

## How it works

`embedTexts` splits the input on `batchSize` (default 32) and posts each
batch sequentially to `{baseURL}/embeddings`. Placement is by the echoed
`index`, never by reply position; a reordered or short reply is rejected
rather than silently pairing the wrong vector with a text.

Transport, error classification, and retry come from `@intx/inference`:
`deps.fetch` is the single request path, failures become an `InferenceError`
through the same classifiers a chat call uses, and `createDefaultRetryPolicy`
decides whether to back off or abort. A 429 from an embedding endpoint
therefore behaves as one from a chat endpoint; a `credential_failure` aborts
immediately.

The barrel also re-exports the one-shot JSON transport (`runJSONRequest`,
`extractRetryAfterMs`, `ModelRequestError`) for sibling clients that want
the same classified, retried request path.

## Contributing

```bash
bun install
bun run build      # tsc -p tsconfig.build.json
bun run test       # bun test ./src
bun run typecheck  # tsc --noEmit
```

Node >= 24, Bun >= 1.2.0.

LGPL-2.1-only — see [`LICENSE`](LICENSE).
