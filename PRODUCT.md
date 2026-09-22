# Product

`@corbits/embedding` is the client you call when you need vectors from an
OpenAI-compatible `/v1/embeddings` endpoint. Given a `baseURL`, a model, and
some texts, `embedTexts` batches them, posts each batch, validates the reply,
and returns vectors in input order.

## Why it exists

Embedding is not a chat turn. Callers persist vectors next to text and later
retrieve by similarity. A wrong pairing, an assumed dimension, or a one-off
HTTP client that does not retry a 429 the way a chat call does all corrupt
that store. This package is the one place that does the boring work: batch,
validate, place by echoed `index`, and fail loudly instead of silently
mispairing.

One wire format, not a provider switch. OpenAI, Ollama, TEI, vLLM, and Jina
all serve `/v1/embeddings`. What differs between them is parameters
(`dimensions`, `encodingFormat`, `batchSize`), not shape. Swap models without
rewriting the call site — but treat a swap as a migration, because output
dimensionality is not knowable from a model name.

## Who it is for

- Hosts that persist embeddings (memory, search, recall) and must discover
  dimensionality before writing a row.
- Sibling one-shot JSON clients that want the same classified, retried request
  path without assembling an inference `AdapterRegistry`.
- Anyone already holding an Interchange harness `Dependencies` — only `fetch`
  and `scheduler` are required; a full harness object satisfies that.

## Goals

- Callers can `embedTexts` and `probeEmbedDims` from `@corbits/embedding`
  with `{ fetch, scheduler }` and an `EmbedConfig`.
- A 429 from an embedding endpoint behaves as one from a chat endpoint; a
  credential failure aborts immediately.
- Dimensionality is discovered, never assumed. `probeEmbedDims` embeds one
  probe string and reports the length it got back. `dimensions` (Matryoshka
  truncation) changes that length when set.
- Empty input returns no vectors and issues no request.

## Non-goals

- A provider enum or adapter per vendor. There is one `/v1/embeddings` path.
- Inferring vector width from a model name.
- Concurrent batches. Sequential posting is how a rate-limited provider is
  not hit with the whole corpus at once.
