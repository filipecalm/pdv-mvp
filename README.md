# PDV MVP

**Point-of-sale demo: atomic sale, stock concurrency, cashier UX.**

Two cashiers cannot sell the last unit twice. Checkout and stock decrement run in one transaction. Fiscal layer is simulated.

## Problem

A POS that only lists products is a CRUD tutorial. Real risk is **stock race conditions**, payment consistency, and operator speed. This MVP focuses on those.

## Demo flow

1. Seed products with low stock (`LAST-UNIT` has stock = 1).
2. Open two clients (or run the concurrency test).
3. Both try to buy the last unit → one `201`, one `409`.
4. Sale history shows a single completed sale; stock is zero.

## Stack

| Layer | Choice |
| --- | --- |
| API | Node.js + Express + TypeScript |
| DB | PostgreSQL |
| Auth | JWT — operator vs manager |
| Frontend | React (Vite) — keyboard-first cashier UI |
| Fiscal | Mock NFC-e payload only |

## Domain highlights

- **Atomic sale:** create sale + decrement stock in one transaction
- **Concurrency:** two overlapping checkouts on the same SKU → exactly one wins
- **Roles:** operator sells; manager cancels / adjusts stock
- **Keyboard:** barcode field + shortcuts

## Quick start

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate -w apps/api
npm run db:seed -w apps/api
npm run dev
npm run test:concurrency -w apps/api
```

- API: http://localhost:3001  
- Web: http://localhost:5173  

Demo users (see seed): `op@demo.local` / `mgr@demo.local` — password `demo1234`.

## Concurrency test (must pass)

```text
Given product LAST-UNIT with stock = 1
When two independent clients POST /v1/sales for qty 1 at the same time
Then responses are 201 and 409 (any order)
And the database has exactly one COMPLETED sale
And product.stock = 0
```

## What this is not

- Not SEFAZ homologation or real NFC-e certificates
- Not a full ERP (purchasing, accounting, multi-store)
- Not offline-first sync (roadmap, not MVP)

## License

MIT
