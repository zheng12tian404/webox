// Local contract-shaped mock used only for UI self-test when the real backend is not up.
// NOT part of the production bundle. Port 18080.
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 18080);
const P = '/api/v1';

const image = (n) => `/images/image_0${n}.jpg`;
const nowIso = () => new Date().toISOString();
const today = () => '2026-11-14';

const OPTION_GROUPS = [
  { groupId: 1, name: 'Bun', required: true, minSelect: 1, maxSelect: 1, options: [
    { optionId: 11, name: 'Brioche', priceDeltaCents: 0 },
    { optionId: 12, name: 'Whole Wheat', priceDeltaCents: 0 },
    { optionId: 13, name: 'Lettuce Wrap', priceDeltaCents: 200 },
  ]},
  { groupId: 2, name: 'Sauce', required: true, minSelect: 1, maxSelect: 1, options: [
    { optionId: 14, name: 'Ketchup', priceDeltaCents: 0 },
    { optionId: 15, name: 'Mustard', priceDeltaCents: 50 },
    { optionId: 16, name: 'Mayo', priceDeltaCents: 50 },
  ]},
  { groupId: 3, name: 'Extras', required: false, minSelect: 0, maxSelect: 2, options: [
    { optionId: 17, name: 'Cheese', priceDeltaCents: 300 },
    { optionId: 18, name: 'Bacon', priceDeltaCents: 400 },
    { optionId: 19, name: 'Avocado', priceDeltaCents: 350 },
  ]},
];

const DISHES = [
  { dishId: 1, name: 'Grilled Chicken Rice Bowl', description: 'Char-grilled chicken, jasmine rice and seasonal greens.', priceCents: 3800, category: 'Chinese', spiceLevel: 'Mild', protein: 'Chicken', allergens: ['Soy'], imageUrl: image(1) },
  { dishId: 2, name: 'Salmon Sashimi Set', description: 'Fresh salmon sashimi with rice, miso and pickles.', priceCents: 4500, category: 'Japanese', spiceLevel: 'None', protein: 'Fish', allergens: ['Fish', 'Soy'], imageUrl: image(2) },
  { dishId: 3, name: 'Classic Beef Burger', description: 'Beef patty with lettuce, tomato and your choice of bun and extras.', priceCents: 3800, category: 'Western', spiceLevel: 'None', protein: 'Beef', allergens: ['Gluten', 'Dairy', 'Egg'], imageUrl: image(3), hasOptions: true, hasRequiredOptions: true, optionGroups: OPTION_GROUPS },
  { dishId: 4, name: 'Caesar Salad', description: 'Romaine, parmesan, croutons and grilled chicken.', priceCents: 2800, category: 'Light Meal', spiceLevel: 'None', protein: 'Chicken', allergens: ['Dairy', 'Egg', 'Gluten'], imageUrl: image(4) },
  { dishId: 5, name: 'Spicy Tofu Bowl', description: 'Crispy tofu, chili sauce and steamed vegetables.', priceCents: 3200, category: 'Chinese', spiceLevel: 'Hot', protein: 'Tofu', allergens: ['Soy'], imageUrl: image(5), availableQty: 1 },
  { dishId: 6, name: 'Bibimbap', description: 'Korean rice bowl with vegetables, egg and gochujang.', priceCents: 3600, category: 'Korean', spiceLevel: 'Medium', protein: 'Egg', allergens: ['Egg', 'Soy'], imageUrl: image(6) },
  { dishId: 7, name: 'Pad Thai', description: 'Rice noodles, peanuts, egg and tamarind sauce.', priceCents: 3400, category: 'Southeast Asian', spiceLevel: 'Mild', protein: 'Chicken', allergens: ['Peanuts', 'Egg', 'Fish'], imageUrl: image(7) },
  { dishId: 8, name: 'Turkey Sandwich', description: 'Roasted turkey, cheddar and greens on sourdough.', priceCents: 2600, category: 'Western', spiceLevel: 'None', protein: 'Turkey', allergens: ['Gluten', 'Dairy'], imageUrl: image(8) },
  { dishId: 9, name: 'Miso Soup Set', description: 'Miso soup, rice and grilled mackerel.', priceCents: 3000, category: 'Japanese', spiceLevel: 'None', protein: 'Fish', allergens: ['Soy', 'Fish'], imageUrl: image(9), availableQty: 0 },
].map((d) => ({ availableQty: 24, ...d }));

