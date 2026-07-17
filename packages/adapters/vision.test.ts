// E-A — live Claude vision adapter. All Claude calls are mocked (global fetch);
// no real API traffic in tests. Covers: factory selection, image-block payload,
// strict-JSON parsing, category validation, stub fallback, media-type sniffing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Jimp } from "jimp";
import {
  ClaudeVisionAdapter,
  StubVisionAdapter,
  downscaleForVision,
  getVisionAdapter,
  parseVisionJson,
  selectImagesForPayload,
  sniffImageMediaType,
  VISION_MAX_LONG_EDGE,
  VISION_TOTAL_PAYLOAD_BUDGET,
  type VisionImage,
  type VisionRequest,
} from "./vision";
import { StubStorage } from "./storage";
import { resetStubRegistry } from "./stub-registry";
import { sha256Hex } from "@/packages/util/hash";

/** A real, decodable test image at a chosen size (jimp, pure-JS). */
async function makeImage(width: number, height: number): Promise<Uint8Array> {
  const img = new Jimp({ width, height, color: 0x3366ccff });
  return new Uint8Array(await img.getBuffer("image/jpeg", { quality: 90 }));
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function visionImage(slot: string, core: boolean, base64Len: number): VisionImage {
  return { slot, core, mediaType: "image/jpeg", base64: "a".repeat(base64Len) };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

function claudeReply(payload: unknown): Response {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload) }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function seededStorage(): Promise<{ storage: StubStorage; paths: string[] }> {
  const storage = new StubStorage();
  const a = await storage.put("r1/obverse/obv.jpg", JPEG);
  const b = await storage.put("r1/reverse/rev.png", PNG);
  return { storage, paths: [a.path, b.path] };
}

function request(paths: string[]): VisionRequest {
  return {
    objectId: "obj-1",
    category: "coins",
    declaredAttributes: { year: "2008", mint_mark: "RCM" },
    evidence: [
      { slot: "obverse", sha256: "aa", storagePath: paths[0] },
      { slot: "reverse", sha256: "bb", storagePath: paths[1] },
    ],
  };
}

describe("sniffImageMediaType", () => {
  it("detects jpeg / png / webp and defaults to jpeg", () => {
    expect(sniffImageMediaType(JPEG)).toBe("image/jpeg");
    expect(sniffImageMediaType(PNG)).toBe("image/png");
    expect(sniffImageMediaType(WEBP)).toBe("image/webp");
    expect(sniffImageMediaType(new Uint8Array([1, 2, 3, 4]))).toBe("image/jpeg");
  });
});

describe("parseVisionJson", () => {
  it("parses a strict JSON object", () => {
    const out = parseVisionJson('{"derivedAttributes":{"year":"2007"},"redFlags":[]}');
    expect(out).toEqual({ derivedAttributes: { year: "2007" }, derivedCategory: undefined, redFlags: [] });
  });

  it("accepts a fenced block and drops an unknown category", () => {
    const out = parseVisionJson('```json\n{"derivedAttributes":{},"derivedCategory":"paintings","redFlags":[]}\n```');
    expect(out?.derivedCategory).toBeUndefined();
  });

  it("keeps a known category and well-formed red flags only", () => {
    const out = parseVisionJson(
      JSON.stringify({
        derivedAttributes: { year: 2007, junk: null },
        derivedCategory: "medals",
        redFlags: [{ key: "renamed", evidenceSlot: "suspension_naming", note: "re-cut naming" }, { bad: true }],
      }),
    );
    expect(out?.derivedAttributes).toEqual({ year: "2007" });
    expect(out?.derivedCategory).toBe("medals");
    expect(out?.redFlags).toEqual([{ key: "renamed", evidenceSlot: "suspension_naming", note: "re-cut naming" }]);
  });

  it("returns null on non-JSON", () => {
    expect(parseVisionJson("I could not read the images.")).toBeNull();
  });
});

describe("ClaudeVisionAdapter", () => {
  beforeEach(() => resetStubRegistry());
  afterEach(() => vi.unstubAllGlobals());

  it("sends each image as a base64 image block with the sniffed media type", async () => {
    const { storage, paths } = await seededStorage();
    const fetchMock = vi.fn(async () => claudeReply({ derivedAttributes: { year: "2007" }, redFlags: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new ClaudeVisionAdapter("sk-test", storage, "claude-opus-4-8");
    const result = await adapter.analyze(request(paths));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as { body: string };
    const body = JSON.parse(init.body);
    expect(body.model).toBe("claude-opus-4-8");
    const images = body.messages[0].content.filter((b: { type: string }) => b.type === "image");
    expect(images).toHaveLength(2);
    expect(images[0].source.media_type).toBe("image/jpeg");
    expect(images[0].source.data).toBe(Buffer.from(JPEG).toString("base64"));
    expect(images[1].source.media_type).toBe("image/png");
    expect(result.derivedAttributes).toEqual({ year: "2007" });
    // C2PA stays a stubbed default — real validation is a documented TODO.
    expect(result.c2pa).toEqual({ obverse: "absent", reverse: "absent" });
  });

  it("falls back to the stub (echo declared) on unparseable output", async () => {
    const { storage, paths } = await seededStorage();
    vi.stubGlobal("fetch", vi.fn(async () => claudeReply("not json at all")));

    const adapter = new ClaudeVisionAdapter("sk-test", storage);
    const result = await adapter.analyze(request(paths));
    expect(result.derivedAttributes).toEqual({ year: "2008", mint_mark: "RCM" });
    expect(result.redFlags).toEqual([]);
  });

  it("falls back to the stub when no image bytes can be loaded", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new ClaudeVisionAdapter("sk-test", new StubStorage());
    const result = await adapter.analyze(request(["stub://missing-1", "stub://missing-2"]));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.derivedAttributes).toEqual({ year: "2008", mint_mark: "RCM" });
  });

  it("throws on an HTTP error (pipeline logs and surfaces the failure)", async () => {
    const { storage, paths } = await seededStorage();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("overloaded", { status: 529 })));
    const adapter = new ClaudeVisionAdapter("sk-test", storage);
    await expect(adapter.analyze(request(paths))).rejects.toThrow(/vision:claude 529/);
  });
});

