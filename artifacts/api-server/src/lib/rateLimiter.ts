import rateLimit from "express-rate-limit";

const isProd = process.env["NODE_ENV"] === "production";

/**
 * General limiter — applied to all routes.
 * Generous enough for normal UI usage but blocks scrapers.
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 300 : 2000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  skip: () => !isProd,
});

/**
 * Brain limiter — applied to LLM-backed endpoints (/ask, /map, /strategy).
 * Each call hits OpenAI + Anthropic; protect against abuse.
 */
export const brainLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 30 : 500,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Brain query rate limit reached. Max 30 requests per 15 minutes." },
  skip: () => !isProd,
});

/**
 * Ingest limiter — heavy document processing.
 */
export const ingestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isProd ? 50 : 500,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Ingest rate limit reached. Max 50 requests per hour." },
  skip: () => !isProd,
});
