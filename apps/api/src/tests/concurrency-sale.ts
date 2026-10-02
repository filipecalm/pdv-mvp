import "dotenv/config";
import { pool } from "../db/pool.js";

const api = process.env.API_URL ?? "http://localhost:3001";

async function login(email: string) {
  const res = await fetch(`${api}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  if (!res.ok) throw new Error(`login failed ${email}: ${res.status}`);
  return (await res.json()) as { token: string };
}

async function ensureSession(token: string) {
  const current = await fetch(`${api}/v1/cash-sessions/current`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await current.json()) as { session: { id: string } | null };
  if (body.session) return;
  const opened = await fetch(`${api}/v1/cash-sessions/open`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ openingFloatCents: 0 }),
  });
  if (!opened.ok && opened.status !== 409) {
    throw new Error(`open session failed: ${opened.status}`);
  }
}

async function main() {
  await pool.query(
    `UPDATE products SET stock = 1, updated_at = now() WHERE sku = 'LAST-UNIT'`,
  );
  await pool.query(`DELETE FROM fiscal_receipts`);
  await pool.query(`DELETE FROM payments`);
  await pool.query(`DELETE FROM sale_items`);
  await pool.query(`DELETE FROM sales`);

  const product = await pool.query(`SELECT id FROM products WHERE sku = 'LAST-UNIT'`);
  const productId = product.rows[0].id as string;

  const a = await login("op@demo.local");
  const b = await login("mgr@demo.local");
  await ensureSession(a.token);
  await ensureSession(b.token);

  const payload = {
    items: [{ productId, qty: 1 }],
    payments: [{ method: "PIX", amountCents: 1990 }],
  };

  const [r1, r2] = await Promise.all([
    fetch(`${api}/v1/sales`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${a.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    }),
    fetch(`${api}/v1/sales`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${b.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    }),
  ]);

  const statuses = [r1.status, r2.status].sort().join(",");
  const stock = await pool.query(`SELECT stock FROM products WHERE sku = 'LAST-UNIT'`);
  const sales = await pool.query(
    `SELECT count(*)::int AS n FROM sales WHERE status = 'COMPLETED'`,
  );

  const ok =
    statuses === "201,409" &&
    stock.rows[0].stock === 0 &&
    sales.rows[0].n === 1;

  console.log({ statuses, stock: stock.rows[0].stock, completedSales: sales.rows[0].n });
  await pool.end();
  if (!ok) {
    console.error("concurrency test FAILED");
    process.exit(1);
  }
  console.log("concurrency test PASSED");
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
