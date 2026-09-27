import { afterEach, expect, test } from "bun:test";
import { createDefaultScheduler } from "@intx/inference";
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

/** Hangs until aborted for the first `hangs` calls, then replies. */
function hangingFetch(hangs: number): {
  fetch: typeof fetch;
  calls: () => number;
} {
  let calls = 0;
  const hangThenReply = (async (_url: unknown, init?: RequestInit) => {
    calls++;
    if (calls > hangs) {
      return new Response(
        JSON.stringify({ data: [{ index: 0, embedding: [1] }] }),
      );
    }
    const signal = init?.signal ?? undefined;
    return await new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason));
    });
  }) as typeof fetch;
  return { fetch: hangThenReply, calls: () => calls };
}

test("retries an attempt that hits timeoutMs", async () => {
  const stub = hangingFetch(1);
  const vectors = await embedTexts(
    ["a"],
    { ...CONFIG, timeoutMs: 50 },
    { deps: { fetch: stub.fetch, scheduler: createDefaultScheduler() } },
  );

  expect(vectors).toEqual([[1]]);
  expect(stub.calls()).toBe(2);
});

test("applies timeoutMs even when the caller passes a signal", async () => {
  const stub = hangingFetch(Infinity);
  const pending = embedTexts(
    ["a"],
    { ...CONFIG, timeoutMs: 50 },
    {
      deps: { fetch: stub.fetch, scheduler: createDefaultScheduler() },
      signal: new AbortController().signal,
    },
  );

  await expect(pending).rejects.toMatchObject({
    reason: { category: "timeout" },
  });
  expect(stub.calls()).toBe(3);
});

test("reports a caller abort as aborted, without retrying", async () => {
  harness = setupHarness({ enableInferenceTimers: true });
  harness.scenario.whenRequestMatches(
    () => true,
    harness.scenario.createStream(),
  );
  const controller = new AbortController();

  const pending = embedTexts(["a"], CONFIG, {
    deps: harness.deps,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 20);
  await harness.run();

  await expect(pending).rejects.toMatchObject({
    reason: { category: "aborted" },
  });
});

test("caps a Retry-After at 60 seconds", async () => {
  harness = setupHarness({ enableInferenceTimers: true });
  reply(harness, "rate limited", 429, { "retry-after": "86400" });
  reply(harness, JSON.stringify({ data: [{ index: 0, embedding: [1] }] }), 200);

  const pending = embedTexts(["a"], CONFIG, { deps: harness.deps });
  await harness.run();

  expect(await pending).toEqual([[1]]);
  expect(harness.clock.now()).toBeGreaterThanOrEqual(60_000);
  expect(harness.clock.now()).toBeLessThan(61_000);
});
