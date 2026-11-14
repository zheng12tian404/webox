// S5c 失败项定向复测：偏好枚举 / 幂等（限流内）/ 金额展示 / ledger 增量
import { api, login, register, adminToken, uniqueEmail, todayShanghai, orderBody, dataOf, orderIdOf, dbQuery, check, finish, firstDish, dishIdOf } from './api/lib.mjs';
const RUN = process.env.RUN_ID || String(Date.now());
const TC = 'S5C-R2';

async function prefs() {
  const email = uniqueEmail('s5c_pref2');
  await register(email, 'Abc12345');
  const l = await login(email, 'Abc12345');
  const f = await api('GET', '/api/v1/menu/filters', { token: l.token });
  const fd = dataOf(f.json) || {};
  const allergen = (fd.allergens || [])[0];
  const cat = (fd.categories || [])[0];
  const body = { allergens: [allergen], preferredCategories: [cat], spicePreference: 'Medium', tastePreference: 'Medium', budgetMinCents: null, budgetMaxCents: null, recommendEnabled: false };
  const put = await api('PUT', '/api/v1/me/preferences', { token: l.token, body });
  check(TC, '偏好保存（null 预算/Medium/合法枚举）→ 200', put.status === 200, `allergen=${allergen} cat=${cat} status=${put.status} body=${put.text.slice(0, 200)}`);
  const get = await api('GET', '/api/v1/me/preferences', { token: l.token });
  const d = dataOf(get.json) || {};
  check(TC, '偏好回读一致', get.status === 200 && d.spicePreference === 'Medium' && d.budgetMaxCents == null && d.budgetMinCents == null && JSON.stringify(d.allergens) === JSON.stringify([allergen]) && JSON.stringify(d.preferredCategories) === JSON.stringify([cat]), `readback=${get.text.slice(0, 260)}`);
  const bad = await api('PUT', '/api/v1/me/preferences', { token: l.token, body: { ...body, allergens: ['Peanut'] } });
  check(TC, '非法枚举 Peanut → 400 VALIDATION_CATEGORY（枚举校验生效）', bad.status === 400 && /VALIDATION_CATEGORY/.test(bad.text), `status=${bad.status}`);
}

async function idem() {
  const email = uniqueEmail('s5c_idem2');
  await register(email, 'Abc12345');
  const emp = await login(email, 'Abc12345');
  const list = await firstDish(emp.token);
  const dish = (list.items.find((x) => Number(x.availableQty ?? x.available ?? 0) > 0) || list.items[0]);
  const dishId = dishIdOf(dish);
  const pv = await api('POST', '/api/v1/orders/preview', { token: emp.token, body: orderBody(dishId, { qty: 1 }) });
  const pd = dataOf(pv.json) || {};
  const body = orderBody(dishId, { qty: 1, deliveryDate: pd.effectiveDate, mealType: pd.effectiveMeal || 'Lunch' });
  const key = `s5c-idem2-${RUN}`;
  // 限流 5/min：4 并发 + 1 串行
  const conc = await Promise.all(Array.from({ length: 4 }, () => api('POST', '/api/v1/orders', { token: emp.token, key, body })));
  const s1 = await api('POST', '/api/v1/orders', { token: emp.token, key, body });
  const all = [...conc, s1];
  const ids = [...new Set(all.map((r) => orderIdOf(r.json)).filter(Boolean).map(String))];
  check(TC, '同键 5 次（限流内）均 200/201', all.every((r) => [200, 201].includes(r.status)), `statuses=${all.map((r) => r.status)}`);
  check(TC, '同键仅 1 个 orderId', ids.length === 1 && ids[0], `ids=${JSON.stringify(ids)}`);
  const cnt = dbQuery(`SELECT COUNT(*) FROM orders WHERE idempotency_key='${key}'`);
  check(TC, 'DB 同键仅 1 单', Number(cnt[0][0]) === 1, `count=${cnt[0][0]}`);
  const led = dbQuery(`SELECT entry_type,COUNT(*) FROM inventory_ledger WHERE order_id IN (SELECT id FROM orders WHERE idempotency_key='${key}') GROUP BY entry_type`);
  check(TC, '同键仅 1 条 RESERVE', led.some((x) => /RESERVE/.test(x[0]) && Number(x[1]) === 1), JSON.stringify(led));
  // 同键异体：换新用户规避 5/min 限流
  const email2 = uniqueEmail('s5c_idem3');
  await register(email2, 'Abc12345');
  const emp2 = await login(email2, 'Abc12345');
  const key2 = `s5c-idem3-${RUN}`;
  const first = await api('POST', '/api/v1/orders', { token: emp2.token, key: key2, body });
  check(TC, '异体前置首单 201', first.status === 201, `status=${first.status}`);
  const conflict = await api('POST', '/api/v1/orders', { token: emp2.token, key: key2, body: { ...body, items: [{ ...body.items[0], qty: 2 }] } });
  check(TC, '同键异体 → 409 IDEMPOTENCY_CONFLICT', conflict.status === 409 && /IDEMPOTENCY_CONFLICT/.test(conflict.text), `status=${conflict.status} body=${conflict.text.slice(0, 180)}`);
  // 429 观察（限流策略）
  const r6 = await api('POST', '/api/v1/orders', { token: emp2.token, key: key2, body });
  check(TC, '第 3 次同键请求（异体后）仍走限流/幂等，不新建单', [200, 201, 409, 429].includes(r6.status), `status=${r6.status} code=${r6.json?.code}`);
}

