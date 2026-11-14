// TC-047/048/051/074：角色隔离、401/403、横向越权、篡改 JWT
import { api, login, register, uniqueEmail, dataOf, firstDish, dishIdOf, todayShanghai, orderBody, orderIdOf, check, finish } from './lib.mjs';

async function newUser(prefix) {
  const email = uniqueEmail(prefix);
  await register(email, 'Abc12345');
  return login(email, 'Abc12345');
}

async function main() {
  const emp = await login('employee@webox.com', 'Employee123');
  const admin = await login('admin@webox.com', 'Admin12345');
  if (!emp.token || !admin.token) { check('TC-047', '种子账号登录', false, 'employee/admin 登录失败'); return finish('api-authz.json'); }

  // TC-047 员工访问 Console API
  const adminDishes = await api('GET', '/api/v1/admin/dishes', { token: emp.token });
  check('TC-047', '员工 GET /admin/dishes → 403', adminDishes.status === 403, `status=${adminDishes.status} body=${adminDishes.text.slice(0, 200)}`);
  check('TC-047', '错误码 FORBIDDEN', /FORBIDDEN/.test(adminDishes.text), adminDishes.text.slice(0, 200));
  const adminOrders = await api('GET', '/api/v1/admin/orders', { token: emp.token });
  check('TC-047', '员工 GET /admin/orders → 403', adminOrders.status === 403, `status=${adminOrders.status}`);
  const adminMenu = await api('GET', '/api/v1/admin/daily-menu', { token: emp.token });
  check('TC-047', '员工 GET /admin/daily-menu → 403', adminMenu.status === 403, `status=${adminMenu.status}`);

  // 管理员 200
  const okAdmin = await api('GET', '/api/v1/admin/dishes', { token: admin.token });
  check('TC-047', '管理员同请求 200', okAdmin.status === 200, `status=${okAdmin.status}`);

  // 未登录 401
  const noAuthMenu = await api('GET', '/api/v1/menu');
  check('TC-047', '未登录 GET /menu → 401', noAuthMenu.status === 401 && /AUTH_UNAUTHORIZED|AUTH_TOKEN/.test(noAuthMenu.text), `status=${noAuthMenu.status}`);
  const noAuthOrders = await api('GET', '/api/v1/orders');
  check('TC-047', '未登录 GET /orders → 401', noAuthOrders.status === 401, `status=${noAuthOrders.status}`);

  // TC-074 篡改 JWT
  const parts = String(emp.token).split('.');
  const tampered = parts.length === 3 ? `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}xx` : `${emp.token}x`;
  const bad = await api('GET', '/api/v1/auth/me', { token: tampered });
  check('TC-074', '篡改 JWT → 401 AUTH_TOKEN_INVALID', bad.status === 401, `status=${bad.status} body=${bad.text.slice(0, 200)}`);

  // TC-051 横向越权：A 下单，B 读取/取消
  const userA = await newUser('authzA');
  const userB = await newUser('authzB');
  const { items } = await firstDish(userA.token);
  const dish = items[0];
  let orderId = null;
  if (dish) {
    const preview = await api('POST', '/api/v1/orders/preview', { token: userA.token, body: orderBody(dishIdOf(dish), { qty: 1 }) });
    const pd = dataOf(preview.json) || {};
    const create = await api('POST', '/api/v1/orders', {
      token: userA.token,
      key: `authzA-${Date.now()}`,
      body: orderBody(dishIdOf(dish), { qty: 1, deliveryDate: pd.effectiveDate || todayShanghai(), mealType: pd.effectiveMeal || 'Lunch' }),
    });
    orderId = orderIdOf(create.json);
    check('TC-051', 'A 下单成功（前置）', create.status === 201, `status=${create.status}`);
  }
  if (orderId) {
    const readOther = await api('GET', `/api/v1/orders/${orderId}`, { token: userB.token });
    check('TC-051', 'B 读 A 订单 → 404/403', [403, 404].includes(readOther.status), `status=${readOther.status} body=${readOther.text.slice(0, 200)}`);
    const cancelOther = await api('POST', `/api/v1/orders/${orderId}/cancel`, { token: userB.token, body: { reason: 'x' } });
    check('TC-051', 'B 取消 A 订单 → 404/403', [403, 404].includes(cancelOther.status), `status=${cancelOther.status}`);
    const still = await api('GET', `/api/v1/orders/${orderId}`, { token: userA.token });
    const sd = dataOf(still.json) || {};
    check('TC-051', 'A 订单数据未被修改', still.status === 200 && String(sd.status || '') === 'Pending', `status=${sd.status}`);
    const listB = await api('GET', '/api/v1/orders', { token: userB.token });
    const ids = (dataOf(listB.json)?.items || []).map((o) => o.orderId ?? o.id);
    check('TC-051', 'B 订单列表不含 A 的单', !ids.includes(orderId), `ids=${JSON.stringify(ids).slice(0, 200)}`);
  } else {
    check('TC-051', '横向越权前置（A 下单）', false, '无法创建订单，检查菜单/截单');
  }

  // 员工访问 Console 页面（TC-048）由 E2E 覆盖
  finish('api-authz.json');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });