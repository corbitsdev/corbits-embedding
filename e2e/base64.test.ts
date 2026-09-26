import { afterAll, expect, test } from "bun:test";
import { type } from "arktype";

import { embedTexts } from "../src/index";

// Values that are not exact in float32, so the comparison exercises the
// tolerance rather than an exact round trip.
const VECTORS = [
  [0.1, -0.2, 0.3],
  [1.1, 2.2, -3.3],
];

// A `/v1/embeddings` stub that honours `encoding_format` the way OpenAI does.
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const body = type({ "encoding_format?": "string" }).assert(
      await req.json(),
    );
    return Response.json({
      data: VECTORS.map((vector, index) => ({
        index,
        embedding:
          body.encoding_format === "base64"
            ? Buffer.from(new Float32Array(vector).buffer).toString("base64")
            : vector,
      })),
    });
  },
});
afterAll(() => server.stop());

test("base64 replies decode to the float vectors within float32 tolerance", async () => {
  const config = { baseURL: `${server.url.href}v1`, model: "m" };
  const floats = await embedTexts(["a", "b"], config);
  const decoded = await embedTexts(["a", "b"], {
    ...config,
    encodingFormat: "base64",
  });

  expect(floats).toEqual(VECTORS);
  decoded.forEach((vector, i) => {
    vector.forEach((value, j) => {
      expect(value).toBeCloseTo(VECTORS[i]?.[j] ?? Number.NaN, 6);
    });
  });
});
