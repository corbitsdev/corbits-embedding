# Contributing

## Development

```bash
bun install
bun run typecheck
bun run lint
bun run test
```

`bun run test` includes a live `/v1/embeddings` round trip that runs when
`EMBEDDING_E2E_BASE_URL` (default `http://localhost:11434/v1`) is reachable
and skips otherwise. `EMBEDDING_E2E_MODEL` defaults to `nomic-embed-text`.

## Versioning

Semver. Releases run `bun run build && npm publish` with green CI.
