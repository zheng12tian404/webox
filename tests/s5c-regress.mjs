// Stage 5c P0/P1 回归：confirm / refresh / preferences / 幂等 / 取消 / 金额 / 权限 / 注入
import {
  api, login, register, adminToken, employeeToken, uniqueEmail, todayShanghai,
  orderBody, dataOf, orderIdOf, dbQuery, check, skip, finish, firstDish, dishIdOf,
} from './api/lib.mjs';

const RUN = process.env.RUN_ID || String(Date.now());
const TC = 'S5C';

async function adminGet(path) { return api('GET', path, { token: await adminToken() }); }

async function confirmRegression() {
  const admin = await adminToken();
  if (!admin) { check(TC, '管理员登录', false); return; }
  const dishes = await api('GET', '/api/v1/admin/dishes?page=1&size=5', { token: admin });
  const d = (dataOf(dishes.json) || {}).items?.[0] || (dataOf(dishes.json) || [])[0];
  if (!d) { check(TC, '菜品列表', false, dishes.text.slice(0, 200)); return; }
  const id = d.dishId ?? d.id;
  const before = dbQuery(`SELECT name,price_cents,status FROM dishes WHERE id=${id}`);
  const auditBefore = Number(dbQuery(`SELECT COUNT(*) FROM audit_log`)[0][0]);
  const full = {
    name: d.name, description: d.description, priceCents: d.priceCents ?? d.price_cents,
    category: d.category, protein: d.protein, allergens: d.allergens || [],
    spiceLevel: d.spiceLevel ?? d.spice_level, imageUrl: d.imageUrl ?? d.image_url,
  };
  // 1) 改价 confirm=false
  let r = await api('PUT', `/api/v1/admin/dishes/${id}`, { token: admin, body: { ...full, priceCents: full.priceCents + 100, confirm: false, reason: 's5c negative' } });
  check(TC, '改价 confirm=false → 400 VALIDATION_CONFIRM_REQUIRED', r.status === 400 && /VALIDATION_CONFIRM_REQUIRED/.test(r.text), `status=${r.status} body=${r.text.slice(0, 160)}`);
  const mid = dbQuery(`SELECT name,price_cents,status FROM dishes WHERE id=${id}`);
  check(TC, '改价 confirm=false 数据不变', JSON.stringify(mid) === JSON.stringify(before), `before=${JSON.stringify(before)} after=${JSON.stringify(mid)}`);
  // 2) 上下架 confirm=false
  r = await api('PATCH', `/api/v1/admin/dishes/${id}/status`, { token: admin, body: { status: 'OFF_SHELF', confirm: false, reason: 's5c negative' } });
  check(TC, '上下架 confirm=false → 400', r.status === 400 && /VALIDATION_CONFIRM_REQUIRED/.test(r.text), `status=${r.status} body=${r.text.slice(0, 160)}`);
  // 3) 每日菜单 confirm=false
  const dm = await adminGet('/api/v1/admin/daily-menu');
  const dmItem = (dataOf(dm.json) || [])[0];
  const serveDate = todayShanghai();
  if (dmItem) {
    r = await api('PUT', '/api/v1/admin/daily-menu', { token: admin, body: { serveDate: dmItem.serveDate || serveDate, items: [{ dishId: dmItem.dishId, published: true, totalQty: 30 }], confirm: false, reason: 's5c negative' } });
    check(TC, '每日菜单 confirm=false → 400', r.status === 400 && /VALIDATION_CONFIRM_REQUIRED/.test(r.text), `status=${r.status} body=${r.text.slice(0, 160)}`);
    const st = dbQuery(`SELECT total_qty FROM dish_daily_stock WHERE dish_id=${dmItem.dishId} AND serve_date='${dmItem.serveDate || serveDate}'`);
    check(TC, '每日菜单 confirm=false 库存不变', st && Number(st[0][0]) === Number(dmItem.totalQty), `before=${dmItem.totalQty} after=${JSON.stringify(st)}`);
    // 4) 改库存 confirm=false
    r = await api('PUT', `/api/v1/admin/daily-menu/${dmItem.serveDate || serveDate}/${dmItem.dishId}/stock`, { token: admin, body: { totalQty: Number(dmItem.totalQty) + 5, confirm: false, reason: 's5c negative' } });
    check(TC, '改库存 confirm=false → 400', r.status === 400 && /VALIDATION_CONFIRM_REQUIRED/.test(r.text), `status=${r.status} body=${r.text.slice(0, 160)}`);
  }
  const auditAfterNeg = Number(dbQuery(`SELECT COUNT(*) FROM audit_log`)[0][0]);
  check(TC, 'confirm=false 无审计新增', auditAfterNeg === auditBefore, `before=${auditBefore} after=${auditAfterNeg}`);
  // 5) confirm=true 正路径 + 审计
  r = await api('PUT', `/api/v1/admin/dishes/${id}`, { token: admin, body: { ...full, priceCents: full.priceCents + 100, confirm: true, reason: 's5c positive regress' } });
  check(TC, '改价 confirm=true → 200', r.status === 200, `status=${r.status} body=${r.text.slice(0, 160)}`);
  const auditAfterPos = Number(dbQuery(`SELECT COUNT(*) FROM audit_log`)[0][0]);
  check(TC, '改价 confirm=true 写审计', auditAfterPos > auditAfterNeg, `audit ${auditAfterNeg}→${auditAfterPos}`);
  const priceNow = dbQuery(`SELECT price_cents FROM dishes WHERE id=${id}`);
  check(TC, '改价 confirm=true 落库', Number(priceNow[0][0]) === full.priceCents + 100, `price=${JSON.stringify(priceNow)}`);
  // 还原价格
  await api('PUT', `/api/v1/admin/dishes/${id}`, { token: admin, body: { ...full, priceCents: full.priceCents, confirm: true, reason: 's5c restore' } });
  if (dmItem) {
    r = await api('PUT', `/api/v1/admin/daily-menu/${dmItem.serveDate || serveDate}/${dmItem.dishId}/stock`, { token: admin, body: { totalQty: Number(dmItem.totalQty), confirm: true, reason: 's5c positive stock' } });
    check(TC, '改库存 confirm=true → 200', r.status === 200, `status=${r.status}`);
  }
  r = await api('PATCH', `/api/v1/admin/dishes/${id}/status`, { token: admin, body: { status: 'ON_SHELF', confirm: true, reason: 's5c positive status' } });
  check(TC, '上下架 confirm=true → 200', r.status === 200, `status=${r.status} body=${r.text.slice(0, 160)}`);
}

