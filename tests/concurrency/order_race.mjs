// TC-058 / AC-035：N 并发抢 K 份，断言成功数=可售数、库存不为负、ledger 一致
// 用户夹具：复制种子员工 password_hash 直插 50 个用户（规避注册限流，G1A-05）
import {
  api, login, register, adminToken, firstDish, dishIdOf, availableOf, dataOf,
  todayShanghai, orderBody, orderIdOf, dbQuery, check, skip, finish,
} from '../api/lib.mjs';

const N = Number(process.env.RACE_N || 50);
const K = Number(process.env.RACE_K || 10);
const PASSWORD = process.env.RACE_PASSWORD || 'Employee123';
const RUN = process.env.RUN_ID || String(Date.now());

function insertUsers(n) {
  const values = Array.from({ length: n }, (_, i) => `('race_${RUN}_${i}@test.com', (SELECT password_hash FROM (SELECT password_hash FROM users WHERE email='employee@webox.com') t), 'EMPLOYEE', 'ACTIVE')`).join(',');
  return dbQuery(`INSERT IGNORE INTO users (email, password_hash, role, status) VALUES ${values}`);
}

async function main() {
  const admin = await adminToken();
  if (!admin) { check('TC-058', '管理员登录', false, 'admin 登录失败'); return finish('conc-order.json'); }

  let users = [];
  const inserted = insertUsers(N);
  if (inserted !== null) {
    for (let i = 0; i < N; i += 1) {
      const r = await login(`race_${RUN}_${i}@test.com`, PASSWORD);
      if (r.token) users.push(r.token);
    }
  }
  if (users.length < N) {
    skip('TC-058', 'SQL 批量夹具', 'DB 直插不可用，回退注册接口（可能触发注册限流）');
    for (let i = users.length; i < N; i += 1) {
      const email = `race_${RUN}_${i}@test.com`;
      await register(email, 'Passw0rd1');
      const r = await login(email, 'Passw0rd1');
      if (r.token) users.push(r.token);
    }
  }
  check('TC-058', `${N} 个用户就绪`, users.length === N, `ready=${users.length}/${N}`);
  if (users.length < N) return finish('conc-order.json');

  const list = await firstDish(users[0]);
  const dish = (process.env.DISH_ID ? list.items.find((it) => String(dishIdOf(it)) === String(process.env.DISH_ID)) : null) || list.items[0];
  if (!dish) { check('TC-058', '选择目标菜品', false, '菜单为空'); return finish('conc-order.json'); }
  const dishId = dishIdOf(dish);
  // Cutoff may auto-switch the effective meal; stock must be set on the effective date.
  const preview = await api('POST', '/api/v1/orders/preview', { token: users[0], body: orderBody(dishId, { qty: 1 }) });
  const pd = dataOf(preview.json) || {};
  const date = pd.effectiveDate || todayShanghai();

  // 前置库存：优先 H3 管理端设置；失败则用当前可售
  const set = await api('PUT', `/api/v1/admin/daily-menu/${date}/${dishId}/stock`, {
    token: admin,
    body: { totalQty: K, confirm: true, reason: 'concurrency test setup' },
  });
  const stockSet = set.status === 200;
  if (!stockSet) skip('TC-058', 'H3 设置库存', `status=${set.status}；改用当前可售`);

  const before = dbQuery(`SELECT total_qty,reserved_qty,sold_qty,(total_qty-reserved_qty-sold_qty) AS available FROM dish_daily_stock WHERE dish_id=${Number(dishId)} AND serve_date='${date}'`);
  const currentAvail = before && before[0] ? Number(before[0][3]) : availableOf(dish);
  const expected = stockSet ? K : Math.min(K, Number(currentAvail ?? 0));
  console.log(`target dish=${dishId} date=${date} expectedSuccess=${expected} before=${JSON.stringify(before)}`);

  const body = orderBody(dishId, { qty: 1, deliveryDate: pd.effectiveDate || date, mealType: pd.effectiveMeal || 'Lunch' });

  const started = Date.now();
  const responses = await Promise.all(users.map((token, i) => api('POST', '/api/v1/orders', {
    token,
    key: `race-${RUN}-${i}-${Date.now()}`,
    body,
    timeoutMs: 60000,
  })));
  const elapsed = Date.now() - started;
  const ok = responses.filter((r) => r.status === 201);
  const stockFail = responses.filter((r) => r.status === 409 && /STOCK_INSUFFICIENT/.test(r.text));
  const others = responses.filter((r) => r.status !== 201 && !(r.status === 409 && /STOCK_INSUFFICIENT/.test(r.text)));

  check('TC-058', `成功数=可售数（${ok.length}/${expected}）`, ok.length === expected, `201=${ok.length} 409_STOCK=${stockFail.length} other=${others.length} elapsed=${elapsed}ms`);
  check('TC-058', '其余为 STOCK_INSUFFICIENT', ok.length + stockFail.length === N, `201+409=${ok.length + stockFail.length}/${N}`);
  check('TC-058', '库存不足响应含 dishId/requested/available', stockFail.every((r) => /dishId/.test(r.text) && /requested/.test(r.text) && /available/.test(r.text)), `sample=${stockFail[0]?.text.slice(0, 200)}`);

  const after = dbQuery(`SELECT total_qty,reserved_qty,sold_qty,(total_qty-reserved_qty-sold_qty) AS available FROM dish_daily_stock WHERE dish_id=${Number(dishId)} AND serve_date='${date}'`);
  if (after && after[0]) {
    const available = Number(after[0][3]);
    const total = Number(after[0][0]); const reserved = Number(after[0][1]); const sold = Number(after[0][2]);
    check('TC-058', 'available >= 0', available >= 0, `available=${available}`);
    check('TC-058', 'reserved+sold <= total', reserved + sold <= total, `reserved=${reserved} sold=${sold} total=${total}`);
    check('TC-058', 'available 与成功数守恒', available === Math.max(0, Number(currentAvail ?? 0) - ok.length), `after=${available} before=${currentAvail} ok=${ok.length}`);
  } else {
    skip('TC-058', 'DB 库存断言', 'mysql/表不可用');
  }

  const ledger = dbQuery(`SELECT entry_type, COUNT(*), COALESCE(SUM(qty),0) FROM inventory_ledger WHERE dish_id=${Number(dishId)} AND serve_date='${date}' GROUP BY entry_type`);
  if (ledger === null) skip('TC-058', 'ledger 对账', 'mysql 不可用');
  else check('TC-058', 'ledger RESERVE 汇总=成功数', ledger.some((r) => /RESERVE/i.test(r[0]) && Number(r[1]) === ok.length), JSON.stringify(ledger));

  // 写详细证据（含每请求状态）
  const detail = responses.map((r, i) => ({ i, status: r.status, code: r.json?.code || null }));
  console.log('per-request:', JSON.stringify(detail));
  finish('conc-order.json');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });