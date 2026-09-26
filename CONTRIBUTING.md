# Contributing

## Development

```sh
bun install
bun run check
```

`bun run check` runs typecheck, lint, format check and unit tests. `bun run format` rewrites the tree.

Contributors sign the [CLA](CLA.md) on their first PR; the CLA bot explains how.

`bun run test:e2e` runs `e2e/`: retry, wire and base64 cases on the
`@intx/inference-testing` harness and a local HTTP stub, plus a
`/v1/embeddings` round trip that skips unless `EMBEDDING_E2E_BASE_URL` is set
(`EMBEDDING_E2E_MODEL` defaults to `nomic-embed-text`):

```sh
EMBEDDING_E2E_BASE_URL=http://<host>:11434/v1 bun run test:e2e
```

## Commit messages

Commit subjects and PR titles follow [Conventional Commits](https://www.conventionalcommits.org): `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `ci`, `perf`, and `chore(release): x.y.z` for releases.
Add `!` only for public API breaks: removed or renamed exports, changed signatures, newly required params. Peer and dependency range changes are `build(deps):` with no `!`.
Keep subjects imperative, lowercase after the colon, 72 characters or less, and free of ticket IDs.
Every PR links its issue with a `Closes <issue id>` line in the PR body.
