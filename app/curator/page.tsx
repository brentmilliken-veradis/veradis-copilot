// Curator queue — lists reports awaiting confirmation. Seeded with the 2007-coin
// provisional so the flow is walkable in `npm run dev`.

import Link from "next/link";
import { getStore } from "@/app/lib/store";

export const dynamic = "force-dynamic";

export default async function CuratorQueue() {
  const { repo } = await getStore();
  const reports = await repo.listReports();

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 20 }}>Curator queue</h1>
      <ul>
        {reports.map((r) => (
          <li key={r.id}>
            <Link href={`/curator/${r.id}`}>
              {r.objectId} — {r.category} — <strong>{r.status}</strong> (v{r.currentVersion})
            </Link>
          </li>
        ))}
      </ul>
      {reports.length === 0 && <p>No reports in the queue.</p>}
    </main>
  );
}
