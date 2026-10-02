import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type SaleItemInput = { productId: string; qty: number };
type PaymentInput = { method: "CASH" | "CARD" | "PIX"; amountCents: number };

export async function createSale(params: {
  operatorId: string;
  items: SaleItemInput[];
  payments: PaymentInput[];
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const session = await client.query(
      `SELECT id FROM cash_sessions
       WHERE opened_by_user_id = $1 AND closed_at IS NULL
       LIMIT 1`,
      [params.operatorId],
    );
    if (!session.rows[0]) {
      throw new HttpError(409, "SESSION_REQUIRED", "Open a cash session first");
    }
    const cashSessionId = session.rows[0].id as string;

    if (!params.items?.length) {
      throw new HttpError(400, "EMPTY_CART", "Sale needs at least one item");
    }

    const productIds = [...new Set(params.items.map((i) => i.productId))].sort();
    const locked = await client.query(
      `SELECT id, sku, name, price_cents, stock, active
       FROM products
       WHERE id = ANY($1::uuid[])
       ORDER BY id
       FOR UPDATE`,
      [productIds],
    );
    const byId = new Map(locked.rows.map((r) => [r.id as string, r]));

    let totalCents = 0;
    const lines: Array<{
      productId: string;
      sku: string;
      name: string;
      unitPriceCents: number;
      qty: number;
      lineTotalCents: number;
    }> = [];

    for (const item of params.items) {
      if (!Number.isInteger(item.qty) || item.qty < 1) {
        throw new HttpError(400, "INVALID_QTY", "qty must be integer >= 1");
      }
      const product = byId.get(item.productId);
      if (!product || !product.active) {
        throw new HttpError(404, "PRODUCT_NOT_FOUND", "Product missing or inactive");
      }
      if (product.stock < item.qty) {
        throw new HttpError(
          409,
          "STOCK_INSUFFICIENT",
          `Insufficient stock for ${product.sku}`,
        );
      }
      const lineTotal = product.price_cents * item.qty;
      totalCents += lineTotal;
      lines.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        unitPriceCents: product.price_cents,
        qty: item.qty,
        lineTotalCents: lineTotal,
      });
    }

    const paySum = params.payments.reduce((s, p) => s + p.amountCents, 0);
    if (paySum !== totalCents) {
      throw new HttpError(400, "PAYMENT_MISMATCH", "Payments must equal sale total");
    }

    const sale = await client.query(
      `INSERT INTO sales (cash_session_id, operator_id, status, total_cents)
       VALUES ($1, $2, 'COMPLETED', $3)
       RETURNING *`,
      [cashSessionId, params.operatorId, totalCents],
    );
    const saleId = sale.rows[0].id as string;

    for (const line of lines) {
      await client.query(
        `INSERT INTO sale_items
          (sale_id, product_id, sku_snapshot, name_snapshot, unit_price_cents, qty, line_total_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          saleId,
          line.productId,
          line.sku,
          line.name,
          line.unitPriceCents,
          line.qty,
          line.lineTotalCents,
        ],
      );
      await client.query(
        `UPDATE products SET stock = stock - $1, updated_at = now() WHERE id = $2`,
        [line.qty, line.productId],
      );
    }

    for (const pay of params.payments) {
      await client.query(
        `INSERT INTO payments (sale_id, method, amount_cents) VALUES ($1,$2,$3)`,
        [saleId, pay.method, pay.amountCents],
      );
    }

    const accessKey = fakeAccessKey();
    await client.query(
      `INSERT INTO fiscal_receipts (sale_id, access_key_fake, payload_json)
       VALUES ($1,$2,$3)`,
      [
        saleId,
        accessKey,
        JSON.stringify({
          kind: "mock-nfce",
          saleId,
          totalCents,
          accessKey,
          issuedAt: new Date().toISOString(),
        }),
      ],
    );

    await client.query("COMMIT");
    return sale.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function fakeAccessKey() {
  return Array.from({ length: 44 }, () => Math.floor(Math.random() * 10)).join("");
}

export async function openSession(userId: string, openingFloatCents = 0) {
  const existing = await pool.query(
    `SELECT id FROM cash_sessions WHERE opened_by_user_id = $1 AND closed_at IS NULL`,
    [userId],
  );
  if (existing.rows[0]) {
    throw new HttpError(409, "SESSION_OPEN", "Cash session already open");
  }
  const res = await pool.query(
    `INSERT INTO cash_sessions (opened_by_user_id, opening_float_cents)
     VALUES ($1,$2) RETURNING *`,
    [userId, openingFloatCents],
  );
  return res.rows[0];
}

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
