/**
 * Source Authority Classifier
 * Step 1: Domain lookup — instant, no LLM needed
 * Step 2: LLM fallback — GPT-4o Mini, runs only when domain is unknown
 */
import { createFastModel } from "./llm";
import { logger } from "./logger";

export type AuthorityTier = "tier1" | "tier2" | "tier3";

export interface ClassificationResult {
  sourceOrg: string;
  tier: AuthorityTier;
  confidence: number;
}

const DOMAIN_MAP: Record<string, { org: string; tier: AuthorityTier }> = {
  // Google — Tier 1
  "developers.google.com":       { org: "Google", tier: "tier1" },
  "search.google.com":           { org: "Google", tier: "tier1" },
  "webmasters.googleblog.com":   { org: "Google", tier: "tier1" },
  "support.google.com":          { org: "Google", tier: "tier1" },
  "blog.google":                 { org: "Google", tier: "tier1" },
  "google.com":                  { org: "Google", tier: "tier1" },
  // Microsoft / Bing — Tier 1
  "bing.com":                    { org: "Microsoft Bing", tier: "tier1" },
  "blogs.bing.com":              { org: "Microsoft Bing", tier: "tier1" },
  "microsoft.com":               { org: "Microsoft", tier: "tier1" },
  "docs.microsoft.com":          { org: "Microsoft", tier: "tier1" },
  "learn.microsoft.com":         { org: "Microsoft", tier: "tier1" },
  // Startup ecosystems — Tier 1
  "ycombinator.com":             { org: "Y Combinator", tier: "tier1" },
  "paulgraham.com":              { org: "Paul Graham", tier: "tier1" },
  // Standards bodies — Tier 1
  "w3.org":                      { org: "W3C", tier: "tier1" },
  "schema.org":                  { org: "Schema.org", tier: "tier1" },
  "ietf.org":                    { org: "IETF", tier: "tier1" },
  "ogp.me":                      { org: "Open Graph Protocol", tier: "tier1" },
  // Established SEO/marketing tools — Tier 2
  "moz.com":                     { org: "Moz", tier: "tier2" },
  "semrush.com":                 { org: "SEMrush", tier: "tier2" },
  "ahrefs.com":                  { org: "Ahrefs", tier: "tier2" },
  "searchengineland.com":        { org: "Search Engine Land", tier: "tier2" },
  "searchenginejournal.com":     { org: "Search Engine Journal", tier: "tier2" },
  "backlinko.com":               { org: "Backlinko", tier: "tier2" },
  "neilpatel.com":               { org: "Neil Patel", tier: "tier2" },
  "hubspot.com":                 { org: "HubSpot", tier: "tier2" },
  "blog.hubspot.com":            { org: "HubSpot", tier: "tier2" },
  "contentmarketinginstitute.com": { org: "Content Marketing Institute", tier: "tier2" },
  "brightedge.com":              { org: "BrightEdge", tier: "tier2" },
  "conductor.com":               { org: "Conductor", tier: "tier2" },
  "wordstream.com":              { org: "WordStream", tier: "tier2" },
  "yoast.com":                   { org: "Yoast", tier: "tier2" },
  "surfer.seo":                  { org: "Surfer SEO", tier: "tier2" },
  "clearscope.io":               { org: "Clearscope", tier: "tier2" },
  "marketingmemo.com":           { org: "Marketing Memo", tier: "tier2" },
  "thedigitalbloom.com":         { org: "The Digital Bloom", tier: "tier2" },
  "cxl.com":                     { org: "CXL", tier: "tier2" },
  // Marketing agencies / lower-authority blogs — Tier 3
  "amsive.com":                  { org: "Amsive", tier: "tier3" },
  "naganamedia.com":             { org: "Nagan Media", tier: "tier3" },
};

function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function lookupByDomain(sourceUrl?: string): ClassificationResult | null {
  if (!sourceUrl) return null;
  const domain = extractDomain(sourceUrl);
  if (!domain) return null;

  // Exact match
  if (DOMAIN_MAP[domain]) {
    return { ...DOMAIN_MAP[domain], confidence: 0.97 };
  }

  // Suffix match (e.g. subdomain.moz.com → moz.com)
  for (const [pattern, meta] of Object.entries(DOMAIN_MAP)) {
    if (domain.endsWith(`.${pattern}`) || domain === pattern) {
      return { ...meta, confidence: 0.95 };
    }
  }

  return null;
}

const LLM_SYSTEM = `You are an authority classifier for SEO/GEO/AEO knowledge documents.
Given a document title and optionally a source URL, return a JSON object with:
- sourceOrg: The organization or publication name (e.g. "Google", "Moz", "Personal Blog")
- tier: One of "tier1", "tier2", or "tier3"
  - tier1 = Primary sources: search engines (Google, Bing), official standards bodies (W3C, schema.org, IETF), official API/developer docs, peer-reviewed academic papers, government sites
  - tier2 = Industry authorities: established SEO/marketing tools (Moz, SEMrush, Ahrefs, Yoast), recognized trade publications (Search Engine Land, SEJ), well-known practitioners with deep domain expertise
  - tier3 = General content: agency blogs, opinion pieces, personal sites, social media posts, aggregators, unknown sources
- confidence: A number 0.0–1.0 representing your certainty

Return ONLY valid JSON, no explanation.`;

export async function classifySourceAuthority(
  title: string,
  sourceUrl?: string,
): Promise<ClassificationResult> {
  // Step 1: domain lookup (free, instant)
  const domainResult = lookupByDomain(sourceUrl);
  if (domainResult) {
    logger.debug({ title, sourceUrl, result: domainResult }, "Source classified via domain map");
    return domainResult;
  }

  // Step 2: LLM fallback
  try {
    const model = createFastModel();
    const prompt = [
      `Document title: "${title}"`,
      sourceUrl ? `Source URL: ${sourceUrl}` : "",
    ].filter(Boolean).join("\n");

    const response = await model.invoke([
      { role: "system", content: LLM_SYSTEM },
      { role: "user", content: prompt },
    ]);

    const raw = typeof response.content === "string"
      ? response.content
      : (response.content as Array<{ text?: string }>)[0]?.text ?? "";

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in LLM response");

    const parsed = JSON.parse(jsonMatch[0]) as {
      sourceOrg?: string;
      tier?: string;
      confidence?: number;
    };

    const tier = (["tier1", "tier2", "tier3"].includes(parsed.tier ?? ""))
      ? (parsed.tier as AuthorityTier)
      : "tier3";

    const result: ClassificationResult = {
      sourceOrg: parsed.sourceOrg ?? "Unknown",
      tier,
      confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.6,
    };

    logger.debug({ title, sourceUrl, result }, "Source classified via LLM");
    return result;
  } catch (err) {
    logger.warn({ err, title, sourceUrl }, "Source classification failed, defaulting to tier3");
    return { sourceOrg: "Unknown", tier: "tier3", confidence: 0 };
  }
}

export function tierToTrustLevel(tier: AuthorityTier): "high" | "medium" | "low" {
  if (tier === "tier1") return "high";
  if (tier === "tier2") return "medium";
  return "low";
}
