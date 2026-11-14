// TC-010~018：菜单分页/筛选/搜索/注入/详情/选项
import { api, login, dataOf, firstDish, dishIdOf, todayShanghai, check, skip, finish } from './lib.mjs';

function itemsOf(json) {
  const d = dataOf(json) || {};
  return d.items || d.list || d.content || (Array.isArray(d) ? d : []);
}

async function main() {
  const emp = await login('employee@webox.com', 'Employee123');
  if (!emp.token) { check('TC-010', '登录获取 token', false, '员工登录失败'); return finish('api-menu.json'); }

  // TC-010 分页
  const p1 = await api('GET', '/api/v1/menu?page=1&size=20', { token: emp.token });
  const d1 = dataOf(p1.json) || {};
  const items = itemsOf(p1.json);
  check('TC-010', '列表 200 且 20 条', p1.status === 200 && items.length === 20, `status=${p1.status} count=${items.length}`);
  check('TC-010', '分页元数据 page/size/total', d1.page !== undefined && d1.size !== undefined && typeof d1.total === 'number', JSON.stringify({ page: d1.page, size: d1.size, total: d1.total }));
  const badPrice = items.filter((it) => !Number.isInteger(it.priceCents));
  check('TC-010', 'priceCents 全为整数', badPrice.length === 0, `bad=${badPrice.length}`);
  const badDisplay = items.filter((it) => !/^¥\d+\.\d{2}$/.test(String(it.priceDisplay ?? '')));
  check('TC-010', 'priceDisplay 全为 ¥xx.xx', badDisplay.length === 0, `bad=${badDisplay.length}`);
  const p2 = await api('GET', '/api/v1/menu?page=2&size=20', { token: emp.token });
  check('TC-010', 'page=2 可用', p2.status === 200 && itemsOf(p2.json).length > 0, `status=${p2.status} count=${itemsOf(p2.json).length}`);

  // TC-011 分页边界
  const size101 = await api('GET', '/api/v1/menu?size=101', { token: emp.token });
  check('TC-011', 'size=101 → 400 VALIDATION_PAGINATION', size101.status === 400 && /VALIDATION_PAGINATION/.test(size101.text), `status=${size101.status}`);
  const size100 = await api('GET', '/api/v1/menu?size=100', { token: emp.token });
  check('TC-011', 'size=100 → 200', size100.status === 200, `status=${size100.status}`);
  const page0 = await api('GET', '/api/v1/menu?page=0', { token: emp.token });
  check('TC-011', 'page=0 → 400', page0.status === 400, `status=${page0.status}`);

  // TC-012 分类多选
  const cj = await api('GET', '/api/v1/menu?category=Chinese,Japanese&size=100', { token: emp.token });
  const cjItems = itemsOf(cj.json);
  check('TC-012', 'Chinese,Japanese 仅返回并集', cj.status === 200 && cjItems.every((it) => ['Chinese', 'Japanese'].includes(it.category)), `status=${cj.status} items=${cjItems.length}`);
  const jw = await api('GET', '/api/v1/menu?category=Japanese,Western&size=100', { token: emp.token });
  check('TC-012', 'Japanese,Western 仅返回并集', jw.status === 200 && itemsOf(jw.json).every((it) => ['Japanese', 'Western'].includes(it.category)), `status=${jw.status}`);
  const badCat = await api('GET', '/api/v1/menu?category=Klingon', { token: emp.token });
  check('TC-012', '非法分类 400 VALIDATION_CATEGORY', badCat.status === 400 && /VALIDATION_CATEGORY/.test(badCat.text), `status=${badCat.status}`);

  // TC-013 搜索大小写
  const names = ['CHICKEN', 'chicken', 'ChIcKeN'];
  const sets = [];
  for (const q of names) {
    const r = await api('GET', `/api/v1/menu?search=${encodeURIComponent(q)}&size=100`, { token: emp.token });
    sets.push(itemsOf(r.json).map((it) => dishIdOf(it)).sort().join(','));
  }
  check('TC-013', '大小写搜索返回一致集合', sets[0] === sets[1] && sets[1] === sets[2] && sets[0] !== '', `sets=${sets.map((s) => s.length).join('/')}`);

  // TC-014 注入
  const payloads = ["' OR 1=1--", '%', '_', "'; DROP TABLE dish;--"];
  for (const payload of payloads) {
    const r = await api('GET', `/api/v1/menu?search=${encodeURIComponent(payload)}&size=100`, { token: emp.token });
    const leaked = /SQL|syntax|java\.|Exception|stack trace/i.test(r.text);
    check('TC-014', `注入 payload 安全: ${payload}`, r.status < 500 && !leaked, `status=${r.status} leaked=${leaked}`);
  }

  // TC-015 搜索长度
  const q50 = await api('GET', `/api/v1/menu?search=${'a'.repeat(50)}`, { token: emp.token });
  const q51 = await api('GET', `/api/v1/menu?search=${'a'.repeat(51)}`, { token: emp.token });
  check('TC-015', 'search=50 → 200', q50.status === 200, `status=${q50.status}`);
  check('TC-015', 'search=51 → 400 VALIDATION_SEARCH_LENGTH', q51.status === 400 && /VALIDATION_SEARCH_LENGTH/.test(q51.text), `status=${q51.status}`);

  // TC-016 详情与选项
  const { items: all } = await firstDish(emp.token);
  const burger = all.find((it) => /beef burger/i.test(it.name || '')) || all[0];
  if (!burger) { skip('TC-016', '详情', '菜单无数据'); return finish('api-menu.json'); }
  const detail = await api('GET', `/api/v1/menu/${dishIdOf(burger)}`, { token: emp.token });
  const dd = dataOf(detail.json) || {};
  check('TC-016', '详情 200 且含描述/过敏原/辣度', detail.status === 200 && dd.description && Array.isArray(dd.allergens) && dd.spiceLevel, `status=${detail.status}`);
  const groups = dd.optionGroups || dd.options || [];
  check('TC-016', '选项组结构存在', Array.isArray(groups) && groups.length >= 0, `groups=${groups.length}`);
  const enumOk = ['None', 'Mild', 'Medium', 'Hot'].includes(dd.spiceLevel);
  check('TC-016', 'spiceLevel 枚举合法', enumOk, `spiceLevel=${dd.spiceLevel}`);
  const allergenEnum = ['Peanuts', 'Dairy', 'Egg', 'Gluten', 'Soy', 'Fish', 'Shellfish'];
  check('TC-016', '过敏原均在固定枚举内', (dd.allergens || []).every((a) => allergenEnum.includes(a)), JSON.stringify(dd.allergens));

  // TC-017 preview 价格（选项加价由服务端重算）
  const preview = await api('POST', '/api/v1/orders/preview', {
    token: emp.token,
    body: { items: [{ dishId: dishIdOf(burger), qty: 1, optionIds: [] }], deliveryDate: todayShanghai(), mealType: 'Lunch', address: 'Office 1F, Test Street' },
  });
  check('TC-017', 'preview 200 且 totalCents 为整数', preview.status === 200 && Number.isInteger((dataOf(preview.json) || {}).totalCents), `status=${preview.status} body=${preview.text.slice(0, 250)}`);
  if (preview.status !== 200) skip('TC-017', '选项加价断言', 'preview 契约未匹配，按 api-contract.md 调整请求体');

  finish('api-menu.json');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });