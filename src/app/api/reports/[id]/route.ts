import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { getReport, runReport } from "@/server/core/reports";
import { toCsv, toPdf, toXlsx } from "@/server/core/report-export";
import { prisma } from "@/server/db";
import { parseReportFilters } from "@/server/report-params";

export async function GET(req: Request, ctx: RouteContext<"/api/reports/[id]">) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user, "reports", "export")) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  const def = getReport(id);
  if (!def) return new NextResponse("Not found", { status: 404 });

  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const f = parseReportFilters(sp);
  const result = await runReport(prisma, def, f);
  const format = sp.format === "xlsx" || sp.format === "pdf" ? sp.format : "csv";
  await prisma.auditLog.create({
    data: { actorId: user.id, action: "report.exported", entityType: "Report", entityId: id, after: { format, rows: result.rows.length, filters: sp } },
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${id}-${stamp}`;
  if (format === "xlsx") {
    return new NextResponse(new Uint8Array(await toXlsx(def.title, result)), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"` },
    });
  }
  if (format === "pdf") {
    const parts = Object.entries(sp).filter(([k, v]) => k !== "format" && v).map(([k, v]) => `${k}: ${v}`);
    const subtitle = `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by ${user.name}${parts.length ? ` · Filters — ${parts.join(", ")}` : ""}`;
    return new NextResponse(new Uint8Array(await toPdf(def.title, subtitle, result)), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"` },
    });
  }
  return new NextResponse(toCsv(result), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` },
  });
}
