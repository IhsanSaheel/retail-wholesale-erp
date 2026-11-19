import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://etihad-traders-saheel5.vercel.app/", changeFrequency: "weekly", priority: 1 },
    { url: "https://etihad-traders-saheel5.vercel.app/download", changeFrequency: "monthly", priority: 0.9 }
  ];
}
