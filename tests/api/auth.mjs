// TC-001~005 / TC-084：注册、登录、校验、限流、提权
import { api, register, login, uniqueEmail, dataOf, roleOf, dbQuery, check, finish } from './lib.mjs';

async function main() {
  // TC-001 注册成功
  const email = uniqueEmail('u001');
  const reg = await register(email, 'Abc12345');
  check('TC-001', '注册 201', reg.status === 201, `status=${reg.status} body=${reg.text.slice(0, 300)}`);
  const d = dataOf(reg.json) || {};
  check('TC-001', 'role=EMPLOYEE', String(roleOf(reg.json) || '').toUpperCase() === 'EMPLOYEE', `role=${roleOf(reg.json)}`);
  check('TC-001', '响应不含密码', !/password/i.test(JSON.stringify(d)), '响应 JSON 不含 password 字段');
  const rows = dbQuery(`SELECT password_hash FROM users WHERE email='${email}'`);
  if (rows === null) {
    check('TC-001', 'DB 密码哈希（需 mysql 客户端）', false, 'dbQuery 失败：确认 MYSQL_* 环境变量与 users 表名');
  } else if (rows.length === 0) {
    check('TC-001', 'DB 用户已落库', false, `email=${email} 未查到`);
  } else {
    check('TC-001', 'BCrypt 前缀 $2', String(rows[0][0]).startsWith('$2'), `hashPrefix=${String(rows[0][0]).slice(0, 4)}`);
  }

  // TC-002 重复邮箱（含大小写变体）
  const dup = await register(email, 'Abc12345');
  check('TC-002', '重复注册 409 AUTH_EMAIL_EXISTS', dup.status === 409 && /AUTH_EMAIL_EXISTS/.test(dup.text), `status=${dup.status} body=${dup.text.slice(0, 200)}`);
  const dupCase = await register(email.replace(/^u001/, 'U001'), 'Abc12345');
  check('TC-002', '大小写变体 409', dupCase.status === 409, `status=${dupCase.status} body=${dupCase.text.slice(0, 200)}`);

  // TC-003 注册校验
  const cases = [
    ['非法邮箱', { email: 'bad-email', password: 'Abc12345' }, 'VALIDATION_EMAIL_FORMAT'],
    ['7 位密码', { email: uniqueEmail('v1'), password: 'Abc1234' }, 'VALIDATION_PASSWORD_POLICY'],
    ['纯字母密码', { email: uniqueEmail('v2'), password: 'abcdefgh' }, 'VALIDATION_PASSWORD_POLICY'],
    ['邮箱 201 字符', { email: `${'a'.repeat(190)}@test.com`, password: 'Abc12345' }, 'VALIDATION_EMAIL_LENGTH'],
  ];
  for (const [name, body, code] of cases) {
    const r = await api('POST', '/api/v1/auth/register', { body });
    check('TC-003', `${name} → 400 ${code}`, r.status === 400 && r.text.includes(code), `status=${r.status} body=${r.text.slice(0, 200)}`);
  }
  const okReg = await register(uniqueEmail('v3'), 'Abc12345');
  check('TC-003', '8 位含字母数字通过 201', okReg.status === 201, `status=${okReg.status}`);

  // TC-084 提权
  const esc = await register(uniqueEmail('esc'), 'Abc12345', { role: 'ADMIN' });
  const forcedEmployee = esc.status === 400 || String(roleOf(esc.json) || '').toUpperCase() === 'EMPLOYEE';
  check('TC-084', '注册 role=ADMIN 被拒绝或强制 EMPLOYEE', forcedEmployee, `status=${esc.status} role=${roleOf(esc.json)}`);

  // TC-004 登录 + /me
  const emp = await login('employee@webox.com', 'Employee123');
  check('TC-004', '员工登录 200 且返回 JWT', emp.status === 200 && Boolean(emp.token), `status=${emp.status} token=${emp.token ? 'yes' : 'no'}`);
  const admin = await login('admin@webox.com', 'Admin12345');
  check('TC-004', '管理员登录 role=ADMIN', admin.status === 200 && String(roleOf(admin.json) || '').toUpperCase() === 'ADMIN', `status=${admin.status} role=${roleOf(admin.json)}`);
  const me = await api('GET', '/api/v1/auth/me', { token: emp.token });
  check('TC-004', '/auth/me 200（刷新保持会话）', me.status === 200, `status=${me.status} body=${me.text.slice(0, 200)}`);

  // TC-005 登录限流
  const rateEmail = uniqueEmail('rate');
  await register(rateEmail, 'Abc12345');
  const codes = [];
  for (let i = 0; i < 11; i += 1) {
    const r = await api('POST', '/api/v1/auth/login', { body: { email: rateEmail, password: 'WrongPass1' } });
    codes.push(r.status);
  }
  check('TC-005', '连续错误密码前 10 次 401', codes.slice(0, 10).every((s) => s === 401), `codes=${codes.join(',')}`);
  check('TC-005', '第 11 次 429 RATE_LIMITED', codes[10] === 429 || codes.slice(9).includes(429), `codes=${codes.join(',')}`);

  finish('api-auth.json');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });