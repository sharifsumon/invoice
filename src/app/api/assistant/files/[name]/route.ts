import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { EXPORT_MIME, type ExportFormat } from "@/server/core/assistant-export";
import { can } from "@/server/core/permissions";
import { loadFile } from "@/server/core/storage";

/** Download a file the assistant generated — only for the user it was generated for. */
export async function GET(_req: Request, ctx: RouteContext<"/api/assistant/files/[name]">) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user, "assistant", "view")) return new NextResponse("Forbidden", { status: 403 });
  const { name } = await ctx.params;
  const m = /^[a-z0-9-]{1,80}\.(xlsx|docx|pdf)$/.exec(name);
  if (!m) return new NextResponse("Not found", { status: 404 });
  let data: Buffer;
  try {
    data = await loadFile(`assistant/${user.id}/${name}`);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": EXPORT_MIME[m[1] as ExportFormat],
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
