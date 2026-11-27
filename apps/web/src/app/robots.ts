import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/*/book/", "/*/me", "/*/login", "/*/staff"] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