describe("getVisionAdapter factory", () => {
  const OLD = { VISION_API_KEY: process.env.VISION_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
  afterEach(() => {
    if (OLD.VISION_API_KEY === undefined) delete process.env.VISION_API_KEY;
    else process.env.VISION_API_KEY = OLD.VISION_API_KEY;
    if (OLD.ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = OLD.ANTHROPIC_API_KEY;
  });

  it("returns the stub without a key", () => {
    delete process.env.VISION_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(getVisionAdapter({}, new StubStorage())).toBeInstanceOf(StubVisionAdapter);
  });

  it("returns the stub with a key but no storage (nothing to load images from)", () => {
    process.env.VISION_API_KEY = "sk-test";
    expect(getVisionAdapter()).toBeInstanceOf(StubVisionAdapter);
  });

  it("returns the live adapter with key + storage", () => {
    process.env.VISION_API_KEY = "sk-test";
    expect(getVisionAdapter({}, new StubStorage())).toBeInstanceOf(ClaudeVisionAdapter);
  });
});

// ---- Image-sizing fix (2026-07-17) ----

describe("downscaleForVision", () => {
  async function dims(bytes: Uint8Array): Promise<{ w: number; h: number }> {
    const img = await Jimp.read(Buffer.from(bytes));
    return { w: img.width, h: img.height };
  }

  it("downscales a > 1568 px image to ≤ 1568 px long edge, smaller, still JPEG", async () => {
    const big = await makeImage(2400, 1800); // > 1568 long edge, still 4:3
    const out = await downscaleForVision(big);

    const { w, h } = await dims(out);
    expect(Math.max(w, h)).toBeLessThanOrEqual(VISION_MAX_LONG_EDGE);
    expect(w).toBe(VISION_MAX_LONG_EDGE); // landscape → width is the long edge
    expect(Math.round((w / h) * 100)).toBe(Math.round((2400 / 1800) * 100)); // aspect preserved
    expect(out.byteLength).toBeLessThan(big.byteLength);
    expect(isJpeg(out)).toBe(true);
  }, 20_000);

  it("leaves a ≤ 1568 px image at its size and returns valid JPEG", async () => {
    const small = await makeImage(800, 600);
    const out = await downscaleForVision(small);
    const { w, h } = await dims(out);
    expect(w).toBe(800);
    expect(h).toBe(600);
    expect(isJpeg(out)).toBe(true);
  });

  it("returns the original bytes unchanged when the image cannot be decoded", async () => {
    const notAnImage = new Uint8Array([1, 2, 3, 4, 5]);
    const out = await downscaleForVision(notAnImage);
    expect(out).toEqual(notAnImage);
  });
});

describe("selectImagesForPayload", () => {
  it("prioritises core slots and drops the overflow once the budget is spent", () => {
    // 5 images at 8 MB base64 each; budget 20 MB → only 2 fit.
    const budget = 20 * 1024 * 1024;
    const each = 8 * 1024 * 1024;
    const images = [
      visionImage("extra_1", false, each),
      visionImage("obverse", true, each), // core — must come first
      visionImage("extra_2", false, each),
      visionImage("reverse", true, each), // core — must come first
      visionImage("extra_3", false, each),
    ];
    const { included, dropped } = selectImagesForPayload(images, budget, budget);

    expect(included.map((i) => i.slot)).toEqual(["obverse", "reverse"]); // core, in order
    expect(dropped.map((d) => d.slot).sort()).toEqual(["extra_1", "extra_2", "extra_3"]);
    expect(dropped.every((d) => d.reason === "budget")).toBe(true);
  });

  it("skips a single image over the per-image cap with reason 'oversized'", () => {
    const images = [
      visionImage("obverse", true, 100),
      visionImage("reverse", true, 10_000),
    ];
    const { included, dropped } = selectImagesForPayload(images, VISION_TOTAL_PAYLOAD_BUDGET, 5_000);
    expect(included.map((i) => i.slot)).toEqual(["obverse"]);
    expect(dropped).toEqual([{ slot: "reverse", reason: "oversized" }]);
  });

  it("includes everything when it all fits", () => {
    const images = [visionImage("a", true, 10), visionImage("b", false, 10)];
    const { included, dropped } = selectImagesForPayload(images);
    expect(included).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });
});

describe("vision downscale never touches the stored evidence bytes (regression)", () => {
  beforeEach(() => resetStubRegistry());
  afterEach(() => vi.unstubAllGlobals());

  it("the stored bytes + their SHA-256 are unchanged after analyze()", async () => {
    const storage = new StubStorage();
    const original = await makeImage(2400, 1800); // > 1568 px → the adapter will downscale a COPY
    const originalHash = sha256Hex(original);
    const { path } = await storage.put("r1/obverse/obv.jpg", original);

    vi.stubGlobal("fetch", vi.fn(async () => claudeReply({ derivedAttributes: {}, redFlags: [] })));
    const adapter = new ClaudeVisionAdapter("sk-test", storage);
    await adapter.analyze({
      objectId: "obj-1",
      category: "coins",
      declaredAttributes: {},
      evidence: [{ slot: "obverse", sha256: originalHash, storagePath: path }],
    });

    const stored = await storage.get(path);
    expect(stored).toEqual(original); // exact same bytes
    expect(sha256Hex(stored!)).toBe(originalHash); // and the same hash
  }, 20_000);
});
