# @corbits/embedding

Batched text embeddings over any OpenAI-compatible `/v1/embeddings` endpoint, built on `@intx/inference` retries and error classification. A retrieval building block for Corbits and Interchange agents that also works standalone.

## Why @corbits/embedding?

1. **One client for every provider.** OpenAI, Ollama, TEI, vLLM and Jina all speak the same wire format. Switching models is a config change.
2. **Order-safe batching.** Inputs are split into batches, and vectors come back in input order, placed by the index each response echoes. Short or duplicate replies throw instead of misaligning results.
3. **Interchange retry semantics.** Requests run through `@intx/inference`, so a 429 backs off and a 401 fails the same way it does for inference calls. Failures throw a typed `EmbeddingRequestError`.

It does not store or search vectors. For that, pair it with [`@corbits/memory`](https://github.com/corbitsdev/corbits-memory).

## Install

```bash
bun add @corbits/embedding @intx/inference@^0.4.0 @intx/types@^0.4.0
```

Runs on Bun >= 1.2 or Node >= 24.

## Quickstart

Needs a local Ollama with `nomic-embed-text` pulled.

```ts
import { embedTexts } from "@corbits/embedding";

const vectors = await embedTexts(["a", "b"], {
  baseURL: "http://localhost:11434/v1",
  model: "nomic-embed-text",
});
console.log(vectors.length, vectors[0]?.length); // 2 768
```

## Where it fits

[Interchange](https://github.com/faremeter/interchange) runs AI agents as principals (accounts that hold their own identity, permissions and credentials). Corbits packages add what an agent product needs around it.

- **Runs in:** any process: the Interchange hub (the multi-tenant control plane), an agent sidecar (the runtime next to each agent), or a plain script. No hub is required.
- **Plugs into:** [`@intx/inference`](https://github.com/faremeter/interchange) for transport, retries and error classification, and [`@intx/types`](https://github.com/faremeter/interchange).
- **Pairs with:** [`@corbits/reranking`](https://github.com/corbitsdev/corbits-reranking) to reorder results and [`@corbits/memory`](https://github.com/corbitsdev/corbits-memory) to store and search vectors.

## Reference

| Export                                       | Description                                                 |
| -------------------------------------------- | ----------------------------------------------------------- |
| `embedTexts(texts, config, options?)`        | Embeds the texts and returns one vector per text, in order. |
| `probeEmbedDims(config, options?)`           | Embeds one probe string and returns the vector dimension.   |
| `EmbedConfigSchema`, `EmbedConfig`           | Schema and type for `config`.                               |
| `EmbedOptions`                               | Type for `options`.                                         |
| `EmbeddingRequestError`                      | Thrown when a request fails.                                |
| `RequestDependencies`, `RetryAfterExtractor` | Types for `options.deps` and `options.extractRetryAfterMs`. |

### Config

| Field            | Type                   | Description                                                              |
| ---------------- | ---------------------- | ------------------------------------------------------------------------ |
| `baseURL`        | `string`               | Server root with its version path, such as `http://host:11434/v1`.       |
| `model`          | `string`               | Model name.                                                              |
| `apiKey`         | `string?`              | Sent as a bearer token.                                                  |
| `dimensions`     | `number?`              | Requested output dimension. Sent only when set; not all models honor it. |
| `encodingFormat` | `"float" \| "base64"?` | Wire format. Defaults to `float`. Results are always `number[]`.         |
| `batchSize`      | `number?`              | Texts per request. Defaults to 32.                                       |
| `timeoutMs`      | `number?`              | Per-request timeout. Defaults to 30000.                                  |

### Options

| Field                 | Description                                                                     |
| --------------------- | ------------------------------------------------------------------------------- |
| `deps`                | `{ fetch, scheduler }`. Defaults to global `fetch` and Interchange's scheduler. |
| `retryPolicy`         | Retry policy. Defaults to Interchange's policy.                                 |
| `extractRetryAfterMs` | Reads the server's retry delay. Defaults to parsing `Retry-After`.              |
| `signal`              | Aborts all pending requests.                                                    |

### Errors

A failed request throws `EmbeddingRequestError` with a classified `reason` and the request `url`. An invalid config throws before any request is sent.

### Dimensions

Each model has a fixed output dimension: 768 for `nomic-embed-text`, 1536 for OpenAI `text-embedding-3-small`. If you store vectors, call `probeEmbedDims` at startup. Changing models changes the dimension, so treat it as a schema migration.

## Using with Interchange

`@intx/inference` and `@intx/types` are peer dependencies, so your host's Interchange version supplies them.

To share your host's retry scheduler, pass it as `options.deps.scheduler` along with `fetch`.

## Upgrading from 0.1

- Install `@intx/inference` and `@intx/types` (^0.4.0) yourself. They are now peer dependencies.
- `ModelRequestError` is renamed to `EmbeddingRequestError`.
- `runJSONRequest`, `extractRetryAfterMs` and `RunRequestOptions` are no longer exported. To change how retry waits are read, pass `options.extractRetryAfterMs`.
- Config and returned vectors are unchanged.

## License

[LGPL-2.1-only](https://github.com/corbitsdev/corbits-embedding/blob/main/LICENSE)
