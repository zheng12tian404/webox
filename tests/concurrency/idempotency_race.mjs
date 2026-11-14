// TC-034 / AC-015：同幂等键 5 并发 + 2 串行只建 1 单；同键异体 409
import {
  api, register, login, uniqueEmail, firstDish, dishIdOf, dataOf,
  orderBody, orderIdOf, dbQuery, check, skip, finish,
} from '../api/lib.mjs';

const CONCURRENCY = Number(process.env.IDEM_CONCURRENCY || 5);
const RUN = process.env.RUN_ID || String(Date.now());

async function main() {
  const email = uniqueEmail('idemrace');
  await register(email, 'Abc12345');
  const emp = await login(email, 'Abc12345');
  if (!emp.token) { check('TC-034', '用户登录', false, '注册/登录失败'); return finish('conc-idem.json'); }
  const { items } = await firstDish(emp.token);
  const dish = items[0];
  if (!dish) { check('TC-034', '菜单有菜', false, '菜单为空'); return finish('conc-idem.json'); }
  const dishId = dishIdOf(dish);
  const preview = await api('POST', '/api/v1/orders/preview', { token: emp.token, body: orderBody(dishId, { qty: 1 }) });
  const pd = dataOf(preview.json) || {};
  const body = orderBody(dishId, { qty: 1, deliveryDate: pd.effectiveDate, mealType: pd.effectiveMeal || 'Lunch' });
  const key = `idem-${RUN}-K1`;

  const concurrent = await Promise.all(Array.from({ length: CONCURRENCY }, () => api('POST', '/api/v1/orders', { token: emp.token, key, body, timeoutMs: 60000 })));
  const serial1 = await api('POST', '/api/v1/orders', { token: emp.token, key, body });
  const serial2 = await api('POST', '/api/v1/orders', { token: emp.token, key, body });
  const all = [...concurrent, serial1, serial2];
  const ids = all.map((r) => orderIdOf(r.json)).filter(Boolean);
  const uniqueIds = [...new Set(ids.map(String))];

  check('TC-034', `${CONCURRENCY + 2} 次响应均成功状态`, all.every((r) => [200, 201].includes(r.status)), `statuses=${all.map((r) => r.status).join(',')}`);
  check('TC-034', '所有响应 orderId 相同', ids.length === all.length && uniqueIds.length === 1, `ids=${JSON.stringify(uniqueIds)}`);
  const cnt = dbQuery(`SELECT COUNT(*) FROM orders WHERE idempotency_key='${key}'`);
  if (cnt === null) skip('TC-034', 'DB 仅 1 单', 'mysql 不可用');
  else check('TC-034', 'DB 仅 1 单', Number(cnt[0][0]) === 1, `count=${cnt[0][0]}`);

  const conflict = await api('POST', '/api/v1/orders', {
    token: emp.token,
    key,
    body: { ...body, items: [{ ...body.items[0], qty: 2 }] },
  });
  check('TC-034', '同键异体 409 IDEMPOTENCY_CONFLICT', conflict.status === 409 && /IDEMPOTENCY_CONFLICT/.test(conflict.text), `status=${conflict.status} body=${conflict.text.slice(0, 250)}`);

  const missing = await api('POST', '/api/v1/orders', { token: emp.token, body });
  check('TC-034', '缺键 400 IDEMPOTENCY_KEY_REQUIRED', missing.status === 400 && /IDEMPOTENCY_KEY_REQUIRED/.test(missing.text), `status=${missing.status}`);

  const ledger = dbQuery(`SELECT entry_type, COUNT(*) FROM inventory_ledger WHERE order_id IN (SELECT id FROM orders WHERE idempotency_key='${key}') GROUP BY entry_type`);
  if (ledger === null) skip('TC-034', '库存只扣 1 次', 'mysql 不可用');
  else check('TC-034', '库存只扣 1 次（1 条 RESERVE）', ledger.some((r) => /RESERVE/i.test(r[0]) && Number(r[1]) === 1), JSON.stringify(ledger));

  finish('conc-idem.json');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });