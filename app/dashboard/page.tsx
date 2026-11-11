import type { Metadata } from "next";
import { connection } from "next/server";
import { aiEnabled } from "@/lib/ai";
import { getProoflineData } from "@/lib/store";
import { Dashboard } from "./dashboard";

export const metadata: Metadata = {
  title: "Proofline command center",
};

export default async function DashboardPage() {
  // The evidence ledger changes as payments, deliveries and webhooks arrive: render per request.
  await connection();
  const data = getProoflineData();

  // Only a yes/no reaches the client; the provider, model and keys stay on the server (lib/ai.ts).
  return (
    <Dashboard
      data={data}
      licenseKey={process.env.AG_STUDIO}
      aiEnabled={aiEnabled()}
    />
  );
}
