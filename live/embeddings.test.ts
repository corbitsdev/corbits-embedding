import { describe, expect, test } from "bun:test";

import { embedTexts, probeEmbedDims } from "../src/index";

// Any OpenAI-compatible `/v1/embeddings` server. Skips unless
// EMBEDDING_E2E_BASE_URL is set, so it never loads a model on this machine.
const baseURL = process.env.EMBEDDING_E2E_BASE_URL;
const model = process.env.EMBEDDING_E2E_MODEL ?? "nomic-embed-text";

// Skips unless the server answers and lists the model.
const reachable =
  baseURL !== undefined &&
  (await fetch(`${baseURL}/models`, {
    signal: AbortSignal.timeout(1_000),
  }).then(
    async (res) => res.ok && (await res.text()).includes(`"${model}`),
    () => false,
  ));
const config = { baseURL: baseURL ?? "", model };

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  a.forEach((x, i) => {
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  });
  return dot / Math.sqrt(na * nb);
}

describe.skipIf(!reachable)(`live /v1/embeddings at ${config.baseURL}`, () => {
  test("embeds three texts in input order at the probed width", async () => {
    const texts = ["the cat sat", "quarterly revenue grew", "rust borrowck"];
    const dims = await probeEmbedDims(config);
    const vectors = await embedTexts(texts, config);

    expect(vectors).toHaveLength(texts.length);
    for (const vector of vectors) expect(vector).toHaveLength(dims);

    // Order: each batched vector matches that text embedded alone.
    for (const [i, text] of texts.entries()) {
      const [alone] = await embedTexts([text], config);
      expect(cosine(vectors[i] ?? [], alone ?? [])).toBeGreaterThan(0.99);
    }
  }, 120_000); // a cold local model can take a while to page in
});
