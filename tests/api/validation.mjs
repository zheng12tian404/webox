// TC-070/071/072：统一包络、字段长度边界、限流、错误码
import {
  api, register, login, uniqueEmail, adminToken, dataOf, firstDish, dishIdOf,
  todayShanghai, orderBody, check, skip, finish,
} from './lib.mjs';

function envelope(r) {
  const j = r.json || {};
  const ok = j && typeof j === 'object'
    && typeof j.code === 'string' && typeof j.message === 'string'
    && Object.prototype.hasOwnProperty.call(j, 'data') && typeof j.requestId === 'string'
    && r.headers['x-request-id'] === j.requestId;
  return { ok, json: j };
}

async function main() {
  const emp = await login('employee@webox.com', 'Employee123');
  const admin = await adminToken();
  if (!emp.token) { check('TC-070', '员工登录', false, '登录失败'); return finish('api-validation.json'); }

  // TC-070 包络：400 / 401 / 404 / 409
  const cases = [
    ['400', await api('GET', `/api/v1/menu?search=${'a'.repeat(51)}`, { token: emp.token })],
    ['401', await api('GET', '/api/v1/menu')],
    ['404', await api('GET', '/api/v1/menu/99999999', { token: emp.token })],
    ['409', await api('POST', '/api/v1/auth/register', { body: { email: 'employee@webox.com', password: 'Abc12345' } })],
  ];
  for (const [label, r] of cases) {
    const e = envelope(r);
    check('TC-070', `${label} 包络 {code,message,data,requestId} 且头体一致`, e.ok, `status=${r.status} body=${r.text.slice(0, 220)}`);
    check('TC-070', `${label} 无堆栈/SQL 泄漏`, !/SQL|syntax|java\.|Exception|at [a-z]+\./i.test(r.text), r.text.slice(0, 120));
  }

  // TC-071 长度边界：邮箱
  const email200 = `${'a'.repeat(188)}@test.com`; // 200 字符
  const email201 = `${'a'.repeat(189)}@test.com`;
  const e200 = await register(uniqueEmail('len200'), 'Abc12345');
  const e201 = await register(uniqueEmail('len201'), 'Abc12345');
  const r200 = await api('POST', '/api/v1/auth/register', { body: { email: email200, password: 'Abc12345' } });
  const r201 = await api('POST', '/api/v1/auth/register', { body: { email: email201, password: 'Abc12345' } });
  check('TC-071', '邮箱 200 字符通过', [201, 409].includes(r200.status), `status=${r200.status}`);
  check('TC-071', '邮箱 201 字符 400 VALIDATION_EMAIL_LENGTH', r201.status === 400 && /VALIDATION_EMAIL_LENGTH/.test(r201.text), `status=${r201.status}`);

  // 密码 64/65
  const pw64 = `Aa1${'x'.repeat(61)}`;
  const pw65 = `Aa1${'x'.repeat(62)}`;
  const p64 = await register(uniqueEmail('pw64'), pw64);
  const p65 = await register(uniqueEmail('pw65'), pw65);
  check('TC-071', '密码 64 通过', p64.status === 201, `status=${p64.status}`);
  check('TC-071', '密码 65 → 400', p65.status === 400, `status=${p65.status}`);

  // 地址 200/201（地址簿接口）
  const a200 = await api('POST', '/api/v1/me/addresses', { token: emp.token, body: { address: 'A'.repeat(200) } });
  const a201 = await api('POST', '/api/v1/me/addresses', { token: emp.token, body: { address: 'A'.repeat(201) } });
  check('TC-071', '地址 200 通过', [200, 201].includes(a200.status), `status=${a200.status}`);
  check('TC-071', '地址 201 → 400 VALIDATION_ADDRESS_LENGTH', a201.status === 400 && /VALIDATION_ADDRESS_LENGTH/.test(a201.text), `status=${a201.status}`);

  // 原因 200/201（管理端库存调整，H3）
  const { items } = await firstDish(emp.token);
  const dish = items[0];
  if (admin && dish) {
    const reason200 = await api('PUT', `/api/v1/admin/daily-menu/${todayShanghai()}/${dishIdOf(dish)}/stock`, {
      token: admin, body: { totalQty: 30, confirm: true, reason: 'R'.repeat(200) },
    });
    const reason201 = await api('PUT', `/api/v1/admin/daily-menu/${todayShanghai()}/${dishIdOf(dish)}/stock`, {
      token: admin, body: { totalQty: 30, confirm: true, reason: 'R'.repeat(201) },
    });
    check('TC-071', '原因 200 通过', reason200.status === 200, `status=${reason200.status}`);
    check('TC-071', '原因 201 → 400 VALIDATION_REASON_REQUIRED', reason201.status === 400, `status=${reason201.status}`);
  } else {
    skip('TC-071', '原因长度边界', '需要管理员与菜品数据（H3）');
  }

  // TC-072 下单限流：6 次/分/用户（使用全新用户，避免已有有效单干扰）
  const rlEmail = uniqueEmail('rl');
  await register(rlEmail, 'Abc12345');
  const rl = await login(rlEmail, 'Abc12345');
  if (rl.token && dish) {
    const preview = await api('POST', '/api/v1/orders/preview', { token: rl.token, body: orderBody(dishIdOf(dish), { qty: 1 }) });
    const pd = dataOf(preview.json) || {};
    const body = orderBody(dishIdOf(dish), { qty: 1, deliveryDate: pd.effectiveDate || todayShanghai(), mealType: pd.effectiveMeal || 'Lunch' });
    const codes = [];
    for (let i = 0; i < 7; i += 1) {
      const r = await api('POST', '/api/v1/orders', { token: rl.token, key: `rl-${Date.now()}-${i}`, body });
      codes.push(r.status);
    }
    check('TC-072', '下单超限出现 429', codes.includes(429), `codes=${codes.join(',')}`);
  } else {
    skip('TC-072', '下单限流', '用户或菜品不可用');
  }

  finish('api-validation.json');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });