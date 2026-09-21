# Architecture

The package is two layers: a one-shot JSON transport, and an embedding client
built on it. There is no provider registry. Every call is HTTP POST to
`{baseURL}/embeddings`.

## Surfaces

Callers import from `@corbits/embedding`. The barrel is the public surface:

| Export | Role |
| --- | --- |
| `embedTexts` | Batch texts, post sequentially, return `number[][]` in input order |
| `probeEmbedDims` | Embed one probe string; report the vector length that came back |
| `EmbedConfig` / `EmbedConfigSchema` | Endpoint, model, and optional knobs |
| `EmbedOptions` | Harness deps plus optional retry, `Retry-After` override, abort |
| `runJSONRequest` | Classified, retried JSON POST (sibling clients reuse this) |
| `extractRetryAfterMs` | Default `Retry-After` reader (seconds or HTTP-date) |
| `ModelRequestError` | Transport, HTTP, or non-JSON 200 — `reason` is the classified `InferenceError` |

Quickstart shape (matches the README):

```ts
import { createDefaultScheduler } from "@intx/inference";
import { embedTexts, probeEmbedDims } from "@corbits/embedding";

const deps = { fetch, scheduler: createDefaultScheduler() };
const [vector] = await embedTexts(
  ["hello world"],
  { baseURL: "http://localhost:11434/v1", model: "nomic-embed-text" },
  { deps },
);
```

`probeEmbedDims(config, { deps })` is the same config and deps; it is not a
separate protocol.

## Request dependencies

The transport reads only `fetch` and `scheduler` from the harness
(`RequestDependencies`). That is deliberately narrower than Interchange
`Dependencies`, whose `adapters` registry a caller should not have to
assemble in order to embed a string. A real `Dependencies` still satisfies
the pick structurally.

Time for retry backoff comes from `deps.scheduler`, not wall-clock globals,
so a virtual-clock test scheduler drives the loop deterministically. The
HTTP-date form of `Retry-After` is the exception: it names an absolute
instant and is resolved against wall time.

## Control flow

```
embedTexts(texts, config, options)
  → split on batchSize (default 32)
  → for each batch, sequentially:
        build POST {baseURL}/embeddings
        runJSONRequest (classify + retry)
        parse body: place by echoed index, reject short / duplicate / OOB
  → concatenate batch results in input order
```

`probeEmbedDims` is `embedTexts` of one fixed probe string, then
`vector.length`.

Batches are sequential, not concurrent: the retry policy is per request, not
per burst, and a rate-limited provider must not see the whole corpus at once.

## Reply integrity

The OpenAI-compatible reply is not promised in request order. Placement is
by the echoed `index`, never by array position. A reordered reply is
reordered back; a short reply, a duplicate index, or a missing slot is
rejected. Callers pair returned vectors with their own texts positionally —
a silent mispair would persist the wrong vector.

`embedding` on the wire is either `number[]` (`float`) or a base64-packed
little-endian float32 buffer (`base64`). The client always returns
`number[]`.

## Transport vs `runInference`

`runInference` is turn-shaped and streams SSE. An embedding is one-shot JSON.
What carries over is everything around the body: the single `deps.fetch`
path, the `InferenceError` classifiers (`classifyHTTPError`,
`classifyNetworkError`, `classifyAbortError`, `classifyProtocolMismatch`),
and `createDefaultRetryPolicy` (back off retryables, abort the rest). A 429
is therefore classified and backed off as a chat 429 would be; a
`credential_failure` aborts immediately.

`runJSONRequest` is duplicated, modulo comments, in `@corbits/reranking`. It
is not shared infrastructure yet — the intended home is `@intx/inference` as
a non-streaming sibling of `runInference`. Until then, `ModelRequestError` is
a distinct class in each package: `instanceof` does not hold across the two.
Catch on `error.name === "ModelRequestError"`.

## Failure modes

- Transport, HTTP status, or a 200 whose body is not JSON →
  `ModelRequestError` with classified `reason` and the URL.
- Malformed embeddings JSON, wrong count, bad index → thrown `Error` (not
  `ModelRequestError`); the protocol succeeded, the payload did not.
- `batchSize` not an integer `>= 1` → `RangeError` before any request
  (`i += size` of 0 would never advance).
- Empty `texts` → `[]`, no request.
- Caller `signal` or per-attempt timeout (default 30s) abort the attempt;
  aborting mid-delay wakes immediately and the next attempt fails its
  entry-time signal check.
