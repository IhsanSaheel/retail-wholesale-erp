import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/download"], disallow: ["/api/"] }],
    sitemap: "https://etihad-traders-saheel5.vercel.app/sitemap.xml",
    host: "https://etihad-traders-saheel5.vercel.app"
  };
}
