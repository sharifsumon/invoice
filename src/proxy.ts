import { NextResponse, type NextRequest } from "next/server";

// Cheap gate only: pages and actions verify the session token and permissions themselves.
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.has("crm_session");
  const p = req.nextUrl.pathname;
  // Public marketing pages; /api/cron authenticates with its own bearer secret.
  const isPublic = p === "/" || p === "/pricing" || p === "/robots.txt" || p === "/sitemap.xml" || p.startsWith("/opengraph-image");
  if (!hasSession && !isPublic && !p.startsWith("/login") && !p.startsWith("/api/cron/") && p !== "/api/health") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