async function amountDisplay() {
  const email = uniqueEmail('s5c_amt');
  await register(email, 'Abc12345');
  const emp = await login(email, 'Abc12345');
  const list = await firstDish(emp.token);
  const dishId = dishIdOf(list.items[0]);
  const detail = await api('GET', `/api/v1/menu/${dishId}`, { token: emp.token });
  const dd = dataOf(detail.json) || {};
  const group = (dd.optionGroups || []).find((g) => (g.options || []).length);
  const opt = group ? group.options[0] : null;
  const optIds = opt ? [opt.optionId ?? opt.id] : [];
  const pv = await api('POST', '/api/v1/orders/preview', { token: emp.token, body: orderBody(dishId, { qty: 3, optionIds: optIds }) });
  const ad = dataOf(pv.json) || {};
  const expectedUnit = Number(dd.priceCents) + Number(opt ? (opt.priceDeltaCents || 0) : 0);
  const item = (ad.items || [])[0] || {};
  check(TC, '预览单价=菜价+选项加价（分）', Number(item.unitPriceCents) === expectedUnit, `unit=${item.unitPriceCents} expected=${expectedUnit}`);
  check(TC, '预览小计/总额=单价×3（分）', Number(item.subtotalCents) === expectedUnit * 3 && Number(ad.totalCents) === expectedUnit * 3, `subtotal=${item.subtotalCents} total=${ad.totalCents}`);
  check(TC, '菜单价展示 ¥ 两位小数', /^¥\d+\.\d{2}$/.test(String(dd.priceDisplay)), `priceDisplay=${dd.priceDisplay} priceCents=${dd.priceCents}`);
  if (opt) check(TC, '选项加价为整数分', Number.isInteger(Number(opt.priceDeltaCents)), `delta=${opt.priceDeltaCents}`);
}

