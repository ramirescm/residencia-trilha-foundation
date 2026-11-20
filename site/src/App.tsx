import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  completeNewPassword,
  confirmPasswordReset,
  confirmSignUp,
  requestPasswordReset,
  resendSignUpCode,
  restoreSession,
  signIn,
  signOut,
  signUp,
  type AuthenticatedUser,
  type NewPasswordChallenge,
} from "./lib/auth";
import {
  createOrder,
  createProduct,
  deleteProduct,
  listBuyerOrders,
  listProducts,
  listSellerOrders,
  updateProduct,
  type Order,
  type Product,
} from "./lib/api";
import { environmentLabel, isMockMode } from "./lib/config";

type AuthView = "login" | "signup" | "confirm-signup" | "forgot" | "reset" | "new-password";
type MarketView = "catalog" | "products" | "orders";
type CartItem = { productId: string; quantity: number };

const errorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return "Não foi possível concluir a solicitação agora.";
};

const validEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value);
const money = (value: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL",
}).format(value / 100);
const orderStatusLabel = (status: string) => {
  if (status === "processed") return "Confirmado";
  if (status === "accepted" || status === "pending") return "Pendente";
  return status;
};

const productImages = (product: Product): string[] =>
  product.imageUrls?.length ? product.imageUrls : product.imageUrl ? [product.imageUrl] : [];

