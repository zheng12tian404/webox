// TC-068/069：菜单与下单延迟采样（Stage 5 用 QPS=50/10、DURATION=60 跑正式口径）
import { api, login, firstDish, dishIdOf, dataOf, todayShanghai, orderBody, check, skip, finish } from './lib.mjs';

const QPS = Number(process.env.PERF_QPS || 20);
const DURATION = Number(process.env.PERF_DURATION_S || 10);
const PATHS = (process.env.PERF_PATHS || '/api/v1/menu?page=1&size=20,/api/v1/menu?search=chicken').split(',');

function pct(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function main() {
  const emp = await login('employee@webox.com', 'Employee123');
  if (!emp.token) { check('TC-068', '登录', false, '员工登录失败'); return finish('perf-menu.json'); }
  const lat = []; let errors = 0;
  const interval = 1000 / QPS;
  const end = Date.now() + DURATION * 1000;
  let inflight = 0;
  while (Date.now() < end || inflight > 0) {
    if (Date.now() < end) {
      const path = PATHS[lat.length % PATHS.length];
      lat.push(-1);
      const idx = lat.length - 1;
      inflight += 1;
      api('GET', path, { token: emp.token, timeoutMs: 20000 }).then((r) => {
        lat[idx] = r.ms;
        if (r.status >= 500 || r.status === 0) errors += 1;
        inflight -= 1;
      });
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
    if (Date.now() >= end && inflight === 0) break;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  const samples = lat.filter((v) => v >= 0);
  const p95 = pct(samples, 95);
  check('TC-068', `菜单 P95 ≤ 200ms（实测 ${p95}ms，n=${samples.length}）`, p95 > 0 && p95 <= 200, `p50=${pct(samples, 50)} p95=${p95} max=${Math.max(...samples)}`);
  check('TC-068', '5xx=0', errors === 0, `errors=${errors}`);

  // 下单 P95（不同用户+幂等键，10 QPS；短时冒烟）
  const { items } = await firstDish(emp.token);
  const dish = items[0];
  if (dish) {
    const preview = await api('POST', '/api/v1/orders/preview', { token: emp.token, body: orderBody(dishIdOf(dish), { qty: 1 }) });
    const pd = dataOf(preview.json) || {};
    const body = orderBody(dishIdOf(dish), { qty: 1, deliveryDate: pd.effectiveDate || todayShanghai(), mealType: pd.effectiveMeal || 'Lunch' });
    const lat2 = []; let err2 = 0;
    for (let i = 0; i < 10; i += 1) {
      const email = `perf_${Date.now()}_${i}@test.com`;
      const reg = await api('POST', '/api/v1/auth/register', { body: { email, password: 'Abc12345' } });
      if (reg.status !== 201) { skip('TC-069', '下单压测用户', '注册受限/失败'); break; }
      const lg = await api('POST', '/api/v1/auth/login', { body: { email, password: 'Abc12345' } });
      const token = dataOf(lg.json)?.accessToken;
      if (!token) continue;
      const r = await api('POST', '/api/v1/orders', { token, key: `perf-${Date.now()}-${i}`, body });
      lat2.push(r.ms);
      if (r.status >= 500 || r.status === 0) err2 += 1;
    }
    if (lat2.length) {
      const p95o = pct(lat2, 95);
      check('TC-069', `下单 P95 ≤ 500ms（实测 ${p95o}ms，n=${lat2.length}）`, p95o <= 500, `p50=${pct(lat2, 50)} p95=${p95o}`);
      check('TC-069', '下单 5xx=0', err2 === 0, `errors=${err2}`);
    }
  } else {
    skip('TC-069', '下单压测', '菜单为空');
  }

  finish('perf-menu.json');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });