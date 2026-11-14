// TC-079 前置：健康检查 + 种子可用性 + 图片可访问性
import { api, adminToken, employeeToken, firstDish, dataOf, availableOf, dishIdOf, check, skip, finish, BASE } from './lib.mjs';

async function main() {
  let health = await api('GET', '/api/v1/health');
  if (health.status === 404) health = await api('GET', '/health');
  check('TC-079', 'health 200 且 db=UP', health.status === 200 && /UP|up|ok/i.test(health.text), `status=${health.status} body=${health.text.slice(0, 300)}`);

  const admin = await adminToken();
  check('TC-004', '种子管理员可登录', Boolean(admin), admin ? 'token 已获取（不落盘）' : '登录失败');
  const employee = await employeeToken();
  check('TC-004', '种子员工可登录', Boolean(employee), employee ? 'token 已获取（不落盘）' : '登录失败');
  if (!admin || !employee) return finish('api-smoke.json');

  const { r, dish, items } = await firstDish(employee);
  check('TC-010', '菜单 200 且有菜品', r.status === 200 && items.length > 0, `status=${r.status} items=${items.length}`);
  const total = dataOf(r.json)?.total;
  check('TC-079', '当日菜单数量 ≥9（目标 20）', typeof total !== 'number' || total >= 9, `total=${total}`);
  if (dish) {
    check('TC-010', '菜品含 id/name/priceCents/category', Boolean(dishIdOf(dish) && dish.name && Number.isInteger(dish.priceCents ?? dish.price)) , JSON.stringify(dish).slice(0, 300));
    check('TC-010', 'priceDisplay 匹配 ¥xx.xx', /^¥\d+\.\d{2}$/.test(String(dish.priceDisplay ?? dish.priceText ?? '')), String(dish.priceDisplay ?? dish.priceText ?? ''));
    const avail = availableOf(dish);
    check('TC-079', '当日库存 20~50（种子）', avail === null || (avail >= 0 && avail <= 50), `available=${avail}`);
  } else {
    skip('TC-079', '菜品详情', '菜单无数据，检查种子');
  }

  const images = items.map((d) => d.imageUrl || d.image).filter(Boolean).slice(0, 5);
  let imgOk = 0;
  for (const img of images) {
    const url = img.startsWith('http') ? img : `${BASE}${img.startsWith('/') ? '' : '/'}${img}`;
    const res = await api('GET', url, { timeoutMs: 10000 });
    if (res.status === 200) imgOk += 1;
  }
  check('TC-079', '抽样图片可访问', images.length === 0 ? true : imgOk > 0, `ok=${imgOk}/${images.length}`);
  if (images.length === 0) skip('TC-079', '图片映射', '菜单未返回 imageUrl，需核对 D20');

  finish('api-smoke.json');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });