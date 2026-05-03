import { Router } from "express";
import jwt from "jsonwebtoken";

const router = Router();

router.post("/auth/login", (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };

  const expectedUser = process.env.SIEVE_USERNAME;
  const expectedPass = process.env.SIEVE_PASSWORD;
  const secret = process.env.JWT_SECRET;

  if (!expectedUser || !expectedPass || !secret) {
    return res.status(503).json({ error: "Auth not configured" });
  }

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  if (username !== expectedUser || password !== expectedPass) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign({ sub: username }, secret, { expiresIn: "7d" });
  return res.json({ token, expiresIn: 604800 });
});

export default router;
