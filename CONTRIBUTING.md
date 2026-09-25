# Contributing

## Development

```bash
bun install
bun run typecheck
bun run lint
bun run test
bun run test:e2e
```

`bun run test` runs the colocated units in `src/`. `bun run test:e2e` runs
`e2e/`: retry, wire and base64 cases on the `@intx/inference-testing` harness
and a local HTTP stub, plus a `/v1/embeddings` round trip that skips unless
`EMBEDDING_E2E_BASE_URL` is set; point it at a remote server rather than
loading models locally:

```bash
EMBEDDING_E2E_BASE_URL=http://100.113.184.123:11434/v1 bun run test:e2e
```

`EMBEDDING_E2E_MODEL` defaults to `nomic-embed-text`.

## Versioning

Semver. Releases run `bun run build && npm publish` with green CI.

## Commit messages

Commit subjects and PR titles follow [Conventional Commits](https://www.conventionalcommits.org): `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `ci`, `perf`, and `chore(release): x.y.z` for releases.
Add `!` only for public API breaks: removed or renamed exports, changed signatures, newly required params. Peer and dependency range changes are `build(deps):` with no `!`.
Keep subjects imperative, lowercase after the colon, 72 characters or less, and free of ticket IDs.
Every PR links its issue with a `Closes <issue id>` line in the PR body.
