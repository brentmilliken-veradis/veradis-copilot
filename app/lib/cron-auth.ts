// Cron route guard (fix brief v03 F-3) — FAIL CLOSED. Without CRON_SECRET the
// pollers refuse to run (500, zero work) instead of running unauthenticated
// with service-role writes; with it, the Vercel Cron bearer must match under a
// length-constant comparison.

import { timingSafeEqual } from "node:crypto";

/** Returns a denial Response, or null when the request is authorised. */
export function checkCronAuth(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "cron secret not configured" }, { status: 500 });
  }
  const presented = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
