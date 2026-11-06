/**
 * 여러 종류가 섞여 있을 때 "무엇을 열까요?" 체크 목록. DOM만 다루고 Cesium은 모른다.
 */

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * @param {HTMLElement} panel
 * @param {ReturnType<import('./dropClassify.js').classifyDrop>} plan
 * @param {{ onOpen:(sel:{tilesets:number[], terrains:number[], models:number[], dems:number[], vectors:number[]})=>void, onCancel:()=>void }} o  번호는 plan 안의 순서
 */
export function showDropChoices(panel, plan, o) {
  panel.replaceChildren();
  panel.hidden = false;
  panel.append(el('h2', null, '무엇을 열까요?'));
  panel.append(el('div', 'sub', '놓은 자료에서 열 수 있는 것을 찾았습니다. 열 것을 고르세요.'));

  const picks = { tilesets: [], terrains: [], models: [], dems: [], vectors: [] };
  const section = (title, key, items, text) => {
    if (!items.length) return;
    const fs = el('fieldset');
    fs.append(el('legend', null, title));
    items.forEach((item, i) => {
      const row = el('label');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      picks[key][i] = cb;
      row.append(cb, el('span', null, text(item)));
      fs.append(row);
    });
    panel.append(fs);
  };
  section('3D Tiles', 'tilesets', plan.tilesets, (t) => `${t.name || '(놓은 폴더)'} — 파일 ${t.count.toLocaleString('ko-KR')}개`);
  section('지형 타일 (Cesium terrain, layer.json) — 지형은 한 번에 하나만 열려 있습니다', 'terrains', plan.terrains, (t) => `${t.name || '(놓은 폴더)'} — 파일 ${t.count.toLocaleString('ko-KR')}개`);
  section('glb 모델 (하나씩 위치를 정합니다)', 'models', plan.models, (m) => m.path);
  section('지형(DEM) — GeoTIFF는 하나씩, 글자 파일(.txt/.xyz/.asc)은 고른 것을 합쳐 하나로 엽니다. 지형은 한 번에 하나만 열려 있습니다', 'dems', plan.dems, (d) => d.path);
  section('GeoJSON / SHP / ZIP', 'vectors', plan.vectors, (v) => `${v.label} (${v.kind})`);

  const extra = [];
  if (plan.styles.length) extra.push(`SLD 스타일 ${plan.styles.length}개는 고른 벡터에 같이 쓸 수 있습니다.`);
  if (plan.ignored.length) extra.push(`건너뜀: 열 수 없는 파일 ${plan.ignored.length}개 (${plan.ignored.slice(0, 3).join(', ')}${plan.ignored.length > 3 ? ' …' : ''})`);
  for (const t of extra) panel.append(el('div', 'sub', t));

  const actions = el('div', 'actions');
  const open = el('button', 'primary', '선택한 것 열기');
  open.type = 'button';
  const cancel = el('button', null, '취소');
  cancel.type = 'button';
  const chosen = (key) => picks[key].map((cb, i) => (cb.checked ? i : -1)).filter((i) => i >= 0);
  const count = () => chosen('tilesets').length + chosen('terrains').length + chosen('models').length + chosen('dems').length + chosen('vectors').length;
  const refresh = () => {
    open.disabled = count() === 0;
  };
  for (const cb of Object.values(picks).flat()) cb.addEventListener('change', refresh);
  open.addEventListener('click', () => o.onOpen({ tilesets: chosen('tilesets'), terrains: chosen('terrains'), models: chosen('models'), dems: chosen('dems'), vectors: chosen('vectors') }));
  cancel.addEventListener('click', o.onCancel);
  actions.append(open, cancel);
  panel.append(actions);
  refresh();
}
