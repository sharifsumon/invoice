import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/** Search engines may crawl the public pages; the app itself (behind sign-in) is off limits. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: ["/", "/pricing"],
      disallow: [
        "/api/", "/login", "/dashboard", "/assistant", "/clients", "/projects", "/pos", "/invoices", "/reports",
        "/settings", "/subscription", "/users", "/audit", "/account", "/notifications", "/search",
      ],
    }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
