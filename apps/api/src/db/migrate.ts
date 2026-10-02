import { pool } from "./pool.js";

const sql = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OPERATOR', 'MANAGER')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_cents INT NOT NULL CHECK (price_cents >= 0),
  stock INT NOT NULL CHECK (stock >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_by_user_id UUID NOT NULL REFERENCES users(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  opening_float_cents INT NOT NULL DEFAULT 0,
  closing_float_cents INT
);

CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id UUID NOT NULL REFERENCES cash_sessions(id),
  operator_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'CANCELLED')),
  total_cents INT NOT NULL CHECK (total_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id),
  product_id UUID NOT NULL REFERENCES products(id),
  sku_snapshot TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  unit_price_cents INT NOT NULL,
  qty INT NOT NULL CHECK (qty >= 1),
  line_total_cents INT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id),
  method TEXT NOT NULL CHECK (method IN ('CASH', 'CARD', 'PIX')),
  amount_cents INT NOT NULL CHECK (amount_cents > 0)
);

CREATE TABLE IF NOT EXISTS fiscal_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL UNIQUE REFERENCES sales(id),
  access_key_fake TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function main() {
  await pool.query(sql);
  console.log("migrate ok");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