async function refreshRegression() {
  const email = uniqueEmail('s5c_refresh');
  await register(email, 'Abc12345');
  const l = await login(email, 'Abc12345');
  check(TC, 'refresh 前置登录', Boolean(l.token && dataOf(l.json)?.refreshToken), `status=${l.status}`);
  const rt = dataOf(l.json)?.refreshToken;
  if (!rt) return;
  const r1 = await api('POST', '/api/v1/auth/refresh', { body: { refreshToken: rt } });
  const d1 = dataOf(r1.json) || {};
  check(TC, 'refresh → 200 + 新 access', r1.status === 200 && Boolean(d1.accessToken), `status=${r1.status}`);
  const me = await api('GET', '/api/v1/auth/me', { token: d1.accessToken });
  check(TC, '新 access /me → 200', me.status === 200, `status=${me.status}`);
  const r2 = await api('POST', '/api/v1/auth/refresh', { body: { refreshToken: rt } });
  check(TC, '旧 refresh 复用 → 401', r2.status === 401 && /AUTH_TOKEN_INVALID/.test(r2.text), `status=${r2.status} body=${r2.text.slice(0, 160)}`);
}

async function preferencesRegression() {
  const email = uniqueEmail('s5c_pref');
  await register(email, 'Abc12345');
  const l = await login(email, 'Abc12345');
  const body = { allergens: ['Peanut'], preferredCategories: ['Asian'], spicePreference: 'Medium', tastePreference: 'Savory', budgetMinCents: null, budgetMaxCents: null, recommendEnabled: false };
  const put = await api('PUT', '/api/v1/me/preferences', { token: l.token, body });
  check(TC, '偏好保存（null 预算/Medium）→ 200', put.status === 200, `status=${put.status} body=${put.text.slice(0, 200)}`);
  const get = await api('GET', '/api/v1/me/preferences', { token: l.token });
  const d = dataOf(get.json) || {};
  check(TC, '偏好回读一致', get.status === 200 && d.spicePreference === 'Medium' && d.budgetMaxCents == null && JSON.stringify(d.allergens) === JSON.stringify(['Peanut']), `readback=${get.text.slice(0, 240)}`);
}

