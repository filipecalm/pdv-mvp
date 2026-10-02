import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

type Product = {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  stock: number;
};

type CartLine = { product: Product; qty: number };
type PayMethod = "PIX" | "CARD" | "CASH";
type User = { id: string; email: string; role: string };

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function App() {
  const [token, setToken] = useState(localStorage.getItem("pdv_token") ?? "");
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem("pdv_user");
    return raw ? (JSON.parse(raw) as User) : null;
  });
  const [email, setEmail] = useState("op@demo.local");
  const [password, setPassword] = useState("demo1234");
  const [sku, setSku] = useState("");
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [method, setMethod] = useState<PayMethod>("PIX");
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const skuRef = useRef<HTMLInputElement>(null);

  const total = useMemo(
    () => cart.reduce((s, line) => s + line.product.priceCents * line.qty, 0),
    [cart],
  );

  const itemCount = useMemo(
    () => cart.reduce((s, line) => s + line.qty, 0),
    [cart],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
    );
  }, [products, query]);

  useEffect(() => {
    if (!token) return;
    void bootstrap(token);
  }, [token]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!token) return;
      if (e.key === "F2") {
        e.preventDefault();
        skuRef.current?.focus();
        skuRef.current?.select();
      }
      if (e.key === "F12") {
        e.preventDefault();
        if (cart.length && !busy) void checkout();
      }
      if (e.key === "Escape") setMessage(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [token, cart, busy, method, total]);

  async function bootstrap(auth: string) {
    await loadProducts(auth);
    const me = await fetch(`${API}/v1/me`, {
      headers: { authorization: `Bearer ${auth}` },
    });
    if (me.ok) {
      const data = await me.json();
      setUser(data.user);
      localStorage.setItem("pdv_user", JSON.stringify(data.user));
    }
    await fetch(`${API}/v1/cash-sessions/open`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ openingFloatCents: 0 }),
    });
    requestAnimationFrame(() => skuRef.current?.focus());
  }

  async function loadProducts(auth: string) {
    const res = await fetch(`${API}/v1/products`, {
      headers: { authorization: `Bearer ${auth}` },
    });
    const data = await res.json();
    setProducts(data.items ?? []);
  }

  async function login(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoggingIn(true);
    try {
      const res = await fetch(`${API}/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOk(false);
        setMessage(data.message ?? "Falha no login");
        return;
      }
      localStorage.setItem("pdv_token", data.token);
      localStorage.setItem("pdv_user", JSON.stringify(data.user));
      setUser(data.user);
      setToken(data.token);
    } catch {
      setOk(false);
      setMessage("API indisponível. Confira se está em :3001.");
    } finally {
      setLoggingIn(false);
    }
  }

  function logout() {
    localStorage.removeItem("pdv_token");
    localStorage.removeItem("pdv_user");
    setToken("");
    setUser(null);
    setCart([]);
    setMessage(null);
  }

  function addProduct(product: Product, qty = 1) {
    if (product.stock < 1) {
      setOk(false);
      setMessage(`${product.sku} sem estoque`);
      return;
    }

    const existing = cart.find((l) => l.product.id === product.id);
    const nextQty = (existing?.qty ?? 0) + qty;
    if (nextQty > product.stock) {
      setOk(false);
      setMessage(
        `Estoque insuficiente para ${product.sku} (máx. ${product.stock})`,
      );
      return;
    }

    setCart((prev) => {
      const current = prev.find((l) => l.product.id === product.id);
      if (current) {
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, qty: current.qty + qty } : l,
        );
      }
      return [...prev, { product, qty }];
    });
    setOk(true);
    setMessage(`${product.name} adicionado`);
  }

  function addBySku(e: FormEvent) {
    e.preventDefault();
    const code = sku.trim();
    if (!code) return;
    const found = products.find(
      (p) => p.sku.toLowerCase() === code.toLowerCase(),
    );
    if (!found) {
      setOk(false);
      setMessage(`SKU não encontrado: ${code}`);
      return;
    }
    addProduct(found);
    setSku("");
    skuRef.current?.focus();
  }

  function setQty(productId: string, qty: number) {
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.product.id !== productId) return l;
          const capped = Math.min(Math.max(qty, 0), l.product.stock);
          return { ...l, qty: capped };
        })
        .filter((l) => l.qty > 0),
    );
  }

  function clearCart() {
    setCart([]);
    setMessage(null);
    skuRef.current?.focus();
  }

  async function checkout() {
    if (!cart.length || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${API}/v1/sales`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          items: cart.map((l) => ({ productId: l.product.id, qty: l.qty })),
          payments: [{ method, amountCents: total }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOk(false);
        setMessage(`${data.code ?? res.status}: ${data.message}`);
        await loadProducts(token);
        return;
      }
      setOk(true);
      setMessage(`Venda concluída · ${money(total)} · ${method}`);
      setCart([]);
      await loadProducts(token);
      skuRef.current?.focus();
    } catch {
      setOk(false);
      setMessage("Falha ao finalizar a venda");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="shell login-shell">
        <section className="login-panel">
          <p className="eyebrow">Caixa · demo</p>
          <h1>PDV MVP</h1>
          <p className="lead">
            Entre para abrir o turno e vender. Fluxo pensado para teclado e
            velocidade.
          </p>
          <form className="login-form" onSubmit={login}>
            <label>
              E-mail
              <input
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button type="submit" disabled={loggingIn}>
              {loggingIn ? "Entrando…" : "Entrar no caixa"}
            </button>
          </form>
          <p className="hint">
            Demo: <code>op@demo.local</code> / <code>demo1234</code>
          </p>
          {message && <div className="toast error">{message}</div>}
        </section>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Turno aberto</p>
          <h1>PDV MVP</h1>
        </div>
        <div className="topbar-meta">
          <div>
            <span className="muted">Operador</span>
            <strong>{user?.email ?? "—"}</strong>
          </div>
          <div>
            <span className="muted">Papel</span>
            <strong>{user?.role ?? "—"}</strong>
          </div>
          <button type="button" className="ghost" onClick={logout}>
            Sair
          </button>
        </div>
      </header>

      <div className="workspace">
        <section className="catalog">
          <div className="section-head">
            <h2>Produtos</h2>
            <input
              className="search"
              placeholder="Filtrar por nome ou SKU"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="product-grid">
            {filtered.map((product) => {
              const out = product.stock < 1;
              return (
                <button
                  key={product.id}
                  type="button"
                  className={`product ${out ? "out" : ""}`}
                  disabled={out || busy}
                  onClick={() => {
                    addProduct(product);
                    skuRef.current?.focus();
                  }}
                >
                  <span className="product-sku">{product.sku}</span>
                  <span className="product-name">{product.name}</span>
                  <span className="product-foot">
                    <strong>{money(product.priceCents)}</strong>
                    <span className={product.stock <= 3 ? "stock-low" : ""}>
                      estoque {product.stock}
                    </span>
                  </span>
                </button>
              );
            })}
            {!filtered.length && (
              <p className="empty">Nenhum produto com esse filtro.</p>
            )}
          </div>
        </section>

        <section className="ticket">
          <form className="scan" onSubmit={addBySku}>
            <label htmlFor="sku">Código / SKU</label>
            <div className="scan-row">
              <input
                id="sku"
                ref={skuRef}
                autoFocus
                placeholder="Digite e pressione Enter"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
              <button type="submit" className="secondary">
                Add
              </button>
            </div>
            <p className="shortcuts">
              <kbd>Enter</kbd> adiciona · <kbd>F2</kbd> foca código ·{" "}
              <kbd>F12</kbd> pagar
            </p>
          </form>

          <div className="cart-head">
            <h2>Cupom</h2>
            <button
              type="button"
              className="ghost"
              onClick={clearCart}
              disabled={!cart.length}
            >
              Limpar
            </button>
          </div>

          <div className="cart-list">
            {!cart.length && (
              <p className="empty">
                Carrinho vazio. Clique num produto ou digite o SKU.
              </p>
            )}
            {cart.map((line) => (
              <article key={line.product.id} className="cart-line">
                <div>
                  <strong>{line.product.name}</strong>
                  <span className="muted">
                    {line.product.sku} · {money(line.product.priceCents)}
                  </span>
                </div>
                <div className="qty">
                  <button
                    type="button"
                    className="icon"
                    onClick={() => setQty(line.product.id, line.qty - 1)}
                    aria-label="Diminuir"
                  >
                    −
                  </button>
                  <span>{line.qty}</span>
                  <button
                    type="button"
                    className="icon"
                    onClick={() => setQty(line.product.id, line.qty + 1)}
                    aria-label="Aumentar"
                    disabled={line.qty >= line.product.stock}
                  >
                    +
                  </button>
                </div>
                <strong className="line-total">
                  {money(line.product.priceCents * line.qty)}
                </strong>
              </article>
            ))}
          </div>

          <div className="pay-panel">
            <div className="methods">
              {(["PIX", "CARD", "CASH"] as PayMethod[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`method ${method === m ? "active" : ""}`}
                  onClick={() => setMethod(m)}
                >
                  {m === "CASH" ? "Dinheiro" : m === "CARD" ? "Cartão" : "PIX"}
                </button>
              ))}
            </div>
            <div className="total-block">
              <div>
                <span className="muted">{itemCount} iten(s)</span>
                <strong className="total">{money(total)}</strong>
              </div>
              <button
                type="button"
                className="pay"
                disabled={!cart.length || busy}
                onClick={() => void checkout()}
              >
                {busy ? "Processando…" : `Finalizar · ${method}`}
              </button>
            </div>
          </div>
        </section>
      </div>

      {message && (
        <div className={`toast ${ok ? "success" : "error"}`} role="status">
          {message}
          <button type="button" className="ghost" onClick={() => setMessage(null)}>
            Fechar
          </button>
        </div>
      )}
    </div>
  );
}
