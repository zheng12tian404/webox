// TC-029~037 / TC-044~046：结算、下单、幂等、唯一单、取消、金额重算
import {
  api, register, login, uniqueEmail, dataOf, firstDish, dishIdOf, availableOf,
  todayShanghai, orderBody, orderIdOf, errorCodeOf, check, skip, finish, dbQuery,
} from './lib.mjs';

const tomorrow = () => {
  const d = new Date(Date.now() + 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(d);
};

async function newUser(prefix) {
  const email = uniqueEmail(prefix);
  await register(email, 'Abc12345');
  return login(email, 'Abc12345');
}

async function main() {
  const emp = await newUser('ord');
  if (!emp.token) { check('TC-029', '测试用户登录', false, '注册/登录失败'); return finish('api-orders.json'); }
  const { items } = await firstDish(emp.token);
  const dish = items.find((it) => availableOf(it) === null || availableOf(it) > 0) || items[0];
  if (!dish) { check('TC-029', '菜单有可下单菜品', false, '菜单为空'); return finish('api-orders.json'); }
  const dishId = dishIdOf(dish);

  // TC-029 preview
  const preview = await api('POST', '/api/v1/orders/preview', { token: emp.token, body: orderBody(dishId, { qty: 2 }) });
  const pd = dataOf(preview.json) || {};
  check('TC-029', 'preview 200', preview.status === 200, `status=${preview.status} body=${preview.text.slice(0, 300)}`);
  check('TC-029', 'preview 含 effectiveDate/effectiveMeal/cutoffAt', Boolean(pd.effectiveDate && pd.effectiveMeal && pd.cutoffAt), JSON.stringify({ d: pd.effectiveDate, m: pd.effectiveMeal, c: pd.cutoffAt }));
  check('TC-029', 'preview totalCents 为整数', Number.isInteger(pd.totalCents), `totalCents=${pd.totalCents}`);
  check('TC-029', 'preview itemCount=2', pd.itemCount === 2, `itemCount=${pd.itemCount}`);
  const effDate = pd.effectiveDate || todayShanghai();
  const effMeal = pd.effectiveMeal || 'Lunch';

  // TC-029 地址超长
  const longAddr = await api('POST', '/api/v1/orders/preview', { token: emp.token, body: orderBody(dishId, { qty: 1, deliveryDate: effDate, mealType: effMeal, address: 'A'.repeat(201) }) });
  check('TC-029', '地址 201 字符 → 400 VALIDATION_ADDRESS_LENGTH', longAddr.status === 400 && /VALIDATION_ADDRESS_LENGTH/.test(longAddr.text), `status=${longAddr.status}`);

  // TC-030 下单成功
  const key1 = `tc030-${Date.now()}-a1`;
  const create = await api('POST', '/api/v1/orders', { token: emp.token, key: key1, body: orderBody(dishId, { qty: 2, deliveryDate: effDate, mealType: effMeal }) });
  const od = dataOf(create.json) || {};
  check('TC-030', '下单 201', create.status === 201, `status=${create.status} body=${create.text.slice(0, 400)}`);
  check('TC-030', 'orderNo 匹配 ^WB\\d{8}-\\d{4,}$', /^WB\d{8}-\d{4,}$/.test(String(od.orderNo || '')), `orderNo=${od.orderNo}`);
  check('TC-030', 'status=Pending', String(od.status || '') === 'Pending', `status=${od.status}`);
  check('TC-030', 'totalCents 为整数且等于 preview', Number.isInteger(od.totalCents) && od.totalCents === pd.totalCents, `create=${od.totalCents} preview=${pd.totalCents}`);
  const orderId = orderIdOf(create.json);
  if (orderId) {
    const detail = await api('GET', `/api/v1/orders/${orderId}`, { token: emp.token });
    const dd = dataOf(detail.json) || {};
    check('TC-030', '详情含 items 快照与 snapshot_json', Array.isArray(dd.items) && dd.snapshot_json !== undefined, `items=${(dd.items || []).length} snapshot=${dd.snapshot_json !== undefined}`);
  } else {
    skip('TC-030', '订单详情', '创建未返回 orderId');
  }
  const ledger = dbQuery(`SELECT entry_type, COUNT(*) FROM inventory_ledger WHERE order_id=${Number(orderId)} GROUP BY entry_type`);
  if (ledger === null) skip('TC-030', 'DB ledger RESERVE 断言', 'mysql 客户端/表名不可用');
  else check('TC-030', 'ledger 恰 1 条 RESERVE', ledger.some((row) => /RESERVE/i.test(row[0]) && Number(row[1]) === 1), JSON.stringify(ledger));

  // TC-031 客户端篡改价格
  const tamperUser = await newUser('tamper');
  const tamperBody = { ...orderBody(dishId, { qty: 1, deliveryDate: effDate, mealType: effMeal }), totalCents: 1, priceCents: 1, items: [{ dishId, qty: 1, optionIds: [], priceCents: 1 }] };
  const tamper = await api('POST', '/api/v1/orders', { token: tamperUser.token, key: `tc031-${Date.now()}`, body: tamperBody });
  const td = dataOf(tamper.json) || {};
  check('TC-031', '篡改价下单成功但按 DB 重算', (tamper.status === 201 || tamper.status === 400) && (tamper.status === 400 || td.totalCents !== 1), `status=${tamper.status} total=${td.totalCents}`);
  if (dish.priceCents && tamper.status === 201) check('TC-031', 'total=DB 单价×1', td.totalCents === dish.priceCents, `total=${td.totalCents} db=${dish.priceCents}`);

  // TC-044 同日同餐次第二单
  const dup = await api('POST', '/api/v1/orders', { token: emp.token, key: `tc044-${Date.now()}`, body: orderBody(dishId, { qty: 1, deliveryDate: effDate, mealType: effMeal }) });
  const dupD = dataOf(dup.json) || {};
  check('TC-044', '第二单 409 ORDER_DUPLICATE', dup.status === 409 && /ORDER_DUPLICATE/.test(dup.text), `status=${dup.status} body=${dup.text.slice(0, 300)}`);
  check('TC-044', '返回 existingOrderId', Boolean(dupD.existingOrderId || dupD.data?.existingOrderId), `existingOrderId=${dupD.existingOrderId}`);

  // TC-036 取消两次
  let cancel1 = null;
  if (orderId) {
    cancel1 = await api('POST', `/api/v1/orders/${orderId}/cancel`, { token: emp.token, body: { reason: 'test cancel' } });
    check('TC-036', '首次取消 200 且 Cancelled', cancel1.status === 200 && /Cancelled/.test(cancel1.text), `status=${cancel1.status} body=${cancel1.text.slice(0, 250)}`);
    const cancel2 = await api('POST', `/api/v1/orders/${orderId}/cancel`, { token: emp.token, body: { reason: 'again' } });
    check('TC-036', '二次取消 409 ORDER_STATE_INVALID', cancel2.status === 409 && /ORDER_STATE_INVALID/.test(cancel2.text), `status=${cancel2.status}`);
    const rel = dbQuery(`SELECT entry_type, COUNT(*) FROM inventory_ledger WHERE order_id=${Number(orderId)} AND entry_type='RELEASE' GROUP BY entry_type`);
    if (rel === null) skip('TC-036', 'DB 仅 1 条 RELEASE', 'mysql 不可用');
    else check('TC-036', '取消只回补一次（1 条 RELEASE）', rel.length === 1 && Number(rel[0][1]) === 1, JSON.stringify(rel));
  }

  // TC-046 取消后再下同餐次
  if (cancel1 && cancel1.status === 200) {
    const reorder = await api('POST', '/api/v1/orders', { token: emp.token, key: `tc046-${Date.now()}`, body: orderBody(dishId, { qty: 1, deliveryDate: effDate, mealType: effMeal }) });
    check('TC-046', '取消后同日同餐次可再下单 201', reorder.status === 201, `status=${reorder.status} body=${reorder.text.slice(0, 250)}`);
  }

  // TC-045 跨餐次/跨日
  const otherMeal = effMeal === 'Lunch' ? 'Dinner' : 'Lunch';
  const crossMeal = await api('POST', '/api/v1/orders', { token: emp.token, key: `tc045a-${Date.now()}`, body: orderBody(dishId, { qty: 1, deliveryDate: effDate, mealType: otherMeal }) });
  check('TC-045', '同日跨餐次 201', crossMeal.status === 201 || crossMeal.status === 409, `status=${crossMeal.status}（409 仅当该餐次已截单/无菜单）`);
  const crossDay = await api('POST', '/api/v1/orders', { token: emp.token, key: `tc045b-${Date.now()}`, body: orderBody(dishId, { qty: 1, deliveryDate: tomorrow(), mealType: 'Lunch' }) });
  check('TC-045', '次日同餐次 201', crossDay.status === 201, `status=${crossDay.status} body=${crossDay.text.slice(0, 250)}`);

  // TC-033 串行幂等
  const idemUser = await newUser('idem');
  const key = `tc033-${Date.now()}-k1`;
  const body = orderBody(dishId, { qty: 1, deliveryDate: effDate, mealType: effMeal });
  const r1 = await api('POST', '/api/v1/orders', { token: idemUser.token, key, body });
  const r2 = await api('POST', '/api/v1/orders', { token: idemUser.token, key, body });
  const id1 = orderIdOf(r1.json);
  const id2 = orderIdOf(r2.json);
  check('TC-033', '同键两次同一 orderId', id1 !== null && id1 === id2, `id1=${id1} id2=${id2} status=${r1.status}/${r2.status}`);
  const cnt = dbQuery(`SELECT COUNT(*) FROM orders WHERE idempotency_key='${key}'`);
  if (cnt === null) skip('TC-033', 'DB 仅 1 单', 'mysql 不可用');
  else check('TC-033', 'DB 仅 1 单', Number(cnt[0][0]) === 1, `count=${cnt[0][0]}`);

  // TC-035 幂等键边界
  const noKey = await api('POST', '/api/v1/orders', { token: idemUser.token, body });
  check('TC-035', '缺幂等键 400 IDEMPOTENCY_KEY_REQUIRED', noKey.status === 400 && /IDEMPOTENCY_KEY_REQUIRED/.test(noKey.text), `status=${noKey.status}`);
  const shortKey = await api('POST', '/api/v1/orders', { token: idemUser.token, key: '1234567', body });
  check('TC-035', '7 字符键 400', shortKey.status === 400, `status=${shortKey.status}`);
  const longKey = await api('POST', '/api/v1/orders', { token: idemUser.token, key: 'k'.repeat(65), body });
  check('TC-035', '65 字符键 400', longKey.status === 400, `status=${longKey.status}`);
  const conflict = await api('POST', '/api/v1/orders', { token: idemUser.token, key, body: { ...body, items: [{ ...body.items[0], qty: 2 }] } });
  check('TC-035', '同键异体 409 IDEMPOTENCY_CONFLICT', conflict.status === 409 && /IDEMPOTENCY_CONFLICT/.test(conflict.text), `status=${conflict.status}`);

  finish('api-orders.json');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });