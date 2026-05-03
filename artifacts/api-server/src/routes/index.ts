import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import brandsRouter from "./brands";
import documentsRouter from "./documents";
import brainRouter from "./brain";
import runsRouter from "./runs";
import dataRouter from "./data";
import storageRouter from "./storage";
import { requireApiKeyInProduction } from "../lib/auth";

const router: IRouter = Router();

// ── Public ────────────────────────────────────────────────────────────────────
// Health check and Sieve login must be public
router.use(healthRouter);
router.use(authRouter);

// ── Protected (API key required in production) ────────────────────────────────
router.use(requireApiKeyInProduction);

router.use(brandsRouter);
router.use(documentsRouter);
router.use(brainRouter);
router.use(runsRouter);
router.use(dataRouter);
router.use(storageRouter);

export default router;
