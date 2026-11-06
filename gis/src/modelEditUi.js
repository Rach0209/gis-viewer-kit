/**
 * 놓은 glb의 편집 패널: 이동(동서남북), 높이, 방향, 기울기, 크기, 위쪽 축, 처음 값으로.
 * 값을 고치면 바로 모델에 반영된다 (onPatch / onNudge). DOM만 다루고 Cesium은 모른다.
 */
import { NUDGE_STEPS } from './modelEdit.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function button(label, onClick, cls = '') {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
const fmt = (n, d = 2) => (Number.isFinite(n) ? String(+n.toFixed(d)) : '');

/**
 * @param {HTMLElement} panel
 * @param {{
 *   name: string, hasPivot: boolean,
 *   getMeta: () => object,
 *   onNudge: (dEastM:number, dNorthM:number) => void,
 *   onPatch: (patch:object) => void|Promise<void>,
 *   onPickMap: () => void,
 *   onGround?: () => void|Promise<void>,
 *   onDragToggle: (on:boolean) => void,
 *   onReset: () => void|Promise<void>,
 *   onClose: () => void,
 * }} o
 * @returns {{update:(meta:object)=>void, setDragPressed:(on:boolean)=>void}}
 */
export function showEditPanel(panel, o) {
  panel.replaceChildren();
  panel.hidden = false;
  panel.append(el('h2', null, `모델 편집: ${o.name}`));
  const err = el('div', 'warn');

  const run = async (fn, revert) => {
    try {
      err.textContent = '';
      await fn();
    } catch (e) {
      err.textContent = String(e?.message ?? e);
      revert?.();
    }
  };

  // ---------------- 위치
  const pos = el('fieldset');
  pos.append(el('legend', null, '위치'));
  const lonLat = el('div', 'sub');
  const stepSel = document.createElement('select');
  for (const s of NUDGE_STEPS) {
    const opt = document.createElement('option');
    opt.value = String(s);
    opt.textContent = `${s} m씩`;
    stepSel.appendChild(opt);
  }
  stepSel.value = '1';
  stepSel.setAttribute('aria-label', '이동 단위');
  const step = () => Number(stepSel.value);
  const nudge = el('div', 'nudge');
  const cell = (label, dE, dN) => {
    const b = button(label, () => run(() => o.onNudge(dE * step(), dN * step())), 'small');
    b.title = ['북', '남', '동', '서'][[[0, 1], [0, -1], [1, 0], [-1, 0]].findIndex(([a, c]) => a === dE && c === dN)] + '쪽으로 이동 (나침반 방향 기준)';
    return b;
  };
  nudge.append(el('span'), cell('▲', 0, 1), el('span'), cell('◀', -1, 0), el('span', 'sub', '북'), cell('▶', 1, 0), el('span'), cell('▼', 0, -1), el('span'));
  const pickBtn = button('지도에서 다시 선택', () => o.onPickMap());
  const dragBtn = button('끌어서 이동', () => {
    const on = dragBtn.getAttribute('aria-pressed') !== 'true';
    o.onDragToggle(on);
  });
  dragBtn.setAttribute('aria-pressed', 'false');
  dragBtn.title = '켜면 지도에서 모델을 마우스로 끌어 옮깁니다 (이때는 지도 이동이 잠깁니다)';
  const posRow = el('div', 'actions');
  posRow.append(stepSel, pickBtn, dragBtn);
  pos.append(lonLat, nudge, posRow);

  // ---------------- 높이·방향·기울기·크기
  const shape = el('fieldset');
  shape.append(el('legend', null, '높이 · 방향 · 기울기 · 크기'));
  const form = el('div', 'form');

  const heightIn = el('input');
  heightIn.type = 'number';
  heightIn.step = 'any';
  const heightRow = el('div', 'inline');
  heightRow.append(button('−', () => run(() => o.onPatch({ height: o.getMeta().height - step() })), 'small'), heightIn, button('+', () => run(() => o.onPatch({ height: o.getMeta().height + step() })), 'small'));
  if (o.onGround) {
    const ground = button('지형 높이로', () => run(() => o.onGround()), 'small');
    ground.title = '모델 위치의 지형 높이(열린 DEM, 없으면 평평한 지구 0 m)로 높이를 맞춥니다';
    heightRow.append(ground);
  }
  heightIn.addEventListener('change', () => run(() => o.onPatch({ height: Number(heightIn.value) }), () => update(o.getMeta())));
  form.append(el('label', null, '높이 (m)'), heightRow);

  const slider = (key, label, min, max) => {
    const range = el('input');
    range.type = 'range';
    range.min = String(min);
    range.max = String(max);
    range.step = '1';
    const num = el('input');
    num.type = 'number';
    num.step = 'any';
    const row = el('div', 'inline');
    row.append(range, num);
    range.addEventListener('input', () => run(() => o.onPatch({ [key]: Number(range.value) }), () => update(o.getMeta())));
    num.addEventListener('change', () => run(() => o.onPatch({ [key]: Number(num.value) }), () => update(o.getMeta())));
    form.append(el('label', null, label), row);
    return { range, num };
  };
  const heading = slider('headingDeg', '방향 (°, 시계)', -180, 180);
  const pitch = slider('pitchDeg', '앞뒤 기울기 (°)', -90, 90);
  const roll = slider('rollDeg', '좌우 기울기 (°)', -90, 90);

  const scaleIn = el('input');
  scaleIn.type = 'number';
  scaleIn.step = 'any';
  scaleIn.addEventListener('change', () => run(() => o.onPatch({ scale: Number(scaleIn.value) }), () => update(o.getMeta())));
  const scaleRow = el('div', 'inline');
  scaleRow.append(scaleIn);
  for (const [label, v] of [['m', 1], ['cm', 0.01], ['mm', 0.001]]) scaleRow.append(button(label, () => run(() => o.onPatch({ scale: v })), 'small'));
  form.append(el('label', null, '크기 배율'), scaleRow);

  const upSel = document.createElement('select');
  for (const [v, l] of [['Y', 'Y축이 위 (glTF 표준)'], ['Z', 'Z축이 위 (GIS/CAD)']]) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = l;
    upSel.appendChild(opt);
  }
  upSel.addEventListener('change', () => run(() => o.onPatch({ upAxis: upSel.value }), () => update(o.getMeta())));
  form.append(el('label', null, '위쪽 축'), upSel);
  shape.append(form);
  if (o.hasPivot) shape.append(el('div', 'sub', '파일 안 실제 좌표로 놓은 모델은 바닥 중심을 기준으로 돌고 옮겨집니다. 높이는 바닥의 높이(타원체고)입니다.'));

  // ---------------- 아래 버튼
  const actions = el('div', 'actions');
  actions.append(button('처음 값으로', () => run(() => o.onReset())), button('닫기', () => o.onClose()));
  panel.append(pos, shape, err, actions);

  function update(meta) {
    lonLat.textContent = `경도 ${meta.lon.toFixed(7)}, 위도 ${meta.lat.toFixed(7)}`;
    const active = document.activeElement;
    const set = (input, v, d = 2) => {
      if (input !== active) input.value = fmt(v, d);
    };
    set(heightIn, meta.height);
    for (const [ctl, v] of [[heading, meta.headingDeg ?? 0], [pitch, meta.pitchDeg ?? 0], [roll, meta.rollDeg ?? 0]]) {
      if (ctl.range !== active) ctl.range.value = String(v);
      set(ctl.num, v);
    }
    set(scaleIn, meta.scale ?? 1, 6);
    if (upSel !== active) upSel.value = meta.upAxis ?? 'Y';
  }
  update(o.getMeta());

  return {
    update,
    setDragPressed(on) {
      dragBtn.setAttribute('aria-pressed', String(on));
    },
  };
}