const Brand = () => (
  <a className="brand" href="/" aria-label="Foundation Market, início">
    <span className="brand-mark">F</span>
    <span className="brand-copy"><strong>Foundation</strong><small>Market</small></span>
  </a>
);

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: AuthenticatedUser) => void }) {
  const [view, setView] = useState<AuthView>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<NewPasswordChallenge | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const navigate = (next: AuthView) => {
    setError(""); setNotice(""); setCode(""); setNewPassword(""); setView(next);
  };

  const run = async (action: () => Promise<void>) => {
    setError(""); setLoading(true);
    try { await action(); } catch (failure) { setError(errorMessage(failure)); }
    finally { setLoading(false); }
  };

  const handleLogin = (event: FormEvent) => {
    event.preventDefault();
    if (!validEmail(email)) return setError("Informe um e-mail válido.");
    if (password.length < 6) return setError("A senha deve ter pelo menos seis caracteres.");
    void run(async () => {
      const result = await signIn(email.trim().toLowerCase(), password);
      if (result.status === "new-password-required") {
        setChallenge(result.challenge); setView("new-password"); return;
      }
      onAuthenticated(result.user);
    });
  };

  const handleSignUp = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().split(/\s+/).length < 2) return setError("Informe seu nome completo.");
    if (!validEmail(email)) return setError("Informe um e-mail válido.");
    if (password.length < 8) return setError("A senha deve ter pelo menos oito caracteres.");
    void run(async () => {
      const result = await signUp(name.trim(), email.trim().toLowerCase(), password);
      if (result.confirmed) {
        setNotice("Cadastro criado. Agora entre com suas credenciais."); setView("login");
      } else {
        setNotice(result.destination ? `Enviamos um código para ${result.destination}.` : "Enviamos um código de confirmação.");
        setView("confirm-signup");
      }
    });
  };

  const handleConfirmation = (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return setError("Informe o código de confirmação.");
    void run(async () => {
      await confirmSignUp(email.trim().toLowerCase(), code.trim());
      setNotice("E-mail confirmado. Sua conta está pronta."); setView("login");
    });
  };

  const handleForgot = (event: FormEvent) => {
    event.preventDefault();
    if (!validEmail(email)) return setError("Informe o e-mail usado no cadastro.");
    void run(async () => { await requestPasswordReset(email.trim().toLowerCase()); setView("reset"); });
  };

  const handleReset = (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return setError("Informe o código de confirmação.");
    if (newPassword.length < 8) return setError("A nova senha deve ter pelo menos oito caracteres.");
    void run(async () => {
      await confirmPasswordReset(email.trim().toLowerCase(), code.trim(), newPassword);
      setPassword(""); setNotice("Senha alterada. Faça seu login."); setView("login");
    });
  };

  const handleNewPassword = (event: FormEvent) => {
    event.preventDefault();
    if (!challenge) return navigate("login");
    if (newPassword.length < 8) return setError("A nova senha deve ter pelo menos oito caracteres.");
    void run(async () => onAuthenticated(await completeNewPassword(challenge, newPassword)));
  };

  return (
    <main className="login-page">
      <div className="page-grid" aria-hidden="true" /><div className="orbit orbit-one" /><div className="orbit orbit-two" />
      <header className="login-header"><Brand /><div className={`lab-status environment-status ${isMockMode ? "is-mock" : "is-production"}`}><span className="status-dot" />{environmentLabel}</div></header>
      <section className="login-story">
        <div className="story-code">MARKETPLACE FULL CYCLE</div>
        <h1>Descubra. <em>Compre e venda.</em></h1>
        <p>Uma experiência completa de marketplace, com identidade, catálogo, estoque, pedidos e processamento assíncrono.</p>
        <div className="journey-line">
          <div className="journey-item journey-item-active"><span>01</span><strong>Acesso</strong></div>
          <div className="journey-item"><span>02</span><strong>Catálogo</strong></div>
          <div className="journey-item"><span>03</span><strong>Pedidos</strong></div>
        </div>
        <div className="story-footer"><span>Cognito</span><span>API Gateway</span><span>DynamoDB</span></div>
      </section>
      <section className="access-panel" aria-label="Acesso à plataforma">
        <div className="panel-topline"><span><i /> Acesso seguro</span><span>{environmentLabel}</span></div>
        <div className="panel-content">
          {view === "login" && <form onSubmit={handleLogin} noValidate>
            <div className="form-heading"><span>Acesso individual</span><h2>Entre na sua conta.</h2><p>Uma conta compra, vende e acompanha pedidos.</p></div>
            <Field label="E-mail"><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@exemplo.com" /></Field>
            <Field label="Senha"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Digite sua senha" /></Field>
            {notice && <p className="form-notice">{notice}</p>}{error && <p className="form-error">{error}</p>}
            <button className="submit-button" disabled={loading}><span>{loading ? "Validando" : "Acessar marketplace"}</span><b>→</b></button>
            <div className="auth-links"><button type="button" onClick={() => navigate("signup")}>Criar uma conta</button><button type="button" onClick={() => navigate("forgot")}>Esqueci minha senha</button></div>
          </form>}
          {view === "signup" && <form onSubmit={handleSignUp} noValidate>
            <div className="form-heading"><span>Novo acesso</span><h2>Crie sua conta.</h2><p>A mesma identidade poderá comprar e vender.</p></div>
            <Field label="Nome completo"><input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome e sobrenome" /></Field>
            <Field label="E-mail"><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@exemplo.com" /></Field>
            <Field label="Senha"><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo de 8 caracteres" /></Field>
            {error && <p className="form-error">{error}</p>}<button className="submit-button" disabled={loading}><span>{loading ? "Criando conta" : "Criar conta"}</span><b>→</b></button>
            <button className="back-button" type="button" onClick={() => navigate("login")}>Já tenho uma conta</button>
          </form>}
          {view === "confirm-signup" && <form onSubmit={handleConfirmation}>
            <div className="form-heading"><span>Confirmação</span><h2>Confirme seu e-mail.</h2><p>{notice || `Informe o código enviado para ${email}.`}</p></div>
            <Field label="Código"><input autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" /></Field>
            {error && <p className="form-error">{error}</p>}<button className="submit-button" disabled={loading}><span>Confirmar cadastro</span><b>→</b></button>
            <div className="auth-links"><button type="button" onClick={() => void run(() => resendSignUpCode(email))}>Reenviar código</button><button type="button" onClick={() => navigate("login")}>Voltar</button></div>
          </form>}
          {view === "forgot" && <form onSubmit={handleForgot}>
            <div className="form-heading"><span>Recuperação</span><h2>Recupere sua senha.</h2><p>Enviaremos um código para o e-mail da conta.</p></div>
            <Field label="E-mail"><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@exemplo.com" /></Field>
            {error && <p className="form-error">{error}</p>}<button className="submit-button" disabled={loading}><span>Enviar código</span><b>→</b></button><button className="back-button" type="button" onClick={() => navigate("login")}>Voltar ao login</button>
          </form>}
          {view === "reset" && <form onSubmit={handleReset}>
            <div className="form-heading"><span>Nova credencial</span><h2>Defina sua senha.</h2><p>Use o código enviado para {email}.</p></div>
            <Field label="Código"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" /></Field>
            <Field label="Nova senha"><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Mínimo de 8 caracteres" /></Field>
            {error && <p className="form-error">{error}</p>}<button className="submit-button" disabled={loading}><span>Salvar nova senha</span><b>→</b></button>
          </form>}
          {view === "new-password" && <form onSubmit={handleNewPassword}>
            <div className="form-heading"><span>Primeiro acesso</span><h2>Crie sua senha.</h2><p>Substitua a senha temporária antes de continuar.</p></div>
            <Field label="Nova senha"><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Mínimo de 8 caracteres" /></Field>
            {error && <p className="form-error">{error}</p>}<button className="submit-button" disabled={loading}><span>Ativar acesso</span><b>→</b></button>
          </form>}
        </div>
        <div className="panel-footer"><span>JWT protegido</span><span>Foundation / Sprint 02</span></div>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Marketplace({ user, onLogout }: { user: AuthenticatedUser; onLogout: () => void }) {
  const [view, setView] = useState<MarketView>("catalog");
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<Order[]>([]);
  const [sales, setSales] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const cartStorageKey = `foundation-market:cart:${user.sub}`;
  const [cart, setCart] = useState<CartItem[]>(() => {
    const stored = window.localStorage.getItem(cartStorageKey);
    return stored ? JSON.parse(stored) as CartItem[] : [];
  });

  const applyOrders = (nextPurchases: Order[], nextSales: Order[]) => {
    setPurchases(nextPurchases); setSales(nextSales);
  };

  const refresh = async () => {
    setError("");
    try {
      const [nextProducts, nextPurchases, nextSales] = await Promise.all([
        listProducts(user), listBuyerOrders(user), listSellerOrders(user),
      ]);
      setProducts(nextProducts); applyOrders(nextPurchases, nextSales);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => { window.localStorage.setItem(cartStorageKey, JSON.stringify(cart)); }, [cart, cartStorageKey]);
  useEffect(() => { window.localStorage.removeItem(`foundation-market:pending-orders:${user.sub}`); }, [user.sub]);
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const myProducts = useMemo(() => products.filter((product) => product.sellerId === user.sub), [products, user.sub]);
  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);

  const showStoredOrder = (order: Order) => {
    setPurchases((current) => [order, ...current.filter((item) => item.id !== order.id)]);
    if (order.sellerId === user.sub) {
      setSales((current) => [order, ...current.filter((item) => item.id !== order.id)]);
    }
  };

  const pollOrder = (orderId: string, attempt = 0) => {
    const delays = [600, 1_200, 2_000, 3_500, 5_000, 8_000, 12_000, 15_000];
    window.setTimeout(async () => {
      try {
        const [nextPurchases, nextSales] = await Promise.all([
          listBuyerOrders(user), listSellerOrders(user),
        ]);
        applyOrders(nextPurchases, nextSales);
        const trackedOrder = [...nextPurchases, ...nextSales]
          .find((order) => order.id === orderId);
        if (trackedOrder?.status === "processed") {
          setFeedback(`Pedido ${orderId.slice(0, 8)} confirmado.`);
          return;
        }
      } catch {
        // A atualização automática tenta novamente enquanto o pedido permanece pendente.
      }
      if (attempt < delays.length - 1) pollOrder(orderId, attempt + 1);
    }, delays[attempt]);
  };

  const buy = async (product: Product, requestedQuantity?: number) => {
    const quantity = requestedQuantity ?? 1;
    setBusy(`buy:${product.id}`); setError(""); setFeedback("");
    try {
      const result = await createOrder(user, product.id, quantity);
      if (result.order) showStoredOrder(result.order);
      setFeedback(`Pedido ${result.orderId.slice(0, 8)} recebido e pendente de confirmação.`);
      setSelectedProduct(null);
      setView("orders");
      pollOrder(result.orderId);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(""); }
  };

  const addToCart = (product: Product, quantity: number) => {
    setCart((current) => {
      const existing = current.find((item) => item.productId === product.id);
      if (existing) return current.map((item) => item.productId === product.id
        ? { ...item, quantity: Math.min(product.stock, item.quantity + quantity) }
        : item);
      return [...current, { productId: product.id, quantity: Math.min(product.stock, quantity) }];
    });
    setFeedback(`${product.name} foi adicionado ao carrinho.`);
    setSelectedProduct(null);
  };

  const updateCartQuantity = (productId: string, quantity: number) => {
    const stock = productById.get(productId)?.stock ?? 0;
    if (quantity <= 0) setCart((current) => current.filter((item) => item.productId !== productId));
    else setCart((current) => current.map((item) => item.productId === productId
      ? { ...item, quantity: Math.min(stock, quantity) }
      : item));
  };

  const checkoutCart = async () => {
    setBusy("cart"); setError("");
    try {
      const pendingIds: string[] = [];
      for (const item of cart) {
        const product = productById.get(item.productId);
        if (!product) continue;
        const result = await createOrder(user, item.productId, item.quantity);
        if (result.order) showStoredOrder(result.order);
        pendingIds.push(result.orderId);
      }
      const purchased = cart.length;
      setCart([]); setCartOpen(false);
      setView("orders");
      setFeedback(`${purchased} ${purchased === 1 ? "pedido pendente" : "pedidos pendentes"} de confirmação.`);
      pendingIds.forEach((orderId) => pollOrder(orderId));
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(""); }
  };

  const removeProduct = async (product: Product) => {
    if (!window.confirm(`Remover “${product.name}” do catálogo?`)) return;
    setBusy(`delete:${product.id}`); setError("");
    try {
      await deleteProduct(user, product.id);
      setFeedback("Produto removido do catálogo.");
      await refresh();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(""); }
  };

  const removeProducts = async (selectedProducts: Product[]) => {
    if (selectedProducts.length === 0) return;
    const label = selectedProducts.length === 1 ? "produto selecionado" : "produtos selecionados";
    if (!window.confirm(`Remover ${selectedProducts.length} ${label} do catálogo?`)) return;
    setBusy("delete:bulk"); setError(""); setFeedback("");
    try {
      const results = await Promise.allSettled(
        selectedProducts.map((product) => deleteProduct(user, product.id)),
      );
      const removed = results.filter((result) => result.status === "fulfilled").length;
      const failed = results.length - removed;
      await refresh();
      if (removed > 0) {
        setFeedback(`${removed} ${removed === 1 ? "produto removido" : "produtos removidos"} do catálogo.`);
      }
      if (failed > 0) {
        setError(`${failed} ${failed === 1 ? "produto não pôde" : "produtos não puderam"} ser removido${failed === 1 ? "" : "s"}.`);
      }
    } finally { setBusy(""); }
  };

  const openCreate = () => { setEditingProduct(null); setShowProductForm(true); };
  const openEdit = (product: Product) => { setEditingProduct(product); setShowProductForm(true); };

  return <main className="market-shell">
    <header className="market-header"><Brand />
      <nav><button className={view === "catalog" ? "active" : ""} onClick={() => setView("catalog")}>Explorar</button><button className={view === "products" ? "active" : ""} onClick={() => setView("products")}>Meus produtos</button><button className={view === "orders" ? "active" : ""} onClick={() => setView("orders")}>Pedidos</button></nav>
      <div className="account"><button className="cart-trigger" onClick={() => setCartOpen(true)} aria-label={`Abrir carrinho com ${cartCount} itens`}>Carrinho <b>{cartCount}</b></button><i className={`environment-badge ${isMockMode ? "is-mock" : "is-production"}`}>{environmentLabel}</i><span>{user.name.slice(0, 2).toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.email}</small></div><button onClick={onLogout}>Sair</button></div>
    </header>
    <section className="market-main">
      {error && <div className="market-alert error">{error}<button onClick={() => setError("")}>×</button></div>}
      {feedback && <aside className="commerce-toast" role="status"><span>✓</span><div><strong>Marketplace atualizado</strong><p>{feedback}</p></div><button onClick={() => setFeedback("")}>×</button></aside>}
      {view === "catalog" ? <>
        <section className="market-hero"><div><span>FOUNDATION MARKET / CATÁLOGO</span><h1>Produtos para descobrir.<em>Espaço para vender.</em></h1><p>Todos os usuários podem publicar produtos, controlar o estoque e também comprar.</p></div><button onClick={openCreate}>Cadastrar produto <b>+</b></button></section>
        <section className="catalog-heading"><div><span>CATÁLOGO ATUAL</span><h2>{products.length} {products.length === 1 ? "produto disponível" : "produtos disponíveis"}</h2></div><button onClick={() => void refresh()}>Atualizar</button></section>
        {loading ? <p className="empty-state">Carregando catálogo...</p> : products.length === 0 ? <p className="empty-state">Nenhum produto cadastrado. Publique o primeiro produto do marketplace.</p> : <div className="product-grid">{products.map((product) => <article className="product-card" key={product.id}>
          <div className="product-image">{productImages(product)[0] ? <img src={productImages(product)[0]} alt="" /> : <span>{product.name.slice(0, 2).toUpperCase()}</span>}<small>{product.sellerId === user.sub ? "SEU PRODUTO" : "MARKETPLACE"}</small>{productImages(product).length > 1 && <b className="gallery-count">+{productImages(product).length - 1} fotos</b>}</div>
          <div className="product-copy"><h3>{product.name}</h3><p>{product.description || "Produto sem descrição."}</p><div><strong>{money(product.priceCents)}</strong><span>{product.stock} em estoque</span></div></div>
          <div className="product-card-action"><button onClick={() => setSelectedProduct(product)}>Ver produto <b>→</b></button></div>
        </article>)}</div>}
      </> : view === "products" ? <ProductsView products={myProducts} busy={busy} onCreate={openCreate} onEdit={openEdit} onDelete={(product) => void removeProduct(product)} onDeleteMany={(selectedProducts) => void removeProducts(selectedProducts)} /> : <OrdersView purchases={purchases} sales={sales} productById={productById} />}
    </section>
    {showProductForm && <ProductDialog user={user} product={editingProduct} onClose={() => setShowProductForm(false)} onSaved={async () => { setShowProductForm(false); setFeedback(editingProduct ? "Produto atualizado." : "Produto cadastrado e disponível no catálogo."); await refresh(); }} />}
    {selectedProduct && <ProductDetail product={selectedProduct} busy={busy === `buy:${selectedProduct.id}`} onClose={() => setSelectedProduct(null)} onBuy={(quantity) => void buy(selectedProduct, quantity)} onAddCart={(quantity) => addToCart(selectedProduct, quantity)} />}
    {cartOpen && <CartDrawer cart={cart} productById={productById} busy={busy === "cart"} onClose={() => setCartOpen(false)} onQuantity={updateCartQuantity} onCheckout={() => void checkoutCart()} />}
  </main>;
}

function ProductDialog({ user, product, onClose, onSaved }: { user: AuthenticatedUser; product: Product | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(product?.name ?? ""); const [description, setDescription] = useState(product?.description ?? "");
  const [price, setPrice] = useState(product ? String(product.priceCents / 100).replace(".", ",") : ""); const [stock, setStock] = useState(String(product?.stock ?? 1));
  const [images, setImages] = useState<File[]>([]); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [previewImage, setPreviewImage] = useState<number | null>(null);
  const existingImages = product ? productImages(product) : [];
  const allPreviewImages = [...existingImages, ...imagePreviews];

  useEffect(() => {
    const urls = images.map((image) => URL.createObjectURL(image));
    setImagePreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [images]);

  const submit = (event: FormEvent) => {
    event.preventDefault(); setError("");
    const priceCents = Math.round(Number(price.replace(",", ".")) * 100); const stockValue = Number(stock);
    if (!name.trim() || !Number.isInteger(priceCents) || priceCents <= 0 || !Number.isInteger(stockValue) || stockValue < 0) return setError("Informe nome, preço e estoque válidos.");
    setSaving(true);
    const input = { name: name.trim(), description: description.trim(), priceCents, stock: stockValue };
    const operation = product ? updateProduct(user, product.id, input, images) : createProduct(user, input, images);
    void operation.then(onSaved).catch((failure) => setError(errorMessage(failure))).finally(() => setSaving(false));
  };
  return <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="product-dialog" role="dialog" aria-modal="true"><header><div><span>{product ? "EDITAR PRODUTO" : "NOVO PRODUTO"}</span><h2>{product ? "Atualize produto e estoque." : "Cadastre o que você quer vender."}</h2></div><button onClick={onClose}>×</button></header><form onSubmit={submit}>
    <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Monitor ultrawide" /></Field>
    <Field label="Descrição"><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descreva o produto e seu estado" /></Field>
    <div className="form-columns"><Field label="Preço em reais"><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="499,90" /></Field><Field label="Estoque"><input type="number" min="0" value={stock} onChange={(e) => setStock(e.target.value)} /></Field></div>
    <label className={`image-drop ${allPreviewImages.length > 0 ? "has-gallery-preview" : ""}`}><input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(e) => setImages(Array.from(e.target.files ?? []).slice(0, Math.max(0, 8 - existingImages.length)))} />{allPreviewImages.length > 0 && <div className="upload-gallery">{allPreviewImages.map((url, index) => <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setPreviewImage(index); }} aria-label={`Ampliar imagem ${index + 1}`} key={`${url}-${index}`}><img src={url} alt={`Pré-visualização ${index + 1}`} /><span>Ampliar</span></button>)}</div>}<span>{images.length > 0 ? `${images.length} novas imagens selecionadas` : existingImages.length > 0 ? "Adicionar imagens à galeria" : "Selecionar imagens do produto"}</span><small>Até 8 imagens. Clique em uma prévia para ampliar. PNG, JPEG ou WebP.</small></label>
    {error && <p className="form-error">{error}</p>}<button className="dialog-submit" disabled={saving}>{saving ? "Salvando e enviando imagem..." : product ? "Salvar alterações" : "Publicar produto"} <b>→</b></button>
  </form></section>{previewImage !== null && <ImageLightbox images={allPreviewImages} activeImage={previewImage} onChange={setPreviewImage} onClose={() => setPreviewImage(null)} />}</div>;
}

