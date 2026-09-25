import { afterEach, expect, test } from "bun:test";
import { setupHarness, type Harness } from "@intx/inference-testing";

import { embedTexts, type EmbedConfig } from "../src/index";

const CONFIG: EmbedConfig = {
  baseURL: "https://embed.example/v1",
  model: "text-embedding-3-small",
};

let harness: Harness | undefined;
afterEach(() => {
  harness?.dispose();
  harness = undefined;
});

async function run<T>(h: Harness, pending: Promise<T>): Promise<T> {
  await h.run();
  return await pending;
}

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
