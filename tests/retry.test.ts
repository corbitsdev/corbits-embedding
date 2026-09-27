import { afterEach, expect, test } from "bun:test";
import { setupHarness, type Harness } from "@intx/inference-testing";

import { EmbeddingRequestError, embedTexts } from "../src/index";

const CONFIG = { baseURL: "https://embed.example/v1", model: "m" };

let harness: Harness | undefined;
afterEach(() => {
  harness?.dispose();
  harness = undefined;
});

// Each reply matches exactly one request; an unplanned extra request fails
// `harness.run()` with UnmatchedFetchError.
function reply(
  h: Harness,
  body: string,
  status: number,
  headers: Record<string, string> = {},
): void {
  const stream = h.scenario.createStream();
  h.scenario.whenRequestMatches(() => true, stream, { status, headers });
  stream.enqueueAll([new TextEncoder().encode(body)], { startAt: 1 });
}

test("retries a 429 once, after the advertised Retry-After", async () => {
  harness = setupHarness({ enableInferenceTimers: true });
  reply(harness, "rate limited", 429, { "retry-after": "30" });
  reply(
    harness,
    JSON.stringify({ data: [{ index: 0, embedding: [0.5, 0.25] }] }),
    200,
  );

  const pending = embedTexts(["a"], CONFIG, { deps: harness.deps });
  await harness.run();

  expect(await pending).toEqual([[0.5, 0.25]]);
  expect(harness.clock.now()).toBeGreaterThanOrEqual(30_000);
});

test("rejects a 401 without retrying", async () => {
  harness = setupHarness({ enableInferenceTimers: true });
  reply(harness, "unauthorized", 401);

  const pending = embedTexts(["a"], CONFIG, { deps: harness.deps });
  await harness.run();

  const rejection = expect(pending).rejects;
  await rejection.toBeInstanceOf(EmbeddingRequestError);
  await rejection.toMatchObject({
    reason: { category: "credential_failure", statusCode: 401 },
  });
});

test("waits until an HTTP-date Retry-After", async () => {
  harness = setupHarness({ enableInferenceTimers: true });
  const at = new Date(Date.now() + 20_000).toUTCString();
  reply(harness, "rate limited", 429, { "retry-after": at });
  reply(harness, JSON.stringify({ data: [{ index: 0, embedding: [1] }] }), 200);

  const pending = embedTexts(["a"], CONFIG, { deps: harness.deps });
  await harness.run();

  expect(await pending).toEqual([[1]]);
  expect(harness.clock.now()).toBeGreaterThanOrEqual(19_000);
});

test("treats a past HTTP-date Retry-After as no wait", async () => {
  harness = setupHarness({ enableInferenceTimers: true });
  const at = new Date(Date.now() - 60_000).toUTCString();
  reply(harness, "rate limited", 429, { "retry-after": at });
  reply(harness, JSON.stringify({ data: [{ index: 0, embedding: [1] }] }), 200);

  const pending = embedTexts(["a"], CONFIG, { deps: harness.deps });
  await harness.run();

  expect(await pending).toEqual([[1]]);
  expect(harness.clock.now()).toBeLessThan(1_000);
});

test("honors a caller-supplied extractRetryAfterMs", async () => {
  harness = setupHarness({ enableInferenceTimers: true });
  reply(harness, "rate limited", 429);
  reply(harness, JSON.stringify({ data: [{ index: 0, embedding: [1] }] }), 200);

  const pending = embedTexts(["a"], CONFIG, {
    deps: harness.deps,
    extractRetryAfterMs: () => 45_000,
  });
  await harness.run();

  expect(await pending).toEqual([[1]]);
  expect(harness.clock.now()).toBeGreaterThanOrEqual(45_000);
});

test("applies timeoutMs even when the caller passes a signal", async () => {
  harness = setupHarness();
  const stream = harness.scenario.createStream();
  harness.scenario.whenRequestMatches(() => true, stream);

  const pending = embedTexts(
    ["a"],
    { ...CONFIG, timeoutMs: 50 },
    { deps: harness.deps, signal: new AbortController().signal },
  );
  await harness.run();

  await expect(pending).rejects.toBeInstanceOf(EmbeddingRequestError);
});
