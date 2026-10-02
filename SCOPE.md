# PDV MVP — product scope

See the career doc source of truth in `docs/carreira/github-pins/pdv-mvp.md` if you keep that repo locally.

## Roles

| Role | Can |
| --- | --- |
| OPERATOR | Open shift, sell, list own sales |
| MANAGER | Operator + cancel sale, adjust stock, close any shift |

## Entities

User, Product, CashSession, Sale, SaleItem, Payment, FiscalReceipt (mock).

## Hard rules

1. Checkout + stock decrement in one DB transaction.
2. Lock product rows by stable `productId` order before validating stock.
3. Concurrent last-unit sales → one 201, one 409 `STOCK_INSUFFICIENT`.
4. Client never sends price; server snapshots name/price on the sale line.
5. Fiscal is mock only — no SEFAZ.
