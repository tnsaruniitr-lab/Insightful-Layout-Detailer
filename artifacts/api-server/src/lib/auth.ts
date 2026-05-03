import { type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "crypto";

/**
 * Middleware: require a valid BRAIN_API_KEY on the request.
 * Accepts the key via:
 *   - Authorization: Bearer <key>
 *   - X-Api-Key: <key>
 *
 * Returns 401 for missing/invalid keys.
 * Returns 503 if the server is not configured with a key.
 */
export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const configuredKey = process.env["BRAIN_API_KEY"];

  if (!configuredKey) {
    res.status(503).json({ error: "API authentication not configured on this server." });
    return;
  }

  const authHeader = req.headers["authorization"];
  const xApiKey = req.headers["x-api-key"];

  let provided: string | undefined;

  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    provided = authHeader.slice(7).trim();
  } else if (typeof xApiKey === "string") {
    provided = xApiKey.trim();
  }

  if (!provided) {
    res.status(401).json({
      error: "Missing API key. Provide via 'Authorization: Bearer <key>' or 'X-Api-Key: <key>'.",
    });
    return;
  }

  // Timing-safe comparison to prevent timing attacks
  try {
    const a = Buffer.from(provided.padEnd(configuredKey.length));
    const b = Buffer.from(configuredKey);
    const valid = a.length === b.length && timingSafeEqual(a, b);

    if (!valid) {
      res.status(401).json({ error: "Invalid API key." });
      return;
    }
  } catch {
    res.status(401).json({ error: "Invalid API key." });
    return;
  }

  next();
}

/**
 * Middleware: skip API key auth in development (for Sieve UI usage).
 * In production, falls through to requireApiKey.
 */
export function requireApiKeyInProduction(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (process.env["NODE_ENV"] !== "production") {
    return next();
  }
  return requireApiKey(req, res, next);
}
