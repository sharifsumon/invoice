import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { loadFile } from "@/server/core/storage";
import { prisma } from "@/server/db";

/** Logo is stored privately; served only to signed-in users. */
export async function GET() {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const c = await prisma.companySettings.findUnique({ where: { id: 1 } });
  if (!c?.logoPath || !c.logoMime) return new NextResponse("Not found", { status: 404 });
  const data = await loadFile(c.logoPath);
  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": c.logoMime, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}