async function coreTransaction() {
  const admin = await adminToken();
  // 幂等
  const email = uniqueEmail('s5c_idem');
  await register(email, 'Abc12345');
  const emp = await login(email, 'Abc12345');
  const list = await firstDish(emp.token);
  const dish = list.items[0];
  if (!dish) { check(TC, '幂等前置菜单', false); return; }
  const dishId = dishIdOf(dish);
  const pv = await api('POST', '/api/v1/orders/preview', { token: emp.token, body: orderBody(dishId, { qty: 2 }) });
  const pd = dataOf(pv.json) || {};
  const body = orderBody(dishId, { qty: 2, deliveryDate: pd.effectiveDate, mealType: pd.effectiveMeal || 'Lunch' });
  const key = `s5c-idem-${RUN}`;
  const conc = await Promise.all(Array.from({ length: 5 }, () => api('POST', '/api/v1/orders', { token: emp.token, key, body })));
  const s1 = await api('POST', '/api/v1/orders', { token: emp.token, key, body });
  const all = [...conc, s1];
  const ids = [...new Set(all.map((r) => orderIdOf(r.json)).filter(Boolean).map(String))];
  check(TC, '同键 6 次提交均 200/201', all.every((r) => [200, 201].includes(r.status)), `statuses=${all.map((r) => r.status)}`);
  check(TC, '同键仅 1 个 orderId', ids.length === 1, `ids=${JSON.stringify(ids)}`);
  const dbCnt = dbQuery(`SELECT COUNT(*) FROM orders WHERE idempotency_key='${key}'`);
  check(TC, 'DB 同键仅 1 单', Number(dbCnt[0][0]) === 1, `count=${dbCnt[0][0]}`);
  const conflict = await api('POST', '/api/v1/orders', { token: emp.token, key, body: { ...body, items: [{ ...body.items[0], qty: 3 }] } });
  check(TC, '同键异体 → 409 IDEMPOTENCY_CONFLICT', conflict.status === 409 && /IDEMPOTENCY_CONFLICT/.test(conflict.text), `status=${conflict.status}`);
  const ledger = dbQuery(`SELECT entry_type,COUNT(*) FROM inventory_ledger WHERE order_id IN (SELECT id FROM orders WHERE idempotency_key='${key}') GROUP BY entry_type`);
  check(TC, '幂等库存只扣 1 次', ledger.some((x) => /RESERVE/i.test(x[0]) && Number(x[1]) === 1), JSON.stringify(ledger));

  // 取消两次只回补一次
  const orderId = ids[0];
  const stockBefore = dbQuery(`SELECT (total_qty-reserved_qty-sold_qty) FROM dish_daily_stock WHERE dish_id=${dishId} AND serve_date='${pd.effectiveDate}'`);
  const c1 = await api('POST', `/api/v1/orders/${orderId}/cancel`, { token: emp.token, body: { reason: 's5c cancel 1' } });
  check(TC, '取消 Pending → 200', c1.status === 200 && /Cancelled/.test(c1.text), `status=${c1.status}`);
  const c2 = await api('POST', `/api/v1/orders/${orderId}/cancel`, { token: emp.token, body: { reason: 's5c cancel 2' } });
  check(TC, '二次取消 → 409', c2.status === 409 && /ORDER_STATE_INVALID/.test(c2.text), `status=${c2.status}`);
  const rel = dbQuery(`SELECT entry_type,COUNT(*),COALESCE(SUM(qty),0) FROM inventory_ledger WHERE order_id=${orderId} AND entry_type LIKE '%RELEASE%' GROUP BY entry_type`);
  check(TC, '取消只回补 1 次（1 条 RELEASE）', rel.length === 1 && Number(rel[0][1]) === 1, JSON.stringify(rel));
  const stockAfter = dbQuery(`SELECT (total_qty-reserved_qty-sold_qty) FROM dish_daily_stock WHERE dish_id=${dishId} AND serve_date='${pd.effectiveDate}'`);
  check(TC, '取消后库存恢复（+2）', Number(stockAfter[0][0]) === Number(stockBefore[0][0]) + 2, `before=${JSON.stringify(stockBefore)} after=${JSON.stringify(stockAfter)}`);

  // 金额精度：多份 + 加价组合
  const detail = await api('GET', `/api/v1/menu/${dishId}`, { token: emp.token });
  const dd = dataOf(detail.json) || {};
  const group = (dd.optionGroups || []).find((g) => (g.options || []).length);
  const opt = group ? group.options[0] : null;
  const optIds = opt ? [opt.optionId ?? opt.id] : [];
  const amtBody = orderBody(dishId, { qty: 3, optionIds: optIds, deliveryDate: pd.effectiveDate, mealType: pd.effectiveMeal || 'Lunch' });
  const amt = await api('POST', '/api/v1/orders/preview', { token: emp.token, body: amtBody });
  const ad = dataOf(amt.json) || {};
  const expectedUnit = Number(dd.priceCents) + Number(opt ? (opt.priceDeltaCents || 0) : 0);
  const item = (ad.items || [])[0] || {};
  check(TC, '金额整数分：单价=菜价+选项加价', Number(item.unitPriceCents) === expectedUnit, `unit=${item.unitPriceCents} expected=${expectedUnit}`);
  check(TC, '金额整数分：小计=单价×3', Number(item.subtotalCents) === expectedUnit * 3, `subtotal=${item.subtotalCents} expected=${expectedUnit * 3}`);
  check(TC, '金额整数分：总额=各项小计之和', Number(ad.totalCents) === expectedUnit * 3, `total=${ad.totalCents}`);
  check(TC, '金额展示 ¥ 两位小数', /^¥\d+\.\d{2}$/.test(String(item.priceDisplay || pd.priceDisplay || '¥0.00')), `display=${item.priceDisplay}`);

  // 截单边界：当前 23:xx 午餐已过 → 自动切次日午餐；过去日期下单被拒
  const lunch = await api('POST', '/api/v1/orders/preview', { token: emp.token, body: orderBody(dishId, { qty: 1, deliveryDate: todayShanghai(), mealType: 'Lunch' }) });
  const ld = dataOf(lunch.json) || {};
  check(TC, '截单后午餐自动切次日', lunch.status === 200 && ld.effectiveMeal === 'Lunch' && ld.effectiveDate > todayShanghai() && ld.autoSwitched === true, `status=${lunch.status} effective=${ld.effectiveDate}/${ld.effectiveMeal} auto=${ld.autoSwitched}`);
  const past = await api('POST', '/api/v1/orders/preview', { token: emp.token, body: orderBody(dishId, { qty: 1, deliveryDate: '2020-01-01', mealType: 'Lunch' }) });
  check(TC, '过去日期 → 400 DATE_PAST', past.status === 400 && /DATE_PAST/.test(past.text), `status=${past.status} body=${past.text.slice(0, 160)}`);
}

