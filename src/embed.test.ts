import { afterEach, expect, test } from "bun:test";
import { setupHarness, type Harness } from "@intx/inference-testing";

import { embedTexts, type EmbedConfig } from "./embed";
import { EmbeddingRequestError } from "./request";

const CONFIG: EmbedConfig = {
  baseURL: "https://embed.example/v1",
  model: "text-embedding-3-small",
};

let harness: Harness | undefined;
afterEach(() => {
  harness?.dispose();
  harness = undefined;
});

/** Queues one JSON reply per call, served to requests in order. */
function replies(...bodies: unknown[]): Harness {
  const h = setupHarness();
  for (const body of bodies) {
    const stream = h.scenario.createStream();
    h.scenario.whenRequestMatches(() => true, stream);
    stream.enqueueAll([new TextEncoder().encode(JSON.stringify(body))], {
      startAt: 1,
    });
  }
  return h;
}

async function run<T>(h: Harness, pending: Promise<T>): Promise<T> {
  await h.run();
  return await pending;
}

test("places vectors by echoed index and keeps order across batches", async () => {
  // Batch 2 restarts at index 0, and batch 1 arrives reversed: a parser that
  // placed by reply position would mispair text and vector.
  harness = replies(
    {
      data: [
        { index: 1, embedding: [1] },
        { index: 0, embedding: [0] },
      ],
    },
    { data: [{ index: 0, embedding: [2] }] },
  );
  const vectors = await run(
    harness,
    embedTexts(
      ["a", "b", "c"],
      { ...CONFIG, batchSize: 2 },
      { deps: harness.deps },
    ),
  );
  expect(vectors).toEqual([[0], [1], [2]]);
});

test("rejects a short reply rather than shifting every later batch", async () => {
  harness = replies({ data: [{ index: 0, embedding: [0.1] }] });
  const pending = embedTexts(["a", "b"], CONFIG, { deps: harness.deps });
  await harness.run();
  await expect(pending).rejects.toThrow(/expected 2 embeddings, got 1/);
});

test("decodes the base64 encoding it advertises", async () => {
  const packed = Buffer.from(new Float32Array([1.5, -2.5]).buffer).toString(
    "base64",
  );
  harness = replies({ data: [{ index: 0, embedding: packed }] });
  const vectors = await run(
    harness,
    embedTexts(
      ["a"],
      { ...CONFIG, encodingFormat: "base64" },
      { deps: harness.deps },
    ),
  );
  expect(vectors).toEqual([[1.5, -2.5]]);
});

test("rejects duplicate indices and undecodable base64", async () => {
  for (const data of [
    [
      { index: 0, embedding: [0.1] },
      { index: 0, embedding: [0.2] },
    ],
    [
      { index: 0, embedding: "!!!notbase64" },
      { index: 1, embedding: "AAAAAA==" },
    ],
    [
      { index: 0, embedding: "AAAAAA==" },
      { index: 1, embedding: "AAA=" },
    ],
  ]) {
    harness?.dispose();
    harness = replies({ data });
    const pending = embedTexts(["a", "b"], CONFIG, { deps: harness.deps });
    await harness.run();
    await expect(pending).rejects.toBeInstanceOf(EmbeddingRequestError);
  }
});

test("classifies a 200 that is not JSON instead of leaking a SyntaxError", async () => {
  harness = setupHarness();
  const stream = harness.scenario.createStream();
  harness.scenario.whenRequestMatches(() => true, stream);
  stream.enqueueAll([new TextEncoder().encode("<html>gateway</html>")], {
    startAt: 1,
  });
  const pending = embedTexts(["a"], CONFIG, { deps: harness.deps });
  await harness.run();
  await expect(pending).rejects.toMatchObject({
    reason: { category: "protocol_mismatch" },
  });
});

test("sends only configured fields to {baseURL}/embeddings", async () => {
  harness = setupHarness();
  const stream = harness.scenario.createStream();
  harness.scenario.whenRequestBodyMatches(
    (body, req) =>
      req.url === "https://embed.example/v1/embeddings" &&
      !req.headers.has("authorization") &&
      body === JSON.stringify({ model: CONFIG.model, input: ["a"] }),
    stream,
  );
  stream.enqueueAll(
    [new TextEncoder().encode('{"data":[{"index":0,"embedding":[1]}]}')],
    { startAt: 1 },
  );
  const pending = embedTexts(["a"], CONFIG, { deps: harness.deps });
  expect(await run(harness, pending)).toEqual([[1]]);
});

test("sends a bearer token only when apiKey is set", async () => {
  harness = setupHarness();
  const stream = harness.scenario.createStream();
  harness.scenario.whenRequestMatches(
    (req) => req.headers.get("authorization") === "Bearer sk-test",
    stream,
  );
  stream.enqueueAll(
    [new TextEncoder().encode('{"data":[{"index":0,"embedding":[1]}]}')],
    { startAt: 1 },
  );
  const pending = embedTexts(
    ["a"],
    { ...CONFIG, apiKey: "sk-test" },
    { deps: harness.deps },
  );
  expect(await run(harness, pending)).toEqual([[1]]);
});

test("returns [] for empty input without a request", async () => {
  harness = setupHarness();
  const pending = embedTexts([], CONFIG, { deps: harness.deps });
  expect(await run(harness, pending)).toEqual([]);
});

test("rejects a non-positive batchSize before any request", async () => {
  harness = setupHarness();
  for (const batchSize of [0, -1, 1.5]) {
    await expect(
      embedTexts(["a"], { ...CONFIG, batchSize }, { deps: harness.deps }),
    ).rejects.toThrow(/batchSize/);
  }
  await harness.run();
});
