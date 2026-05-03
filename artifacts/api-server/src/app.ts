import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { generalLimiter } from "./lib/rateLimiter";

const isProd = process.env["NODE_ENV"] === "production";

// Allowed CORS origins: Sieve frontend + any extra origins from env
function buildCorsOrigins(): string[] | boolean {
  if (!isProd) return true; // allow all in dev
  const extra = (process.env["ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const defaults = [
    // replit.app production domains — wildcard matched below
  ];
  return [...defaults, ...extra];
}

const corsOptions: cors.CorsOptions = {
  origin: isProd
    ? (origin, callback) => {
        const allowed = buildCorsOrigins();
        if (allowed === true || !origin) return callback(null, true);
        const list = allowed as string[];
        const ok =
          list.some((o) => o === origin) ||
          // allow any *.replit.app subdomain
          /^https:\/\/[a-z0-9-]+\.replit\.app$/.test(origin);
        if (ok) return callback(null, true);
        return callback(new Error(`CORS: origin '${origin}' not allowed`));
      }
    : (_origin, callback) => callback(null, true),
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Api-Key", "x-audit-key"],
  exposedHeaders: ["X-Total-Count"],
  credentials: true,
  maxAge: 86400,
};

const app: Express = express();

// ── Trust proxy (Replit runs behind a reverse proxy) ─────────────────────────
app.set("trust proxy", 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false, // API — no HTML served
  }),
);

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors(corsOptions));
app.options("/{*path}", cors(corsOptions)); // pre-flight for all routes

// ── Request logging ───────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── Body parsing (with size limits) ──────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── Global rate limiter ───────────────────────────────────────────────────────
app.use(generalLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: isProd ? "Internal server error" : err.message });
});

export default app;
