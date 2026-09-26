# Architecture

The package is two layers: a one-shot JSON transport, and an embedding client
built on it. There is no provider registry. Every call is HTTP POST to
`{baseURL}/embeddings`.

## Surfaces

Callers import from `@corbits/embedding`. The barrel is the public surface:

| Export                                        | Role                                                                |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `embedTexts`                                  | Batch texts, post sequentially, return `number[][]` in input order  |
| `probeEmbedDims`                              | Embed one probe string; report the vector length that came back     |
| `EmbedConfig` / `EmbedConfigSchema`           | Endpoint, model, and optional knobs                                 |
| `EmbedOptions`                                | Optional harness deps, retry, `Retry-After` override, abort         |
| `RequestDependencies` / `RetryAfterExtractor` | Types of the `EmbedOptions` fields                                  |
| `EmbeddingRequestError`                       | Every request failure — `reason` is the classified `InferenceError` |

The JSON transport (`runJSONRequest`) is private.

Quickstart shape (matches the README):

```ts
import { embedTexts } from "@corbits/embedding";

const [vector] = await embedTexts(["hello world"], {
  baseURL: "http://localhost:11434/v1",
  model: "nomic-embed-text",
});
```

`probeEmbedDims(config)` is the same config and options; it is not a
separate protocol.

## Request dependencies

The transport reads only `fetch` and `scheduler` from the harness
(`RequestDependencies`), defaulting to global `fetch` and
`createDefaultScheduler()`. That is deliberately narrower than Interchange
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

Following Interchange, the `InferenceError` is carried as data on a thrown
`Error` subclass (`EmbeddingRequestError`), never thrown itself.

`runJSONRequest` is duplicated, modulo comments, in `@corbits/reranking`,
which still throws its own `ModelRequestError`; code using both packages
checks two error classes. The intended home for the transport is
`@intx/inference`, as a non-streaming sibling of `runInference`.

## Failure modes

- Transport, HTTP status, or a 200 whose body is not JSON →
  `EmbeddingRequestError` with classified `reason` and the URL.
- Malformed embeddings JSON, wrong count, bad index →
  `EmbeddingRequestError` with a `classifyProtocolMismatch` reason.
- Config failing `EmbedConfigSchema` (e.g. `batchSize` not an integer
  `>= 1`) → arktype `TraversalError` before any request.
- Empty `texts` → `[]`, no request.
- Caller `signal` or per-attempt timeout (default 30s) abort the attempt;
  aborting mid-delay wakes immediately and the next attempt fails its
  entry-time signal check.
