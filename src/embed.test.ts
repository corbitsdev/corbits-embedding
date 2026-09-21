import { type } from "arktype";
import { describe, expect, it } from "bun:test";
import type { Dependencies } from "@intx/inference";

import {
  embedTexts,
  probeEmbedDims,
  EmbedConfigSchema,
  type EmbedConfig,
} from "./embed";
import { extractRetryAfterMs, ModelRequestError } from "./request";

const CONFIG: EmbedConfig = {
  baseURL: "https://embed.example/v1",
  model: "text-embedding-3-small",
};

type Call = { url: string; init: RequestInit };

/**
 * `Dependencies` carrying only what `runJSONRequest` reads, with a virtual
 * clock so retry backoff costs no wall time and the tests stay deterministic.
 */
function deps(responses: Array<Response | (() => Promise<Response>)>): {
  deps: Dependencies;
  calls: Call[];
} {
  const calls: Call[] = [];
  let i = 0;
  let virtualNow = 0;

  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses[Math.min(i++, responses.length - 1)];
    if (next === undefined) throw new Error("no response queued");
    return typeof next === "function" ? await next() : next;
  }) as unknown as Dependencies["fetch"];

  const scheduler = {
    now: () => virtualNow,
    setTimeout: (callback: () => void, delayMs: number) => {
      virtualNow += delayMs;
      queueMicrotask(callback);
      return () => {};
    },
  };

  return {
    deps: { fetch: fetchImpl, scheduler } as unknown as Dependencies,
    calls,
  };
}

/** A well-formed reply: one entry per input, each echoing its `index`. */
function embedding(dims: number, count = 1): Response {
  return Response.json({
    data: Array.from({ length: count }, (_unused, index) => ({
      index,
      // First component encodes the index so ordering is checkable.
      embedding: [index, ...new Array(dims - 1).fill(0.1)],
    })),
  });
}

describe("embedTexts", () => {
  it("returns no vectors and issues no request for empty input", async () => {
    const { deps: d, calls } = deps([]);
    expect(await embedTexts([], CONFIG, { deps: d })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("posts to /embeddings under the configured base url", async () => {
    const { deps: d, calls } = deps([embedding(3)]);
    await embedTexts(["hello"], CONFIG, { deps: d });
    expect(calls[0]?.url).toBe("https://embed.example/v1/embeddings");
  });

  it("omits dimensions and encoding_format unless configured", async () => {
    // Models without Matryoshka reject `dimensions` outright, so an unset knob
    // must not appear in the body at all.
    const { deps: d, calls } = deps([embedding(3)]);
    await embedTexts(["hello"], CONFIG, { deps: d });
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty("dimensions");
    expect(body).not.toHaveProperty("encoding_format");
  });

  it("sends dimensions and encoding_format when configured", async () => {
    const { deps: d, calls } = deps([embedding(256)]);
    await embedTexts(
      ["hello"],
      { ...CONFIG, dimensions: 256, encodingFormat: "base64" },
      { deps: d },
    );
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<
      string,
      unknown
    >;
    expect(body.dimensions).toBe(256);
    expect(body.encoding_format).toBe("base64");
  });

  it("sends an authorization header only when an apiKey is set", async () => {
    const { deps: d, calls } = deps([embedding(3), embedding(3)]);
    await embedTexts(["a"], CONFIG, { deps: d });
    expect(
      (calls[0]?.init.headers as Record<string, string>).authorization,
    ).toBeUndefined();

    await embedTexts(["a"], { ...CONFIG, apiKey: "sk-test" }, { deps: d });
    expect(
      (calls[1]?.init.headers as Record<string, string>).authorization,
    ).toBe("Bearer sk-test");
  });

  it("splits input into batches and preserves order across them", async () => {
    const { deps: d, calls } = deps([embedding(2, 2), embedding(2, 1)]);
    const vectors = await embedTexts(
      ["a", "b", "c"],
      { ...CONFIG, batchSize: 2 },
      { deps: d },
    );
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[0]?.init.body)).input).toEqual(["a", "b"]);
    expect(JSON.parse(String(calls[1]?.init.body)).input).toEqual(["c"]);
    // Content, not just count: batch 2 restarts at index 0, so a parser that
    // concatenated by reply position would still produce three vectors.
    expect(vectors.map((v) => v[0])).toEqual([0, 1, 0]);
  });

  it("rejects a batchSize that is not an integer >= 1 instead of looping forever", async () => {
    // `batches` advances by `i += size`, so a size of 0 never advances and
    // grows the batch list until OOM. Fractional sizes would also stall or
    // slice wrongly. Schema and runtime both require integer >= 1.
    for (const batchSize of [0, -1, 0.5, Number.NaN, 1.5]) {
      const { deps: d, calls } = deps([embedding(3)]);
      await expect(
        embedTexts(["a"], { ...CONFIG, batchSize }, { deps: d }),
      ).rejects.toBeInstanceOf(RangeError);
      expect(calls).toHaveLength(0);
    }
  });

  it("rejects a malformed response rather than returning junk vectors", async () => {
    const { deps: d } = deps([
      Response.json({ data: [{ index: 0, embedding: true }] }),
    ]);
    await expect(embedTexts(["a"], CONFIG, { deps: d })).rejects.toThrow(
      /malformed embeddings response/,
    );
  });
});

