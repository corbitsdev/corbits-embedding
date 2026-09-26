# AGENTS.md

## Purpose

`@corbits/embedding` turns texts into vectors over any OpenAI-compatible
`/v1/embeddings` endpoint, with `@intx/inference` retries and error
classification. It owns batching, reply integrity and the one-shot JSON
transport. It does not store or search vectors; that is `@corbits/memory`.

## Layout

- `src/embed.ts`: `EmbedConfigSchema`, `embedTexts`, `probeEmbedDims`, batch
  splitting and reply parsing (float and base64).
- `src/request.ts`: `runJSONRequest` (private transport), `EmbeddingRequestError`,
  `Retry-After` extraction.
- `src/index.ts`: the only module consumers import from.
- `e2e/`: harness-driven retry, wire and base64 suites, plus a live round trip
  gated on `EMBEDDING_E2E_BASE_URL`.

## Rules

- Place vectors by the echoed `index`, never by array position. Reject short,
  duplicate or out-of-range replies instead of mispairing.
- Batches run sequentially; retry policy is per request.
- Throw `EmbeddingRequestError` carrying the classified `InferenceError` as
  `reason`; never throw the `InferenceError` itself.
- Read a 200 as text, then `JSON.parse`, so a non-JSON body classifies as a
  protocol mismatch.
- Omit `dimensions` and `encoding_format` from the wire unless configured.
- Backoff time comes from `deps.scheduler`, not wall-clock globals.
- `exactOptionalPropertyTypes` is on: omit optional keys, never assign
  `undefined` to them.

## Local development

```sh
bun install
bun run check
```
