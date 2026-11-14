// WeBox 测试脚手架公共库（Node 22，原生 fetch）
// 不包含业务实现，只做请求、断言与证据落盘。
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
export const EVIDENCE = process.env.EVIDENCE_DIR || join(process.cwd(), 'artifacts', 'test', 'manual');
export const RUN_ID = process.env.RUN_ID || new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@webox.com';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin12345';
export const EMPLOYEE_EMAIL = process.env.EMPLOYEE_EMAIL || 'employee@webox.com';
export const EMPLOYEE_PASSWORD = process.env.EMPLOYEE_PASSWORD || 'Employee123';

export const results = [];
export const H = { 'Content-Type': 'application/json' };
let __xff = 1;
function nextXff() { __xff += 1; return `10.${(__xff>>16)&255}.${(__xff>>8)&255}.${__xff&255}`; }
mkdirSync(EVIDENCE, { recursive: true });

export function dataOf(json) {
  if (json == null) return null;
  return Object.prototype.hasOwnProperty.call(json, 'data') ? json.data : json;
}

export function tokenOf(json) {
  const d = dataOf(json) || {};
  return d.token || d.accessToken || d.access_token || d.jwt || d.idToken || null;
}

export function todayShanghai() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

export function uniqueEmail(prefix = 'tc') {
  return `${prefix}_${RUN_ID}_${Math.random().toString(36).slice(2, 8)}@test.com`;
}

export async function api(method, path, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const headers = { ...H, ...(opts.headers || {}) };
  if (!headers['X-Forwarded-For']) headers['X-Forwarded-For'] = nextXff();
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.key) headers['Idempotency-Key'] = opts.key;
  if (opts.clock) headers['X-Test-Clock'] = opts.clock;
  const init = { method, headers, signal: AbortSignal.timeout(opts.timeoutMs || 30000) };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const t0 = performance.now();
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应保留原文 */ }
    return { status: res.status, headers: Object.fromEntries(res.headers), json, text, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    return { status: 0, error: String(err), json: null, text: '', ms: Math.round(performance.now() - t0) };
  }
}

export function check(tc, name, ok, detail = '') {
  const row = { tc, name, ok: Boolean(ok), detail, at: new Date().toISOString() };
  results.push(row);
  const tag = row.ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${tc} ${name}${detail ? ' :: ' + detail : ''}`);
  return row.ok;
}

export function skip(tc, name, reason) {
  results.push({ tc, name, ok: null, skipped: true, detail: reason, at: new Date().toISOString() });
  console.log(`[SKIP] ${tc} ${name} :: ${reason}`);
}

export function expectStatus(tc, name, r, expected) {
  return check(tc, name, r.status === expected, `status=${r.status} expected=${expected} body=${r.text?.slice(0, 300)}`);
}

export function finish(file) {
  const pass = results.filter((r) => r.ok === true).length;
  const fail = results.filter((r) => r.ok === false).length;
  const skipped = results.filter((r) => r.skipped).length;
  const payload = { runId: RUN_ID, base: BASE, finishedAt: new Date().toISOString(), pass, fail, skipped, results };
  writeFileSync(join(EVIDENCE, file), JSON.stringify(payload, null, 2));
  console.log(`\n== ${file}: PASS=${pass} FAIL=${fail} SKIP=${skipped} ==`);
  if (fail > 0) process.exitCode = 1;
}

export async function register(email, password = 'Abc12345', extra = {}) {
  return api('POST', '/api/v1/auth/register', { body: { email, password, ...extra } });
}

export async function login(email, password) {
  const r = await api('POST', '/api/v1/auth/login', { body: { email, password } });
  return { ...r, token: tokenOf(r.json) };
}

export async function adminToken() {
  const r = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  return r.token || null;
}

export async function employeeToken() {
  const r = await login(EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD);
  return r.token || null;
}

export async function firstDish(token) {
  const r = await api('GET', '/api/v1/menu?page=1&size=20', { token });
  const d = dataOf(r.json) || {};
  const items = d.items || d.list || d.content || (Array.isArray(d) ? d : []);
  return { r, dish: items[0] || null, items };
}

export function dishIdOf(dish) {
  return dish?.id ?? dish?.dishId ?? null;
}

export function availableOf(dish) {
  return dish?.available ?? dish?.remaining ?? dish?.availableQty ?? dish?.stock ?? null;
}

export function roleOf(json) {
  const d = dataOf(json) || {};
  return d.user?.role || d.role || null;
}

export function orderBody(dishId, { qty = 1, optionIds = [], deliveryDate = todayShanghai(), mealType = 'Lunch', address = 'Office 1F, Test Street' } = {}) {
  return { items: [{ dishId, qty, optionIds }], deliveryDate, mealType, address };
}

// 需要本机 mysql 客户端；失败返回 null，调用方标记 SKIP。
export function dbQuery(sql) {
  const args = [
    '-N', '-B',
    '-h', process.env.MYSQL_HOST || '127.0.0.1',
    '-P', String(process.env.MYSQL_PORT || 3306),
    '-u', process.env.MYSQL_USER || 'test',
    process.env.MYSQL_DATABASE || 'req_6343a752e110',
    '-e', sql,
  ];
  try {
    const out = execFileSync('mysql', args, {
      encoding: 'utf8',
      env: { ...process.env, MYSQL_PWD: process.env.MYSQL_PASSWORD || 'test123456' },
      timeout: 15000,
    });
    return out.trim() ? out.trim().split('\n').map((line) => line.split('\t')) : [];
  } catch (err) {
    return null;
  }
}

export function orderIdOf(json) {
  const d = dataOf(json) || {};
  return d.id ?? d.orderId ?? d.orderNo ?? null;
}

export function errorCodeOf(json) {
  return json?.code ?? dataOf(json)?.code ?? null;
}