describe("EmbedConfigSchema", () => {
  const base = { baseURL: "https://embed.example/v1", model: "m" };

  it("accepts an integer batchSize >= 1 and an omitted batchSize", () => {
    expect(EmbedConfigSchema({ ...base, batchSize: 1 })).toEqual({
      ...base,
      batchSize: 1,
    });
    expect(EmbedConfigSchema(base)).toEqual(base);
  });

  it("rejects a fractional, non-integer, or sub-1 batchSize", () => {
    for (const batchSize of [0, -1, 0.5, Number.NaN, 1.5]) {
      expect(EmbedConfigSchema({ ...base, batchSize })).toBeInstanceOf(
        type.errors,
      );
    }
  });
});

describe("retry behaviour inherited from the inference policy", () => {
  it("retries a 429 and succeeds on the follow-up", async () => {
    // The hand-rolled client this replaced had no retry at all: a single 429
    // failed an entire capture.
    const { deps: d, calls } = deps([
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "0" },
      }),
      embedding(3),
    ]);
    const vectors = await embedTexts(["a"], CONFIG, { deps: d });
    expect(calls).toHaveLength(2);
    expect(vectors[0]).toHaveLength(3);
  });

  it("aborts immediately on 401 instead of hammering a bad key", async () => {
    const { deps: d, calls } = deps([
      new Response("unauthorized", { status: 401 }),
    ]);
    await expect(embedTexts(["a"], CONFIG, { deps: d })).rejects.toBeInstanceOf(
      ModelRequestError,
    );
    expect(calls).toHaveLength(1);
  });
});

describe("probeEmbedDims", () => {
  it("reports the dimensionality the provider actually returned", async () => {
    // Never inferred from the model name: it varies by provider and is changed
    // by `dimensions`.
    const { deps: d } = deps([embedding(384)]);
    expect(await probeEmbedDims(CONFIG, { deps: d })).toBe(384);
  });
});