const stock = new Map(DISHES.map((d) => [d.dishId, d.availableQty]));
const states = new Map(); // dishId -> {published,totalQty}
for (const d of DISHES) states.set(d.dishId, { published: true, totalQty: stock.get(d.dishId) + 4, soldQty: 3, reservedQty: 1 });

let orders = [];
let orderSeq = 100;
const idem = new Map();
const sessions = new Map();
const refreshTokens = new Map();
const prefs = { allergens: ['Egg'], preferredCategories: ['Japanese', 'Western'], spicePreference: 'Mild', tastePreference: 'Balanced', budgetMinCents: 1000, budgetMaxCents: 5000, recommendEnabled: true };
const addresses = [{ id: 1, address: 'Building A, 12F', lastUsedAt: nowIso() }];

const json = (res, status, code, data, message = 'OK', requestId = 'mock-req') => {
  const body = JSON.stringify({ code, message, data, requestId });
  res.writeHead(status, { 'Content-Type': 'application/json', 'X-Request-Id': requestId });
  res.end(body);
};
const ok = (res, data, status = 200) => json(res, status, 'OK', data, 'OK');
const fail = (res, status, code, message, data = null) => json(res, status, code, message, data);

const readBody = (req) => new Promise((resolve) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
});

const userFor = (req) => {
  const auth = req.headers.authorization ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  return sessions.get(token) ?? null;
};

const menuItem = (d) => ({
  dishId: d.dishId, name: d.name, description: d.description, priceCents: d.priceCents,
  priceDisplay: `¥${(d.priceCents / 100).toFixed(2)}`, category: d.category, spiceLevel: d.spiceLevel,
  imageUrl: d.imageUrl, available: stock.get(d.dishId) > 0, availableQty: stock.get(d.dishId),
  lowStock: stock.get(d.dishId) > 0 && stock.get(d.dishId) <= 3, soldOut: stock.get(d.dishId) <= 0,
  hasOptions: Boolean(d.hasOptions), hasRequiredOptions: Boolean(d.hasRequiredOptions), forYou: ['Japanese', 'Western'].includes(d.category),
});

const fullDish = (d) => ({
  ...menuItem(d), protein: d.protein, allergens: d.allergens,
  optionGroups: d.optionGroups ?? [],
});

const computeItems = (items) => {
  const lines = [];
  let totalCents = 0;
  let itemCount = 0;
  for (const it of items ?? []) {
    const d = DISHES.find((x) => x.dishId === it.dishId);
    if (!d) continue;
    const opts = [];
    for (const g of d.optionGroups ?? []) {
      for (const oid of it.optionIds ?? []) {
        const o = g.options.find((x) => x.optionId === oid);
        if (o) opts.push({ name: o.name, priceDeltaCents: o.priceDeltaCents });
      }
    }
    const unit = d.priceCents + opts.reduce((s, o) => s + o.priceDeltaCents, 0);
    const qty = Math.max(1, Number(it.qty) || 1);
    const subtotal = unit * qty;
    lines.push({ dishId: d.dishId, dishName: d.name, options: opts, qty, unitPriceCents: unit, subtotalCents: subtotal });
    totalCents += subtotal;
    itemCount += qty;
  }
  return { lines, totalCents, itemCount };
};

