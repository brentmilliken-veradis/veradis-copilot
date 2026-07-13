// Stub registry. Per BUILD-KICKOFF §3, a missing key means "stub the adapter
// behind a flag, list it, keep moving." Every stubbed adapter records itself here
// so the Phase A summary can list exactly which keys are still needed.

export interface StubFlag {
  adapter: string;
  reason: string;
  envKey: string;
}

const flags = new Map<string, StubFlag>();

export function markStubbed(adapter: string, envKey: string, reason: string): void {
  if (!flags.has(adapter)) {
    flags.set(adapter, { adapter, envKey, reason });
    // Visible in logs so a run makes its stubbing obvious.
    console.warn(`STUBBED: ${adapter} — set ${envKey} to go live (${reason})`);
  }
}

export function listStubbed(): StubFlag[] {
  return [...flags.values()];
}

/** Test/support helper — clear recorded flags. */
export function resetStubRegistry(): void {
  flags.clear();
}
