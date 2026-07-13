import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 48 }}>
      <h1 style={{ fontSize: 24 }}>veradis PCS / Appraise Co-Pilot</h1>
      <p>The fulfilment engine behind verify.veradis.ai — a paid order + photos → a provisional report → a curator confirms → definitive.</p>
      <p>
        <Link href="/curator">→ Curator queue</Link>
      </p>
      <p style={{ color: "#888", fontSize: 13 }}>
        Phase A (Coins). Running on seeded fixtures with stubbed adapters until the live Supabase project and API keys are provisioned.
      </p>
    </main>
  );
}
