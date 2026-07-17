// Route guards (fix briefs v03 F-3 + v04 R-1) — FAIL CLOSED. A route with an
// unset secret refuses to run (500, zero work) instead of running open with
// service-role writes; with it, the bearer must match under a length-constant
// comparison.

import { timingSafeEqual } from "node:crypto";

function checkBearer(request: Request, secret: string | undefined, unconfigured: string): Response | null {
  if (!secret) {
    return Response.json({ error: unconfigured }, { status: 500 });
  }
  const presented = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

/** Cron pollers (F-3). Returns a denial Response, or null when authorised. */
export function checkCronAuth(request: Request): Response | null {
  return checkBearer(request, process.env.CRON_SECRET, "cron secret not configured");
}

/** Curator route (R-1). The caller is the account-template admin backend
 *  holding CURATOR_AUTH_SECRET (server-to-server shared secret; Supabase admin
 *  JWT is the hardening target). Returns a denial Response, or null. */
export function checkCuratorAuth(request: Request): Response | null {
  return checkBearer(request, process.env.CURATOR_AUTH_SECRET, "curator auth secret not configured");
}