function ImageLightbox({ images, activeImage, onChange, onClose }: { images: string[]; activeImage: number; onChange: (index: number) => void; onClose: () => void }) {
  const move = (direction: number) => onChange((activeImage + direction + images.length) % images.length);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && images.length > 1) move(-1);
      if (event.key === "ArrowRight" && images.length > 1) move(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeImage, images.length, onClose]);

  return <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="Pré-visualização das imagens do produto" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section><header><div><span>GALERIA DO PRODUTO</span><strong>{activeImage + 1} de {images.length}</strong></div><button type="button" onClick={onClose} aria-label="Fechar pré-visualização">×</button></header><div className="lightbox-image"><img src={images[activeImage]} alt={`Imagem ampliada ${activeImage + 1}`} />{images.length > 1 && <><button type="button" className="lightbox-previous" onClick={() => move(-1)} aria-label="Imagem anterior">‹</button><button type="button" className="lightbox-next" onClick={() => move(1)} aria-label="Próxima imagem">›</button></>}</div>{images.length > 1 && <div className="lightbox-thumbnails">{images.map((image, index) => <button type="button" className={index === activeImage ? "active" : ""} onClick={() => onChange(index)} aria-label={`Ver imagem ${index + 1}`} key={`${image}-${index}`}><img src={image} alt="" /></button>)}</div>}</section></div>;
}