async function concurrencyRace() {
  const admin = await adminToken();
  const N = 50, K = 10;
  const hash = dbQuery(`SELECT password_hash FROM users WHERE email='employee@webox.com'`)[0][0];
  const vals = Array.from({ length: N }, (_, i) => `('s5c_race_${RUN}_${i}@test.com','${hash}','EMPLOYEE','ACTIVE')`).join(',');
  const ins = dbQuery(`INSERT IGNORE INTO users (email,password_hash,role,status) VALUES ${vals}`);
  check(TC, 'SQL 直插 50 用户', ins !== null, `insert=${ins}`);
  const tokens = [];
  for (let i = 0; i < N; i += 1) {
    const r = await api('POST', '/api/v1/auth/login', { body: { email: `s5c_race_${RUN}_${i}@test.com`, password: 'Employee123' }, headers: { 'X-Forwarded-For': `10.9.${Math.floor(i / 250)}.${(i % 250) + 1}` } });
    if (r.json?.data?.accessToken) tokens.push(r.json.data.accessToken);
  }
  check(TC, '50 用户 token 就绪（绕限流）', tokens.length === N, `ready=${tokens.length}/${N}`);
  if (tokens.length < N) return;
  const list = await firstDish(tokens[0]);
  const dish = list.items[0];
  const dishId = dishIdOf(dish);
  const pv = await api('POST', '/api/v1/orders/preview', { token: tokens[0], body: orderBody(dishId, { qty: 1 }) });
  const pd = dataOf(pv.json) || {};
  const date = pd.effectiveDate;
  const set = await api('PUT', `/api/v1/admin/daily-menu/${date}/${dishId}/stock`, { token: admin, body: { totalQty: K, confirm: true, reason: 's5c race setup' } });
  check(TC, '并发前置库存=10', set.status === 200, `status=${set.status} body=${set.text.slice(0, 160)}`);
  const before = dbQuery(`SELECT total_qty,reserved_qty,sold_qty,(total_qty-reserved_qty-sold_qty) FROM dish_daily_stock WHERE dish_id=${dishId} AND serve_date='${date}'`)[0];
  const body = orderBody(dishId, { qty: 1, deliveryDate: date, mealType: pd.effectiveMeal || 'Lunch' });
  const t0 = Date.now();
  const resps = await Promise.all(tokens.map((t, i) => api('POST', '/api/v1/orders', { token: t, key: `s5c-race-${RUN}-${i}`, body, timeoutMs: 60000 })));
  const ok = resps.filter((r) => r.status === 201);
  const stock409 = resps.filter((r) => r.status === 409 && /STOCK_INSUFFICIENT/.test(r.text));
  check(TC, '50 并发抢 10：成功 10', ok.length === K, `201=${ok.length} 409_STOCK=${stock409.length} other=${resps.filter((r) => !(r.status === 201 || (r.status === 409 && /STOCK_INSUFFICIENT/.test(r.text)))).length} elapsed=${Date.now() - t0}ms`);
  check(TC, '其余 40 为 STOCK_INSUFFICIENT', ok.length + stock409.length === N, `sum=${ok.length + stock409.length}/${N}`);
  const after = dbQuery(`SELECT total_qty,reserved_qty,sold_qty,(total_qty-reserved_qty-sold_qty) FROM dish_daily_stock WHERE dish_id=${dishId} AND serve_date='${date}'`)[0];
  check(TC, 'available=0 且无负库存', Number(after[3]) === 0, `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  check(TC, 'reserved=10 守恒', Number(after[1]) === K, `reserved=${after[1]}`);
  const led = dbQuery(`SELECT entry_type,COUNT(*),COALESCE(SUM(qty),0) FROM inventory_ledger WHERE dish_id=${dishId} AND serve_date='${date}' GROUP BY entry_type`);
  check(TC, 'ledger RESERVE=10 对账', led.some((x) => /RESERVE/.test(x[0]) && Number(x[1]) === K), JSON.stringify(led));
  const rec = await api('GET', `/api/v1/admin/inventory/reconcile?date=${date}`, { token: admin });
  const rd = dataOf(rec.json) || {};
  check(TC, '库存对账 drift 为空', rec.status === 200 && Array.isArray(rd.drift) && rd.drift.length === 0, `status=${rec.status} drift=${JSON.stringify(rd.drift)}`);
}

async function authzInjection() {
  const emp = await employeeToken();
  const adm = await adminToken();
  const r403 = await api('GET', '/api/v1/admin/dishes?page=1&size=1', { token: emp });
  check(TC, '员工访问 /admin → 403', r403.status === 403, `status=${r403.status} body=${r403.text.slice(0, 120)}`);
  const me = await api('GET', '/api/v1/auth/me', { token: emp });
  const myId = dataOf(me.json)?.id;
  const other = dbQuery(`SELECT id FROM orders WHERE user_id<>${Number(myId)} LIMIT 1`);
  if (other && other[0]) {
    const cross = await api('GET', `/api/v1/orders/${other[0][0]}`, { token: emp });
    check(TC, '越权读他人订单 → 404', cross.status === 404, `order=${other[0][0]} status=${cross.status}`);
  } else skip(TC, '越权读他人订单', '测试库无他人订单');
  const inj = await api('GET', `/api/v1/menu?search=${encodeURIComponent("' OR 1=1 --")}&page=1&size=20`, { token: emp });
  const total = (dataOf(inj.json) || {}).total ?? -1;
  check(TC, '搜索注入无 500', inj.status < 500, `status=${inj.status} body=${inj.text.slice(0, 160)}`);
  check(TC, '搜索注入无全表泄露', inj.status === 400 || (inj.status === 200 && Number(total) === 0), `status=${inj.status} total=${total}`);
  const inj2 = await api('GET', `/api/v1/menu/${encodeURIComponent('1 OR 1=1')}`, { token: emp });
  check(TC, '路径注入无 500', inj2.status < 500, `status=${inj2.status}`);
}

async function main() {
  const health = await api('GET', '/api/v1/health');
  check(TC, '后端 health', health.status === 200 && /UP/.test(health.text), `status=${health.status} body=${health.text.slice(0, 160)}`);
  await confirmRegression();
  await refreshRegression();
  await preferencesRegression();
  await coreTransaction();
  await concurrencyRace();
  await authzInjection();
  finish('s5c-regress.json');
}
main().catch((e) => { console.error(e); process.exitCode = 1; });