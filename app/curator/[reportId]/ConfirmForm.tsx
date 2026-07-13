"use client";

import { useState } from "react";

export function ConfirmForm({ reportId, status }: { reportId: string; status: string }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(verb: string, downgradeTo?: string) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/v1/curator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, curator: "Curator", credentialClass: "curator", verb, downgradeTo }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(`→ ${data.report.status} (v${data.report.currentVersion})`);
        setTimeout(() => window.location.reload(), 600);
      } else {
        setMsg(`Error: ${data.error}`);
      }
    } finally {
      setBusy(false);
    }
  }

  if (status !== "provisional") {
    return (
      <p data-testid="curator-status">
        This report is <strong>{status}</strong>. {msg}
      </p>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "12px 0" }}>
      <button disabled={busy} onClick={() => act("confirmed")}>Confirm → definitive</button>
      <button disabled={busy} onClick={() => act("downgraded", "silver")}>Downgrade to Silver</button>
      <button disabled={busy} onClick={() => act("withheld")}>Withhold</button>
      <span data-testid="curator-msg">{msg}</span>
    </div>
  );
}
