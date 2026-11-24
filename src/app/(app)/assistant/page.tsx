import Link from "next/link";
import { requirePermission } from "@/server/auth";
import { aiConfig } from "@/server/core/ai";
import { can } from "@/server/core/permissions";
import { prisma } from "@/server/db";
import { buttonClass, Card, PageHeader } from "@/components/ui";
import { ChatLoader as Chat } from "./chat-loader";

export const metadata = { title: "AI assistant" };

export default async function AssistantPage() {
  const user = await requirePermission("assistant");
  const cfg = await aiConfig(prisma);
  const canExport = can(user, "reports", "export") || can(user, "invoices", "export");

  return (
    <>
      <PageHeader title="AI assistant"
        subtitle="Ask about clients, projects, POs, invoices and payments. Answers use live data you're allowed to see — and can be exported to Excel, Word or PDF." />
      {cfg.apiKey ? (
        <Chat userName={user.name.split(" ")[0]} canExport={canExport} />
      ) : (
        <Card>
          <p className="text-sm text-slate-600">The assistant isn&apos;t set up yet — it needs a Google (Gemini) API key.</p>
          {can(user, "settings", "administer")
            ? <Link href="/settings#ai" className={`${buttonClass("primary")} mt-4`}>Add the API key in Settings</Link>
            : <p className="mt-2 text-sm text-slate-500">Ask an administrator to add it under Settings → AI assistant.</p>}
        </Card>
      )}
    </>
  );
}