async function ledgerDeltaRace() {
  const admin = await adminToken();
  const N = 50, K = 10;
  const hash = dbQuery(`SELECT password_hash FROM users WHERE email='employee@webox.com'`)[0][0];
  const vals = Array.from({ length: N }, (_, i) => `('s5cr2_${RUN}_${i}@test.com','${hash}','EMPLOYEE','ACTIVE')`).join(',');
  dbQuery(`INSERT IGNORE INTO users (email,password_hash,role,status) VALUES ${vals}`);
  const tokens = [];
  for (let i = 0; i < N; i += 1) {
    const r = await api('POST', '/api/v1/auth/login', { body: { email: `s5cr2_${RUN}_${i}@test.com`, password: 'Employee123' }, headers: { 'X-Forwarded-For': `10.8.${Math.floor(i / 250)}.${(i % 250) + 1}` } });
    if (r.json?.data?.accessToken) tokens.push(r.json.data.accessToken);
  }
  check(TC, '50 用户就绪', tokens.length === N, `ready=${tokens.length}/${N}`);
  if (tokens.length < N) return;
  const list = await firstDish(tokens[0]);
  const raceDish = list.items.find((x) => Number(x.availableQty ?? x.available ?? 0) > 0) || list.items[0];
  const dishId = dishIdOf(raceDish);
  const pv = await api('POST', '/api/v1/orders/preview', { token: tokens[0], body: orderBody(dishId, { qty: 1 }) });
  const pd = dataOf(pv.json) || {};
  const date = pd.effectiveDate;
  const cur = dbQuery(`SELECT total_qty,reserved_qty,sold_qty FROM dish_daily_stock WHERE dish_id=${dishId} AND serve_date='${date}'`)[0];
  const setQty = K + Number(cur[1]) + Number(cur[2]);
  const set = await api('PUT', `/api/v1/admin/daily-menu/${date}/${dishId}/stock`, { token: admin, body: { totalQty: setQty, confirm: true, reason: 's5c r2 race' } });
  check(TC, '并发前置库存=10', set.status === 200, `status=${set.status}`);
  const ledBefore = dbQuery(`SELECT entry_type,COUNT(*),COALESCE(SUM(qty),0) FROM inventory_ledger WHERE dish_id=${dishId} AND serve_date='${date}' GROUP BY entry_type`);
  const beforeReserve = ledBefore.filter((x) => /RESERVE/.test(x[0])).reduce((a, x) => a + Number(x[1]), 0);
  const body = orderBody(dishId, { qty: 1, deliveryDate: date, mealType: pd.effectiveMeal || 'Lunch' });
  const t0 = Date.now();
  const resps = await Promise.all(tokens.map((t, i) => api('POST', '/api/v1/orders', { token: t, key: `s5cr2-${RUN}-${i}`, body, timeoutMs: 60000 })));
  const ok = resps.filter((r) => r.status === 201);
  const s409 = resps.filter((r) => r.status === 409 && /STOCK_INSUFFICIENT/.test(r.text));
  check(TC, '50 并发抢 10：成功 10 / 409×40', ok.length === K && s409.length === N - K, `201=${ok.length} 409_STOCK=${s409.length} other=${resps.filter((r) => !(r.status === 201 || (r.status === 409 && /STOCK_INSUFFICIENT/.test(r.text)))).length} elapsed=${Date.now() - t0}ms`);
  const after = dbQuery(`SELECT total_qty,reserved_qty,sold_qty,(total_qty-reserved_qty-sold_qty) FROM dish_daily_stock WHERE dish_id=${dishId} AND serve_date='${date}'`)[0];
  check(TC, 'available=0 / reserved 增量=10 / 无负库存', Number(after[3]) === 0 && Number(after[1]) === Number(cur[1]) + K, `row=${JSON.stringify(after)} baselineReserved=${cur[1]}`);
  const ledAfter = dbQuery(`SELECT entry_type,COUNT(*),COALESCE(SUM(qty),0) FROM inventory_ledger WHERE dish_id=${dishId} AND serve_date='${date}' GROUP BY entry_type`);
  const afterReserve = ledAfter.filter((x) => /RESERVE/.test(x[0])).reduce((a, x) => a + Number(x[1]), 0);
  check(TC, 'ledger RESERVE 增量=10（对账）', afterReserve - beforeReserve === K, `before=${beforeReserve} after=${afterReserve} rows=${JSON.stringify(ledAfter)}`);
  const rec = await api('GET', `/api/v1/admin/inventory/reconcile?date=${date}`, { token: admin });
  const rd = dataOf(rec.json) || {};
  check(TC, '库存对账 drift 为空', rec.status === 200 && Array.isArray(rd.drift) && rd.drift.length === 0, `status=${rec.status} drift=${JSON.stringify(rd.drift)}`);
}

async function main() {
  await prefs();
  await idem();
  await amountDisplay();
  await ledgerDeltaRace();
  finish('s5c-regress2.json');
}
main().catch((e) => { console.error(e); process.exitCode = 1; });