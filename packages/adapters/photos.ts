// Photo fetch + normalisation for Tally uploads. iPhone submissions arrive as
// HEIC; the vision stage and the report viewer want JPEG. Conversion uses
// heic-convert (pure JS libheif — no native binary, Vercel-safe). The fetcher
// and converter are injectable so tests run without network or wasm.

import type { TallyPhotoRef } from "@/packages/intake/tally";
import type { PhotoInput } from "@/packages/intake/types";

export type Fetcher = (url: string) => Promise<Uint8Array>;
export type HeicConverter = (bytes: Uint8Array) => Promise<Uint8Array>;

export const httpFetcher: Fetcher = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`photo download failed ${res.status}: ${url}`);
  return new Uint8Array(await res.arrayBuffer());
};

export const heicToJpeg: HeicConverter = async (bytes) => {
  const { default: convert } = await import("heic-convert");
  const out = await convert({ buffer: Buffer.from(bytes), format: "JPEG", quality: 0.92 });
  return new Uint8Array(out);
};

function isHeic(photo: TallyPhotoRef, bytes: Uint8Array): boolean {
  if (/hei[cf]/i.test(photo.mimeType) || /\.hei[cf]$/i.test(photo.name)) return true;
  // ISO-BMFF ftyp brand sniff: bytes 4-12 read "ftypheic"/"ftypheif"/"ftypmif1".
  if (bytes.length > 12) {
    const brand = Buffer.from(bytes.subarray(4, 12)).toString("ascii");
    if (/^ftyp(hei[cf]|mif1|msf1)/.test(brand)) return true;
  }
  return false;
}

/** Download every Tally photo, converting HEIC to JPEG. Preserves order so the
 *  intake slot mapping stays aligned with the form's upload order. */
export async function fetchPhotos(
  photos: TallyPhotoRef[],
  fetcher: Fetcher = httpFetcher,
  converter: HeicConverter = heicToJpeg,
): Promise<PhotoInput[]> {
  const out: PhotoInput[] = [];
  for (const p of photos) {
    let bytes = await fetcher(p.url);
    let filename = p.name;
    if (isHeic(p, bytes)) {
      bytes = await converter(bytes);
      filename = filename.replace(/\.hei[cf]$/i, "") + ".jpg";
    }
    out.push({ filename, bytes });
  }
  return out;
}
