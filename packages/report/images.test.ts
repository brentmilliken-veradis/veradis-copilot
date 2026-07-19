// buildReportImages — maps delivered photos to evidence slots, downscales to a
// self-contained JPEG data URI, and never throws on a bad image.

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { buildReportImages } from "./images";

// A real, decodable image so jimp can downscale it — built once via jimp itself.
async function tinyJpeg(w: number, h: number): Promise<Uint8Array> {
  const { Jimp } = await import("jimp");
  const img = new Jimp({ width: w, height: h, color: 0xa87d2eff });
  return new Uint8Array(await img.getBuffer("image/jpeg", { quality: 80 }));
}
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("buildReportImages", () => {
  it("returns a JPEG data URI per photo, slot mapped by SHA-256", async () => {
    const a = await tinyJpeg(1400, 900); // over the long-edge cap → downscaled
    const b = await tinyJpeg(200, 200);
    const evidence = [
      { slot: "reverse", sha256: sha(b) },
      { slot: "obverse", sha256: sha(a) },
    ];
    const imgs = await buildReportImages([{ filename: "1.jpg", bytes: a }, { filename: "2.jpg", bytes: b }], evidence);

    expect(imgs).toHaveLength(2);
    for (const i of imgs) expect(i.dataUri.startsWith("data:image/jpeg;base64,")).toBe(true);
    // obverse sorts before reverse (hero-first ordering)
    expect(imgs[0].slot).toBe("obverse");
    expect(imgs.map((i) => i.slot).sort()).toEqual(["obverse", "reverse"]);
  });

  it("falls back to capture-order slot when the hash doesn't match", async () => {
    const a = await tinyJpeg(300, 300);
    const imgs = await buildReportImages([{ filename: "x.jpg", bytes: a }], [{ slot: "edge", sha256: "deadbeef" }]);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].slot).toBe("edge"); // positional fallback
  });

  it("skips an undecodable image without throwing; empty input → []", async () => {
    expect(await buildReportImages([], [])).toEqual([]);
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    expect(await buildReportImages([{ filename: "bad.bin", bytes: junk }], [{ slot: "obverse", sha256: sha(junk) }])).toEqual([]);
  });
});