describe("retry-after handling", () => {
  it("lets a caller override how Retry-After is read", async () => {
    // Parity with ProviderAdapter.extractRetryAfterMs: a provider that signals
    // pacing its own way overrides without the transport knowing.
    const seen: Array<string | null> = [];
    const { deps: d } = deps([
      new Response("slow down", {
        status: 429,
        headers: { "x-ratelimit-reset": "7" },
      }),
      Response.json({ data: [{ index: 0, embedding: [0.1, 0.2] }] }),
    ]);

    await embedTexts(["hello"], CONFIG, {
      deps: d,
      extractRetryAfterMs: (headers) => {
        seen.push(headers.get("x-ratelimit-reset"));
        return 0;
      },
    });
    expect(seen).toEqual(["7"]);
  });

  it("reads the seconds form and tolerates an absent header", () => {
    expect(extractRetryAfterMs(new Headers({ "retry-after": "2" }))).toBe(
      2_000,
    );
    expect(extractRetryAfterMs(new Headers())).toBeUndefined();
  });

  it("never returns a negative delay for a date already past", () => {
    expect(
      extractRetryAfterMs(
        new Headers({ "retry-after": "Wed, 21 Oct 2015 07:28:00 GMT" }),
      ),
    ).toBeGreaterThanOrEqual(0);
  });
});

describe("reply integrity", () => {
  it("places vectors by the echoed index, not reply position", async () => {
    // OpenAI does not promise reply order. Callers pair vectors with their own
    // texts positionally, so a reordered reply must not silently mispair them.
    const { deps: d } = deps([
      Response.json({
        data: [
          { index: 1, embedding: [9, 9] },
          { index: 0, embedding: [1, 1] },
        ],
      }),
    ]);
    const vectors = await embedTexts(["a", "b"], CONFIG, { deps: d });
    expect(vectors).toEqual([
      [1, 1],
      [9, 9],
    ]);
  });

  it("rejects a short reply rather than shifting every later batch", async () => {
    const { deps: d } = deps([
      Response.json({ data: [{ index: 0, embedding: [0.1] }] }),
    ]);
    await expect(embedTexts(["a", "b"], CONFIG, { deps: d })).rejects.toThrow(
      /expected 2 embeddings, got 1/,
    );
  });

  it("rejects a duplicated index", async () => {
    const { deps: d } = deps([
      Response.json({
        data: [
          { index: 0, embedding: [0.1] },
          { index: 0, embedding: [0.2] },
        ],
      }),
    ]);
    await expect(embedTexts(["a", "b"], CONFIG, { deps: d })).rejects.toThrow(
      /bad embedding index 0/,
    );
  });

  it("decodes the base64 encoding it advertises", async () => {
    // The option is documented and reaches the wire, so the reply form it
    // produces has to round-trip.
    const packed = Buffer.from(new Float32Array([1.5, -2.5]).buffer).toString(
      "base64",
    );
    const { deps: d } = deps([
      Response.json({ data: [{ index: 0, embedding: packed }] }),
    ]);
    const vectors = await embedTexts(
      ["a"],
      { ...CONFIG, encodingFormat: "base64" },
      { deps: d },
    );
    expect(vectors).toEqual([[1.5, -2.5]]);
  });
});

describe("transport failure modes", () => {
  it("classifies a 200 that is not JSON instead of leaking a SyntaxError", async () => {
    // A captive portal or proxy interstitial in front of a local model server.
    const { deps: d } = deps([
      new Response("<html>gateway</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ]);
    await expect(embedTexts(["a"], CONFIG, { deps: d })).rejects.toBeInstanceOf(
      ModelRequestError,
    );
  });

  it("still enforces timeoutMs when the caller also passes a signal", async () => {
    // The two must compose: honouring only the caller's signal would let a
    // request hang forever despite a configured per-attempt ceiling.
    const controller = new AbortController();
    const calls: Call[] = [];
    const d = {
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        // Never settles on its own — only the signal can end this.
        return await new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      }) as unknown as Dependencies["fetch"],
      scheduler: { now: () => 0, setTimeout: () => () => {} },
    } as unknown as Dependencies;

    await expect(
      embedTexts(
        ["a"],
        { ...CONFIG, timeoutMs: 5 },
        { deps: d, signal: controller.signal },
      ),
    ).rejects.toBeInstanceOf(ModelRequestError);
    expect(calls).toHaveLength(1);
  });
});