function ProductsView({ products, busy, onCreate, onEdit, onDelete, onDeleteMany }: { products: Product[]; busy: string; onCreate: () => void; onEdit: (product: Product) => void; onDelete: (product: Product) => void; onDeleteMany: (products: Product[]) => void }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedProducts = products.filter((product) => selectedIds.includes(product.id));
  const allSelected = products.length > 0 && selectedProducts.length === products.length;

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => products.some((product) => product.id === id)));
  }, [products]);

  const toggleProduct = (productId: string) => {
    setSelectedIds((current) => current.includes(productId)
      ? current.filter((id) => id !== productId)
      : [...current, productId]);
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : products.map((product) => product.id));
  };

  return <section className="managed-products"><div className="managed-products-hero"><div><span>GESTÃO / MEUS PRODUTOS</span><h1>Seu catálogo.<em>Sob seu controle.</em></h1><p>Edite informações e estoque ou remova produtos da vitrine.</p></div><button onClick={onCreate}>Novo produto <b>+</b></button></div>{products.length === 0 ? <p className="empty-state">Você ainda não cadastrou produtos.</p> : <><div className="products-bulk-actions"><label><input type="checkbox" checked={allSelected} onChange={toggleAll} />Selecionar todos</label><span>{selectedProducts.length} {selectedProducts.length === 1 ? "selecionado" : "selecionados"}</span><button className="danger" disabled={selectedProducts.length === 0 || busy === "delete:bulk"} onClick={() => onDeleteMany(selectedProducts)}>{busy === "delete:bulk" ? "Excluindo..." : "Excluir selecionados"}</button></div><div className="products-table"><div className="products-table-head"><span className="product-heading"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Selecionar todos os produtos" />PRODUTO</span><span>PREÇO</span><span>ESTOQUE</span><span>AÇÕES</span></div>{products.map((product) => <div className={`products-table-row ${selectedIds.includes(product.id) ? "selected" : ""}`} key={product.id}><div className="managed-product"><input type="checkbox" checked={selectedIds.includes(product.id)} onChange={() => toggleProduct(product.id)} aria-label={`Selecionar ${product.name}`} /><span>{productImages(product)[0] ? <img src={productImages(product)[0]} alt="" /> : product.name.slice(0, 2).toUpperCase()}</span><div><strong>{product.name}</strong><small>{product.description || "Sem descrição"}</small></div></div><strong>{money(product.priceCents)}</strong><span className={product.stock === 0 ? "out-of-stock" : ""}>{product.stock} un.</span><div className="product-actions"><button onClick={() => onEdit(product)}>Editar</button><button className="danger" disabled={busy === `delete:${product.id}` || busy === "delete:bulk"} onClick={() => onDelete(product)}>{busy === `delete:${product.id}` ? "Removendo" : "Remover"}</button></div></div>)}</div></>}</section>;
}

