import "dotenv/config";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import { pool } from "./db/pool.js";
import { createSale, HttpError, openSession } from "./sales/create-sale.js";

const app = express();
const port = Number(process.env.API_PORT ?? 3001);
const secret = process.env.JWT_SECRET ?? "dev-secret";
const allowedOrigins = (
  process.env.WEB_ORIGIN ??
  "http://localhost:5173,http://localhost:5174"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error(`CORS blocked for origin ${origin}`));
    },
    credentials: true,
  }),
);
app.use(express.json());

type AuthUser = { id: string; email: string; role: "OPERATOR" | "MANAGER" };

function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ code: "UNAUTHORIZED", message: "Missing token" });
  }
  try {
    const payload = jwt.verify(header.slice(7), secret) as AuthUser;
    (req as express.Request & { user: AuthUser }).user = payload;
    next();
  } catch {
    return res.status(401).json({ code: "UNAUTHORIZED", message: "Invalid token" });
  }
}

function user(req: express.Request) {
  return (req as express.Request & { user: AuthUser }).user;
}

app.get("/v1/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/v1/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  const found = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
  const row = found.rows[0];
  if (!row || !(await bcrypt.compare(password ?? "", row.password_hash))) {
    return res.status(401).json({ code: "INVALID_CREDENTIALS", message: "Bad login" });
  }
  const token = jwt.sign(
    { id: row.id, email: row.email, role: row.role },
    secret,
    { expiresIn: "12h" },
  );
  res.json({
    token,
    user: { id: row.id, email: row.email, role: row.role },
  });
});

app.get("/v1/me", auth, (req, res) => {
  res.json({ user: user(req) });
});

app.get("/v1/products", auth, async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const result = q
    ? await pool.query(
        `SELECT id, sku, name, price_cents AS "priceCents", stock, active
         FROM products WHERE active AND (sku ILIKE $1 OR name ILIKE $1)
         ORDER BY sku`,
        [`%${q}%`],
      )
    : await pool.query(
        `SELECT id, sku, name, price_cents AS "priceCents", stock, active
         FROM products WHERE active ORDER BY sku`,
      );
  res.json({ items: result.rows });
});

app.post("/v1/cash-sessions/open", auth, async (req, res) => {
  try {
    const session = await openSession(user(req).id, Number(req.body?.openingFloatCents ?? 0));
    res.status(201).json(session);
  } catch (err) {
    return sendError(res, err);
  }
});

app.get("/v1/cash-sessions/current", auth, async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM cash_sessions WHERE opened_by_user_id = $1 AND closed_at IS NULL LIMIT 1`,
    [user(req).id],
  );
  res.json({ session: result.rows[0] ?? null });
});

app.post("/v1/sales", auth, async (req, res) => {
  try {
    const sale = await createSale({
      operatorId: user(req).id,
      items: req.body?.items ?? [],
      payments: req.body?.payments ?? [],
    });
    res.status(201).json(sale);
  } catch (err) {
    return sendError(res, err);
  }
});

app.get("/v1/sales", auth, async (req, res) => {
  const u = user(req);
  const result =
    u.role === "MANAGER"
      ? await pool.query(`SELECT * FROM sales ORDER BY created_at DESC LIMIT 50`)
      : await pool.query(
          `SELECT * FROM sales WHERE operator_id = $1 ORDER BY created_at DESC LIMIT 50`,
          [u.id],
        );
  res.json({ items: result.rows });
});

function sendError(res: express.Response, err: unknown) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ code: err.code, message: err.message });
  }
  console.error(err);
  return res.status(500).json({ code: "INTERNAL", message: "Unexpected error" });
}

app.listen(port, () => {
  console.log(`pdv api on :${port}`);
});
