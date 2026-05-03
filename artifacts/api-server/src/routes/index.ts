import { Router, type IRouter } from "express";
import healthRouter from "./health";
import brandsRouter from "./brands";
import documentsRouter from "./documents";
import brainRouter from "./brain";
import runsRouter from "./runs";
import dataRouter from "./data";
import storageRouter from "./storage";
import { requireApiKeyInProduction } from "../lib/auth";

const router: IRouter = Router();

// ── Public ────────────────────────────────────────────────────────────────────
// Health check must be public for deployment health probes
router.use(healthRouter);

// ── Protected (API key required in production) ────────────────────────────────
router.use(requireApiKeyInProduction);

router.use(brandsRouter);
router.use(documentsRouter);
router.use(brainRouter);
router.use(runsRouter);
router.use(dataRouter);
router.use(storageRouter);

export default router;