function ProductDetail({ product, busy, onClose, onBuy, onAddCart }: { product: Product; busy: boolean; onClose: () => void; onBuy: (quantity: number) => void; onAddCart: (quantity: number) => void }) {
  const images = productImages(product);
  const [activeImage, setActiveImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const move = (direction: number) => setActiveImage((current) => (current + direction + images.length) % images.length);
  return <div className="detail-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="product-detail" role="dialog" aria-modal="true" aria-label={product.name}><button className="detail-close" onClick={onClose}>×</button><div className={`detail-gallery ${images.length === 0 ? "no-images" : ""}`}><div className="detail-thumbnails">{images.map((image, index) => <button className={index === activeImage ? "active" : ""} onClick={() => setActiveImage(index)} key={image}><img src={image} alt={`Miniatura ${index + 1}`} /></button>)}</div><div className="detail-main-image">{images[activeImage] ? <img src={images[activeImage]} alt={product.name} /> : <span>{product.name.slice(0, 2).toUpperCase()}</span>}{images.length > 1 && <><button className="gallery-previous" onClick={() => move(-1)}>‹</button><button className="gallery-next" onClick={() => move(1)}>›</button><small>{activeImage + 1} / {images.length}</small></>}</div></div><div className="detail-copy"><span className="detail-eyebrow">PRODUTO DO MARKETPLACE</span><h2>{product.name}</h2><p>{product.description || "Produto sem descrição."}</p><div className="detail-price"><strong>{money(product.priceCents)}</strong><small>Compra protegida pela plataforma</small></div><div className="detail-stock"><strong>{product.stock > 0 ? "Estoque disponível" : "Produto sem estoque"}</strong><span>{product.stock} unidades disponíveis</span></div><label className="detail-quantity">Quantidade<input type="number" min="1" max={product.stock} value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.min(product.stock, Number(event.target.value))))} /></label><div className="detail-actions"><button className="buy-now" disabled={busy || product.stock === 0} onClick={() => onBuy(quantity)}>{busy ? "Processando compra..." : "Comprar agora"}</button><button className="add-cart" disabled={product.stock === 0} onClick={() => onAddCart(quantity)}>Adicionar ao carrinho</button></div><div className="detail-assurances"><span><b>✓</b> Pedido registrado na sua conta</span><span><b>✓</b> Estoque atualizado após o processamento</span></div></div></section></div>;
}

function CartDrawer({ cart, productById, busy, onClose, onQuantity, onCheckout }: { cart: CartItem[]; productById: Map<string, Product>; busy: boolean; onClose: () => void; onQuantity: (productId: string, quantity: number) => void; onCheckout: () => void }) {
  const availableItems = cart.flatMap((item) => {
    const product = productById.get(item.productId);
    return product ? [{ item, product }] : [];
  });
  const total = availableItems.reduce((value, { item, product }) => value + product.priceCents * item.quantity, 0);
  return <div className="cart-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="cart-drawer"><header><div><span>SEU CARRINHO</span><h2>{cart.length} {cart.length === 1 ? "produto" : "produtos"}</h2></div><button onClick={onClose}>×</button></header><div className="cart-lines">{availableItems.length === 0 ? <p className="empty-state">Seu carrinho está vazio.</p> : availableItems.map(({ item, product }) => <article key={product.id}><div className="cart-image">{productImages(product)[0] ? <img src={productImages(product)[0]} alt="" /> : product.name.slice(0, 2).toUpperCase()}</div><div className="cart-line-copy"><strong>{product.name}</strong><span>{money(product.priceCents)}</span><label>Quantidade<input type="number" min="0" max={product.stock} value={item.quantity} onChange={(event) => onQuantity(product.id, Number(event.target.value))} /></label><button onClick={() => onQuantity(product.id, 0)}>Remover</button></div><b>{money(product.priceCents * item.quantity)}</b></article>)}</div><footer><div><span>Total</span><strong>{money(total)}</strong></div><button disabled={busy || availableItems.length === 0} onClick={onCheckout}>{busy ? "Processando pedidos..." : "Comprar produtos do carrinho"} <b>→</b></button><small>Os pedidos serão enviados para processamento individualmente.</small></footer></aside></div>;
}

function OrdersView({ purchases, sales, productById }: { purchases: Order[]; sales: Order[]; productById: Map<string, Product> }) {
  const buyerLabel = (order: Order) => {
    const name = order.buyerName?.trim();
    const email = order.buyerEmail?.trim();
    if (name && email) return `${name} · ${email}`;
    return name || email || order.buyerId;
  };
  const table = (orders: Order[], empty: string, showBuyer = false) => orders.length === 0 ? <p className="empty-state">{empty}</p> : <div className="orders-table">{orders.map((order) => <div key={order.id}><span className={`order-status ${order.status}`}>{orderStatusLabel(order.status)}</span><div><strong>{productById.get(order.productId)?.name ?? order.productId}</strong>{showBuyer && <small className="order-buyer">Comprador: {buyerLabel(order)}</small>}<small>Pedido {order.id.slice(0, 8)} · {new Date(order.createdAt).toLocaleString("pt-BR")}</small></div><b>{order.quantity} un.</b></div>)}</div>;
  return <section className="orders-page"><div className="orders-hero"><span>PEDIDOS / DYNAMODB</span><h1>O que você comprou.<em>O que você vendeu.</em></h1></div><div className="orders-columns"><section><header><span>COMPRAS</span><strong>{purchases.length}</strong></header>{table(purchases, "Você ainda não fez nenhuma compra.")}</section><section><header><span>VENDAS</span><strong>{sales.length}</strong></header>{table(sales, "Nenhum pedido recebido para seus produtos.", true)}</section></div></section>;
}

export default function App() {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [restoring, setRestoring] = useState(true);
  useEffect(() => { restoreSession().then(setUser).finally(() => setRestoring(false)); }, []);
  if (restoring) return <main className="app-loading"><Brand /><span>Preparando marketplace...</span></main>;
  if (!user) return <AuthScreen onAuthenticated={setUser} />;
  return <Marketplace user={user} onLogout={() => { signOut(); setUser(null); }} />;
}
