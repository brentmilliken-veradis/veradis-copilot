// Thin curator review page (E7). Renders the provisional report and the confirm
// controls. A curator confirms → the report becomes definitive.

import { getStore } from "@/app/lib/store";
import { renderReport } from "@/packages/report/render";
import { ConfirmForm } from "./ConfirmForm";

export const dynamic = "force-dynamic";

export default async function CuratorPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const { repo } = await getStore();
  const report = await repo.getReport(reportId);
  const version = report ? await repo.getLatestVersion(reportId) : null;

  if (!report || !version) {
    return (
      <main style={{ maxWidth: 880, margin: "0 auto", padding: 24 }}>
        <p>Report not found.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 20 }}>
        Curator review — <span data-testid="report-status">{report.status}</span> · v{report.currentVersion}
      </h1>
      <ConfirmForm reportId={reportId} status={report.status} />
      <div dangerouslySetInnerHTML={{ __html: renderReport(version.snapshotJson) }} />
    </main>
  );
}
