import bcrypt from "bcryptjs";
import { pool } from "./pool.js";

async function main() {
  const hash = await bcrypt.hash("demo1234", 10);

  await pool.query(`DELETE FROM fiscal_receipts`);
  await pool.query(`DELETE FROM payments`);
  await pool.query(`DELETE FROM sale_items`);
  await pool.query(`DELETE FROM sales`);
  await pool.query(`DELETE FROM cash_sessions`);
  await pool.query(`DELETE FROM products`);
  await pool.query(`DELETE FROM users`);

  await pool.query(
    `INSERT INTO users (email, password_hash, role) VALUES
      ('op@demo.local', $1, 'OPERATOR'),
      ('mgr@demo.local', $1, 'MANAGER')`,
    [hash],
  );

  await pool.query(
    `INSERT INTO products (sku, name, price_cents, stock) VALUES
      ('LAST-UNIT', 'Última unidade (demo concorrência)', 1990, 1),
      ('SKU-COFFEE', 'Café 500g', 2490, 25),
      ('SKU-WATER', 'Água 1.5L', 399, 80),
      ('SKU-BREAD', 'Pão francês (un)', 150, 40)`,
  );

  console.log("seed ok — op@demo.local / mgr@demo.local — password demo1234");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
