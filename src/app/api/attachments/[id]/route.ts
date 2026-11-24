import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { ATTACHABLE } from "@/server/core/attachments";
import { can } from "@/server/core/permissions";
import { loadFile } from "@/server/core/storage";
import { prisma } from "@/server/db";

export async function GET(_req: Request, ctx: RouteContext<"/api/attachments/[id]">) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a) return new NextResponse("Not found", { status: 404 });
  const mod = ATTACHABLE[a.entityType];
  if (!mod || !can(user, mod, "view")) return new NextResponse("Forbidden", { status: 403 });
  const data = await loadFile(a.filePath);
  const inline = a.mimeType === "application/pdf" || a.mimeType.startsWith("image/");
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": a.mimeType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${a.fileName.replace(/[^\w.\- ()]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