const previewData = (body) => {
  const { lines, totalCents, itemCount } = computeItems(body.items);
  const active = orders.find((o) => ['Pending', 'Confirmed'].includes(o.status) && o.deliveryDate === (body.deliveryDate ?? today()) && o.mealType === (body.mealType ?? 'Lunch'));
  return {
    items: lines, totalCents, itemCount, effectiveDate: body.deliveryDate ?? today(), effectiveMeal: body.mealType ?? 'Lunch',
    cutoffAt: `${body.deliveryDate ?? today()}T10:00:00+08:00`, autoSwitched: false,
    budgetExceeded: totalCents > prefs.budgetMaxCents, existingOrderId: active?.orderId ?? null, addresses,
  };
};

const makeOrder = (body, user) => {
  const p = computeItems(body.items);
  orderSeq += 1;
  const o = {
    orderId: orderSeq, orderNo: `WB20261114-${String(orderSeq).padStart(4, '0')}`, status: 'Pending',
    totalCents: p.totalCents, itemCount: p.itemCount, deliveryDate: body.deliveryDate ?? today(),
    mealType: body.mealType ?? 'Lunch', address: body.address ?? 'Building A, 12F', createdAt: nowIso(),
    items: p.lines, cancelledAt: null, cancelReason: null, estimatedDelivery: `${body.mealType ?? 'Lunch'} on ${body.deliveryDate ?? today()}`,
    userId: user?.id ?? 1,
  };
  orders.unshift(o);
  return o;
};

