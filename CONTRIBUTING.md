# Contributing

## Development

```bash
bun install
bun run typecheck
bun run lint
bun run test
```

`bun run test` is hermetic. `bun run test:live` runs a `/v1/embeddings` round
trip and skips unless `EMBEDDING_E2E_BASE_URL` is set; point it at a remote
server rather than loading models locally:

```bash
EMBEDDING_E2E_BASE_URL=http://100.113.184.123:11434/v1 bun run test:live
```

`EMBEDDING_E2E_MODEL` defaults to `nomic-embed-text`.

## Versioning

Semver. Releases run `bun run build && npm publish` with green CI.
