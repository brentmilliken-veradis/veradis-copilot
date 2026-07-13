// Public report page — the EMAIL C link target. Read-only; renders only once a
// curator has made the report definitive. Provisional and in-flight reports 404
// here (customers never see unconfirmed scores — E7 is the gate).

import { getStore } from "@/app/lib/store";
import { renderReport } from "@/packages/report/render";

export const dynamic = "force-dynamic";

export default async function PublicReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const { repo } = await getStore();
  const report = await repo.getReport(reportId);
  const version = report ? await repo.getLatestVersion(reportId) : null;

  if (!report || !version || report.status !== "definitive") {
    return (
      <main style={{ maxWidth: 880, margin: "0 auto", padding: 24 }}>
        <p>Report not found.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: 24 }}>
      <div dangerouslySetInnerHTML={{ __html: renderReport(version.snapshotJson) }} />
    </main>
  );
}
