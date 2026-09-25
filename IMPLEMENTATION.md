# Implementation

## Package

`@corbits/embedding` is an ESM TypeScript package. Development runtime is
Bun `>= 1.2.0`. Node `>= 24` consumes built `dist/`; native Node does not
load this package's TypeScript source.

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  }
}
```

`bun run build` is `tsc -p tsconfig.build.json` (`outDir: dist`,
`rootDir: src`, tests excluded). Published files are `dist`, `README.md`,
and `LICENSE`. Install from the registry:

```bash
npm add @corbits/embedding
pnpm add @corbits/embedding
yarn add @corbits/embedding
bun add @corbits/embedding
```

## Dependencies

| Package                            | Use                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `@intx/inference` (peer, `^0.4.0`) | `BuiltRequest`, `createDefaultRetryPolicy`, error classifiers, `createDefaultScheduler` (caller-side) |
| `@intx/types` (peer, `^0.4.0`)     | `RetryPolicy`, `InferenceError`                                                                       |
| `arktype`                          | `EmbedConfigSchema` and the embeddings reply shape                                                    |

Dev: `@intx/inference`, `@intx/types` and `@intx/inference-testing` pinned at 0.4.0, `@types/bun`, `prettier`, `typescript` 5.9.

## HTTP

Each batch is:

- `POST {baseURL}/embeddings` (`baseURL` already includes the version
  prefix, e.g. `http://localhost:11434/v1` or `https://api.openai.com/v1`)
- `content-type: application/json`
- `authorization: Bearer {apiKey}` only when `apiKey` is set
- `redirect: "manual"`
- body:

```json
{
  "model": "<config.model>",
  "input": ["…"],
  "dimensions": 256,
  "encoding_format": "float"
}
```

`dimensions` and `encoding_format` are omitted unless configured. Models
without Matryoshka reject `dimensions` outright, so an unset knob must not
appear. Client field is `encodingFormat`; wire field is `encoding_format`
(`float` | `base64`). Default `batchSize` is 32 (OpenAI rejects arrays over
2048). Default per-attempt timeout is 30s (`AbortSignal.timeout`, combined
with a caller `signal` via `AbortSignal.any`).

A 200 is read as text then `JSON.parse`. `res.json()` is not used: an HTML
interstitial or truncated body in front of a local model server must classify
as protocol mismatch, not escape as `SyntaxError`.

## arktype

`EmbedConfigSchema` (`src/embed.ts`):

- required: `baseURL: string`, `model: string`
- optional: `apiKey`, `dimensions` (`number > 0`), `encodingFormat`
  (`'float'|'base64'`), `batchSize` (`number.integer >= 1`), `timeoutMs`
  (`number > 0`)

Reply: `{ data: { index: number, embedding: number[] | string }[] }`.
Base64 strings decode with `atob` → `Uint8Array` → little-endian
`Float32Array` → `number[]`.

`embedTexts` asserts `config` against `EmbedConfigSchema` first, so a
`batchSize` below 1 cannot stall `batches` (`i += size`).

## Errors and retry

`runJSONRequest` (`src/request.ts`) loops:

1. `deps.fetch` POST
2. non-OK → `classifyHTTPError(status, detail, detail, retryAfterMs)`
3. network throw → `classifyNetworkError` or `classifyAbortError`
4. JSON parse fail → `classifyProtocolMismatch`
5. `retryPolicy` (default `createDefaultRetryPolicy`) → `abort` throws
   `EmbeddingRequestError`, else sleep `delayMs` on `deps.scheduler`

`extractRetryAfterMs` reads `Retry-After` as seconds or HTTP-date, clamped
at zero. Callers override via `EmbedOptions.extractRetryAfterMs` (same
signature as Interchange's unexported extractor; re-declared so this
package depends only on the published surface).

## Tests

`bun run test` runs `bun test ./src ./tests`.

- `src/embed.test.ts` — units on `@intx/inference-testing` fakes: index
  placement across batches, short reply, base64 decode.
- `tests/retry.test.ts` — 429 retried once after `Retry-After` on the
  harness clock; 401 rejects without retry.
- `tests/base64.test.ts` — `base64` and `float` agree over a real HTTP stub.
- `live/embeddings.test.ts` (`bun run test:live`, not in `test` or CI) —
  round trip against a real `/v1/embeddings` (`EMBEDDING_E2E_BASE_URL`,
  required; `EMBEDDING_E2E_MODEL`, default `nomic-embed-text`).
  Skips when unset or unreachable.
