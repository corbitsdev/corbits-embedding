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