const sseHead = (res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry:3000\n\n');
};
const sseEvent = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(P, '');
  const method = req.method ?? 'GET';
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : {};
  const user = userFor(req);
  const needsAuth = !['/auth/login', '/auth/register', '/auth/refresh', '/health'].includes(path);

  if (needsAuth && !user) return fail(res, 401, 'AUTH_UNAUTHORIZED', 'Unauthorized');

  if (path === '/health') return ok(res, { status: 'UP', db: 'UP', redis: 'UP', cache: 'UP' });

  if (path === '/auth/login' && method === 'POST') {
    const email = String(body.email ?? '').toLowerCase();
    const role = email.includes('admin') ? 'ADMIN' : 'EMPLOYEE';
    const u = { id: role === 'ADMIN' ? 1 : 2, email: email || 'employee@webox.com', role, displayName: role === 'ADMIN' ? 'Admin' : 'Employee' };
    const token = `mock-${role}-${Date.now()}`;
    sessions.set(token, u);
    refreshTokens.set(`refresh-${token}`, u);
    return ok(res, { accessToken: token, refreshToken: `refresh-${token}`, expiresIn: 7200, user: u });
  }
  if (path === '/auth/register' && method === 'POST') return ok(res, { id: 3, email: body.email, role: 'EMPLOYEE' }, 201);
  if (path === '/auth/refresh') {
    const prev = refreshTokens.get(body.refreshToken);
    if (!prev) return fail(res, 401, 'AUTH_TOKEN_INVALID', 'Invalid refresh token');
    const token = `mock-${prev.role}-${Date.now()}`;
    sessions.set(token, prev);
    refreshTokens.set(`refresh-${token}`, prev);
    return ok(res, { accessToken: token, refreshToken: `refresh-${token}`, expiresIn: 7200 });
  }
  if (path === '/auth/logout') return ok(res, {});
  if (path === '/auth/me') return ok(res, user);

  if (path === '/me/preferences' && method === 'GET') return ok(res, prefs);
  if (path === '/me/preferences' && method === 'PUT') { Object.assign(prefs, body); return ok(res, prefs); }
  if (path === '/me/addresses' && method === 'GET') return ok(res, addresses);
  if (path === '/me/addresses' && method === 'POST') {
    const a = { id: addresses.length + 1, address: body.address, lastUsedAt: nowIso() };
    addresses.push(a);
    return ok(res, a, 201);
  }

  if (path === '/menu/filters') return ok(res, {
    categories: ['Chinese', 'Western', 'Japanese', 'Light Meal', 'Korean', 'Southeast Asian'],
    spiceLevels: ['None', 'Mild', 'Medium', 'Hot'],
    allergens: ['Peanuts', 'Dairy', 'Egg', 'Gluten', 'Soy', 'Fish', 'Shellfish'],
    dates: [{ date: today(), published: true }, { date: '2026-11-15', published: true }, { date: '2026-11-16', published: true }],
  });

  if (path === '/menu' && method === 'GET') {
    let items = DISHES.map(menuItem);
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    if (search) items = items.filter((i) => i.name.toLowerCase().includes(search) || i.description.toLowerCase().includes(search));
    const cats = (url.searchParams.get('category') ?? '').split(',').filter(Boolean);
    if (cats.length) items = items.filter((i) => cats.includes(i.category));
    if (url.searchParams.get('sort') === 'for-you') items = [...items].sort((a, b) => Number(b.forYou) - Number(a.forYou));
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
    const size = Math.min(100, Number(url.searchParams.get('size') ?? 20));
    return ok(res, { items: items.slice((page - 1) * size, page * size), page, size, total: items.length });
  }
  if (path === '/menu/stream') {
    sseHead(res);
    sseEvent(res, 'snapshot', DISHES.map((d) => ({ dishId: d.dishId, available: stock.get(d.dishId) })));
    const t1 = setInterval(() => {
      const id = 1 + Math.floor(Math.random() * 4);
      const next = Math.max(0, stock.get(id) - 1);
      stock.set(id, next);
      sseEvent(res, 'stock', { dishId: id, available: next });
    }, 12000);
    const hb = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(t1); clearInterval(hb); });
    return;
  }
  const dishMatch = /^\/menu\/(\d+)$/.exec(path);
  if (dishMatch) {
    const d = DISHES.find((x) => x.dishId === Number(dishMatch[1]));
    if (!d) return fail(res, 404, 'DISH_NOT_FOUND', 'Dish not found');
    return ok(res, fullDish(d));
  }

  if (path === '/orders/preview' && method === 'POST') return ok(res, previewData(body));
  if (path === '/orders' && method === 'POST') {
    const key = req.headers['idempotency-key'];
    if (!key) return fail(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key required');
    if (idem.has(key)) return ok(res, idem.get(key), 201);
    const p = computeItems(body.items);
    if (p.itemCount > 5) return fail(res, 400, 'ORDER_LIMIT_EXCEEDED', 'Order limit exceeded');
    const dup = orders.find((o) => ['Pending', 'Confirmed'].includes(o.status) && o.deliveryDate === body.deliveryDate && o.mealType === body.mealType);
    if (dup) return fail(res, 409, 'ORDER_DUPLICATE', 'An active order already exists for this meal', { existingOrderId: dup.orderId, existingOrderNo: dup.orderNo });
    for (const line of p.lines) {
      if (stock.get(line.dishId) < line.qty) return fail(res, 409, 'STOCK_INSUFFICIENT', 'Some dishes are sold out or insufficient', { details: [{ dishId: line.dishId, requested: line.qty, available: stock.get(line.dishId) }] });
    }
    for (const line of p.lines) stock.set(line.dishId, stock.get(line.dishId) - line.qty);
    const o = makeOrder(body, user);
    const created = { orderId: o.orderId, orderNo: o.orderNo, status: o.status, deliveryDate: o.deliveryDate, mealType: o.mealType, address: o.address, totalCents: o.totalCents, itemCount: o.itemCount, autoSwitched: false, estimatedDelivery: o.estimatedDelivery };
    idem.set(key, created);
    return ok(res, created, 201);
  }
  if (path === '/orders' && method === 'GET') {
    const status = url.searchParams.get('status');
    let list = orders.filter((o) => !status || o.status === status);
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
    const size = Number(url.searchParams.get('size') ?? 20);
    return ok(res, { items: list.slice((page - 1) * size, page * size), page, size, total: list.length });
  }
  const orderMatch = /^\/orders\/(\d+)$/.exec(path);
  if (orderMatch && method === 'GET') {
    const o = orders.find((x) => x.orderId === Number(orderMatch[1]));
    if (!o) return fail(res, 404, 'ORDER_NOT_FOUND', 'Order not found');
    return ok(res, o);
  }
  const cancelMatch = /^\/orders\/(\d+)\/cancel$/.exec(path);
  if (cancelMatch && method === 'POST') {
    const o = orders.find((x) => x.orderId === Number(cancelMatch[1]));
    if (!o) return fail(res, 404, 'ORDER_NOT_FOUND', 'Order not found');
    if (o.status !== 'Pending') return fail(res, 409, 'ORDER_STATE_INVALID', 'Order cannot be cancelled');
    o.status = 'Cancelled'; o.cancelledAt = nowIso(); o.cancelReason = body.reason ?? null;
    return ok(res, { orderId: o.orderId, status: o.status, cancelledAt: o.cancelledAt });
  }

  // ---- admin ----
  if (path.startsWith('/admin')) {
    if (user.role !== 'ADMIN') return fail(res, 403, 'FORBIDDEN', 'Forbidden');
  }
  if (path === '/admin/dashboard') {
    const active = orders.filter((o) => o.status !== 'Cancelled');
    const revenue = active.filter((o) => o.status !== 'Cancelled').reduce((s, o) => s + o.totalCents, 0);
    return ok(res, {
      today: { orders: active.length, revenueCents: revenue, completed: orders.filter((o) => o.status === 'Completed').length, pending: orders.filter((o) => o.status === 'Pending').length, cancelled: orders.filter((o) => o.status === 'Cancelled').length },
      topDishes: DISHES.slice(0, 5).map((d, i) => ({ dishId: d.dishId, name: d.name, soldQty: 12 - i })),
      mealSplit: { lunch: Math.max(1, active.length), dinner: 3 },
      trend: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ date: `2026-11-0${8 + i}`, orders: 4 + i, revenueCents: 12000 + i * 2600 })),
      lowStock: DISHES.filter((d) => stock.get(d.dishId) <= 3).map((d) => ({ dishId: d.dishId, name: d.name, available: stock.get(d.dishId) })),
    });
  }
  if (path === '/admin/dishes' && method === 'GET') {
    let list = DISHES.map((d) => ({ ...fullDish(d), status: 'ON_SHELF' }));
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    if (search) list = list.filter((d) => d.name.toLowerCase().includes(search));
    if (url.searchParams.get('category')) list = list.filter((d) => d.category === url.searchParams.get('category'));
    const page = Number(url.searchParams.get('page') ?? 1);
    const size = Number(url.searchParams.get('size') ?? 20);
    return ok(res, { items: list.slice((page - 1) * size, page * size), page, size, total: list.length });
  }
  if (path === '/admin/dishes' && method === 'POST') return ok(res, { dishId: 50 }, 201);
  if (/^\/admin\/dishes\/\d+$/.test(path) && method === 'PUT') return ok(res, fullDish(DISHES[0]));
  if (/^\/admin\/dishes\/\d+\/status$/.test(path) && method === 'PATCH') return ok(res, { dishId: 1, status: body.status });
  if (/^\/admin\/dishes\/\d+\/image$/.test(path)) return ok(res, { imageUrl: image(1) });
  if (path === '/admin/daily-menu' && method === 'GET') {
    return ok(res, DISHES.map((d) => {
      const st = states.get(d.dishId);
      return { dishId: d.dishId, dishName: d.name, totalQty: st.totalQty, reservedQty: st.reservedQty, soldQty: st.soldQty, available: stock.get(d.dishId), lowStock: stock.get(d.dishId) <= 3, inventoryMode: d.dishId % 3 === 0 ? 'REDIS_PREALLOC' : 'DB_ATOMIC', published: st.published };
    }));
  }
  if (path === '/admin/daily-menu' && method === 'PUT') return ok(res, { saved: true });
  if (/^\/admin\/daily-menu\/[^/]+\/\d+\/stock$/.test(path) && method === 'PUT') return ok(res, { dishId: 1, totalQty: body.totalQty, available: body.totalQty });
  if (path === '/admin/inventory/reconcile') return ok(res, { date: url.searchParams.get('date') ?? today(), checked: DISHES.length, drift: [{ dishId: 5, bookAvailable: stock.get(5), ledgerDerived: stock.get(5) - 1 }] });
  if (path === '/admin/inventory/adjust') return ok(res, { dishId: body.dishId, serveDate: body.serveDate, available: 10 });
  if (path === '/admin/orders' && method === 'GET') {
    const status = url.searchParams.get('status');
    const list = orders.filter((o) => !status || o.status === status).map((o) => ({ ...o, address: '***' }));
    const page = Number(url.searchParams.get('page') ?? 1);
    const size = Number(url.searchParams.get('size') ?? 20);
    return ok(res, { items: list.slice((page - 1) * size, page * size), page, size, total: list.length });
  }
  if (/^\/admin\/orders\/\d+\/status$/.test(path) && method === 'PATCH') {
    const id = Number(path.split('/')[3]);
    const o = orders.find((x) => x.orderId === id);
    if (!o) return fail(res, 404, 'ORDER_NOT_FOUND', 'Order not found');
    o.status = body.toStatus;
    return ok(res, o);
  }
  if (path === '/admin/audit-logs') return ok(res, { items: [
    { id: 1, createdAt: nowIso(), actorEmail: 'admin@webox.com', action: 'DISH_UPDATE', objectType: 'DISH', objectId: 3, reason: 'Price correction', before: { priceCents: 4000 }, after: { priceCents: 3800 }, ip: '10.0.0.8' },
    { id: 2, createdAt: nowIso(), actorEmail: 'admin@webox.com', action: 'STOCK_ADJUST', objectType: 'DAILY_STOCK', objectId: 5, reason: 'Spoilage', before: { available: 4 }, after: { available: 1 }, ip: '10.0.0.8' },
  ], page: 1, size: 20, total: 2 });
  if (path === '/admin/ai-rules' && method === 'GET') return ok(res, { configKey: 'recommendation', version: 3, config: { weightCategory: 0.5, weightSpice: 0.3, maxCandidates: 6 }, updatedAt: nowIso() });
  if (path === '/admin/ai-rules' && method === 'PUT') return ok(res, { configKey: body.configKey, version: 4, config: body.config, updatedAt: nowIso() });

  if (path === '/ai/recommend' && method === 'POST') {
    sseHead(res);
    const picks = DISHES.filter((d) => stock.get(d.dishId) > 0).slice(0, 3);
    sseEvent(res, 'meta', { fallback: true, model: 'rule-based', sessionId: 'mock-session' });
    picks.forEach((d, i) => {
      sseEvent(res, 'dish', { dishId: d.dishId, name: d.name, priceCents: d.priceCents, priceDisplay: `¥${(d.priceCents / 100).toFixed(2)}`, category: d.category, available: stock.get(d.dishId), imageUrl: d.imageUrl });
      sseEvent(res, 'reason', { dishId: d.dishId, text: ['Fits your preference for Japanese food.', 'High protein and light.', 'Matches your spice preference.'][i] ?? 'Recommended for you.' });
    });
    sseEvent(res, 'done', { dishIds: picks.map((d) => d.dishId) });
    res.end();
    return;
  }

  return fail(res, 404, 'NOT_FOUND', `No mock route: ${method} ${path}`);
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock api on http://127.0.0.1:${PORT}${P}`));
