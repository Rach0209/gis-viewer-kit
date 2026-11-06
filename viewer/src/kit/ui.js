/**
 * kit 전용 최소 UI. 전부 컨테이너 안(position:absolute)에 만들어서, 임베드된 페이지의
 * 다른 요소와 겹치거나 document.body에 남지 않는다. 클래스는 `tvk-` 접두어로 격리한다.
 * 모든 텍스트는 textContent로 넣는다 (타일셋 파일에서 온 문자열을 HTML로 해석하지 않음).
 */

import { PROVIDERS } from './rasterProviders.js';
import { CRS_LIST, DEFAULT_CRS, fromLonLat, getCrs, isNearKorea, isValidLonLat, toLonLat } from './crsList.js';
import { createMapPicker } from './MapPicker.js';

const STYLE_ID = 'tvk-style';
const CSS = `
.tvk-root{position:relative;width:100%;height:100%;min-height:320px;overflow:hidden;background:#111318;color:#e8edf0;font:13px/1.5 system-ui,"Malgun Gothic","Apple SD Gothic Neo",sans-serif}
.tvk-root [hidden]{display:none!important}
.tvk-canvas{position:absolute;inset:0}
.tvk-canvas canvas{display:block;width:100%;height:100%;outline:none}
.tvk-left{position:absolute;top:12px;left:12px;z-index:5;display:flex;flex-direction:column;align-items:flex-start;gap:6px;max-width:calc(100% - 340px)}
.tvk-left{pointer-events:none}
.tvk-left>*{pointer-events:auto}
.tvk-toolbar{display:flex;gap:6px;flex-wrap:wrap}
.tvk-layers{width:260px;max-width:100%;padding:8px 12px 10px;background:rgba(20,22,26,.92);border:1px solid rgba(255,255,255,.2);border-radius:4px}
.tvk-layers h4{margin:0 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7fd3de;font-weight:600}
.tvk-layers label{display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer}
.tvk-layers input[type=checkbox]{margin:0}
.tvk-layers input:disabled+span{opacity:.45}
.tvk-btn:disabled{opacity:.45;cursor:not-allowed}
.tvk-edit{width:310px;max-width:100%;padding:8px 12px 10px;background:rgba(20,22,26,.92);border:1px solid rgba(255,255,255,.2);border-radius:4px}
.tvk-edit h4{margin:0 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7fd3de;font-weight:600}
.tvk-edit-row{display:flex;align-items:center;gap:6px;padding:2px 0}
.tvk-edit-row label{flex:0 0 100px;color:rgba(232,237,240,.75)}
.tvk-edit input[type=number],.tvk-edit select{flex:1;min-width:0;padding:3px 6px;background:#14191d;color:inherit;border:1px solid #2b353c;border-radius:3px;font:inherit}
.tvk-edit input[type=range]{flex:1;min-width:0}
.tvk-edit .tvk-btn{padding:3px 8px}
.tvk-edit-btnrow{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0}
.tvk-edit-read{margin:0 0 4px;font-size:12px;color:#7fe0a0;font-family:ui-monospace,Consolas,monospace}
.tvk-edit-note{margin:2px 0 4px;font-size:11px;color:rgba(232,237,240,.55)}
.tvk-pad{display:grid;grid-template-columns:repeat(3,34px);grid-template-areas:". n ." "w . e" ". s .";gap:3px}
.tvk-pad .tvk-btn{padding:2px 0;text-align:center}
.tvk-pad-n{grid-area:n}.tvk-pad-w{grid-area:w}.tvk-pad-e{grid-area:e}.tvk-pad-s{grid-area:s}
.tvk-bm{margin:2px 0 4px 22px;display:flex;flex-direction:column;gap:4px}
.tvk-bm-row{display:flex;gap:4px}
.tvk-bm select,.tvk-bm input[type=text],.tvk-bm input[type=password],.tvk-bm input[type=number]{min-width:0;flex:1;padding:3px 6px;background:#14191d;color:inherit;border:1px solid #2b353c;border-radius:3px;font:inherit}
.tvk-bm .tvk-btn{padding:3px 8px}
.tvk-bm small{opacity:.8;overflow-wrap:anywhere}
.tvk-bm .tvk-btn{align-self:flex-start}
.tvk-notice{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:9;max-width:min(520px,calc(100% - 24px));padding:8px 14px;background:rgba(60,45,10,.95);border:1px solid #ffd166;border-radius:4px;color:#ffe8a8;text-align:center;pointer-events:none}
.tvk-busy{position:absolute;inset:0;z-index:7;display:flex;align-items:center;justify-content:center;background:rgba(10,12,16,.45);cursor:progress}
.tvk-busy-box{display:flex;align-items:center;gap:12px;max-width:min(460px,calc(100% - 32px));padding:12px 18px;background:rgba(20,22,26,.96);border:1px solid #5cc4d1;border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.45)}
.tvk-spinner{flex:none;width:22px;height:22px;border:3px solid rgba(92,196,209,.25);border-top-color:#5cc4d1;border-radius:50%;animation:tvk-spin .8s linear infinite}
.tvk-busy-text{overflow-wrap:anywhere}
@keyframes tvk-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.tvk-spinner{animation-duration:2.4s}}
.tvk-dialog{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)}
.tvk-dialog-box{width:min(420px,calc(100% - 32px));padding:16px 18px;background:#1b2027;border:1px solid #ffd166;border-radius:6px;box-shadow:0 8px 32px rgba(0,0,0,.5)}
.tvk-dialog-box p{margin:0 0 14px;white-space:pre-wrap;overflow-wrap:anywhere}
.tvk-dialog-actions{display:flex;justify-content:flex-end;gap:8px}
.tvk-btn-danger{background:#8a2f2f;border-color:#d35d5d}
.tvk-btn-primary{background:#2f8fd8;border-color:#2f8fd8}
.tvk-map{position:relative;height:280px;margin:0 0 8px;overflow:hidden;border:1px solid #2b353c;border-radius:4px;background:#0f1318;cursor:grab;touch-action:none;user-select:none;outline-offset:2px}
.tvk-map:focus-visible{outline:2px solid #5cc4d1}
.tvk-map.tvk-map-dragging{cursor:grabbing}
.tvk-map-tiles{position:absolute;inset:0}
.tvk-map-tile{position:absolute;left:0;top:0;width:256px;height:256px;max-width:none;pointer-events:none;user-select:none;transition:opacity .15s}
.tvk-map-pin{position:absolute;width:22px;height:22px;margin:-26px 0 0 -11px;border-radius:50% 50% 50% 0;background:#ff4d4d;border:2px solid #fff;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.55);pointer-events:none}
.tvk-map-pin::after{content:"";position:absolute;left:4px;top:4px;width:8px;height:8px;border-radius:50%;background:#fff}
.tvk-map-zoom{position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:4px}
.tvk-map-zoom button{width:28px;height:28px;padding:0;border:1px solid rgba(255,255,255,.35);background:rgba(20,22,26,.92);color:#fff;font:600 16px/1 system-ui;border-radius:4px;cursor:pointer}
.tvk-map-zoom button:hover{border-color:#5cc4d1}
.tvk-map-hint{position:absolute;left:6px;bottom:20px;padding:1px 6px;font-size:11px;background:rgba(20,22,26,.78);border-radius:3px;pointer-events:none}
.tvk-map-attrib{position:absolute;right:4px;bottom:2px;padding:0 5px;font-size:10px;background:rgba(255,255,255,.78);color:#333;border-radius:3px;pointer-events:none}
.tvk-place-box{width:min(640px,calc(100% - 24px));max-height:calc(100% - 24px);overflow:auto;padding:16px 18px;background:#1b2027;border:1px solid #5cc4d1;border-radius:6px;box-shadow:0 8px 32px rgba(0,0,0,.5)}
.tvk-place-box h3{margin:0 0 6px;font-size:15px}
.tvk-place-box .tvk-sub{margin:0 0 10px;font-size:12px;color:rgba(232,237,240,.65);overflow-wrap:anywhere}
.tvk-place-box fieldset{margin:0 0 10px;padding:8px 10px 10px;border:1px solid rgba(255,255,255,.18);border-radius:4px}
.tvk-place-box legend{padding:0 6px;font-size:12px;color:#7fd3de}
.tvk-form{display:grid;grid-template-columns:110px 1fr;gap:6px 10px;align-items:center}
.tvk-form label{color:rgba(232,237,240,.8)}
.tvk-form input,.tvk-form select{min-width:0;padding:4px 8px;background:#14191d;color:inherit;border:1px solid #2b353c;border-radius:3px;font:inherit}
.tvk-hintline{margin:6px 0 0;font-size:12px;min-height:1.4em;overflow-wrap:anywhere}
.tvk-hintline.ok{color:#7fe0a0}.tvk-hintline.warn{color:#ffd166}.tvk-hintline.bad{color:#ff8a80}
.tvk-detected{margin:0 0 10px;padding:8px 10px;border:1px solid #7fe0a0;border-radius:4px;background:rgba(40,90,60,.25)}
.tvk-textarea{display:block;width:100%;height:260px;margin:0 0 8px;padding:8px;background:#0f1318;color:#cfe7ea;border:1px solid #2b353c;border-radius:4px;font:12px/1.4 ui-monospace,Consolas,monospace;resize:vertical;box-sizing:border-box}
.tvk-place-foot{position:sticky;bottom:-16px;margin:0 -18px -16px;padding:8px 18px 12px;background:#1b2027;border-top:1px solid rgba(255,255,255,.12)}
.tvk-place-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:4px}
.tvk-place-note{margin:8px 0 0;font-size:11px;color:rgba(232,237,240,.55);text-align:right}
.tvk-attrib{position:absolute;left:50%;bottom:2px;transform:translateX(-50%);z-index:4;font-size:10px;color:rgba(232,237,240,.7);background:rgba(20,22,26,.6);padding:0 6px;border-radius:3px;pointer-events:none;white-space:nowrap}
.tvk-btn{padding:6px 12px;border:1px solid rgba(255,255,255,.28);background:rgba(20,22,26,.88);color:#fff;font:inherit;cursor:pointer;border-radius:4px}
.tvk-btn:hover{border-color:#5cc4d1}
.tvk-btn[aria-pressed="true"]{background:#2f8fd8;border-color:#2f8fd8}
.tvk-btn:focus-visible{outline:2px solid #5cc4d1;outline-offset:2px}
.tvk-status{position:absolute;left:12px;bottom:12px;z-index:5;max-width:calc(100% - 24px);padding:5px 10px;background:rgba(20,22,26,.88);border:1px solid rgba(255,255,255,.2);border-radius:4px}
.tvk-status[data-kind="error"]{border-color:#e5645a;color:#ffb4ad}
.tvk-status[data-kind="busy"]{border-color:#5cc4d1}
.tvk-br{position:absolute;right:12px;bottom:12px;z-index:6;display:flex;flex-direction:column;align-items:flex-end;gap:6px;pointer-events:none;max-width:calc(100% - 24px)}
.tvk-minimap-slot .minimap{pointer-events:auto}
.tvk-hint{padding:4px 9px;background:rgba(20,22,26,.88);border:1px solid rgba(255,255,255,.2);border-radius:4px;color:#e8edf0;font-size:12px;line-height:1.5;text-align:right;max-width:360px;pointer-events:none}
.tvk-hint:empty{display:none}
.tvk-info{position:absolute;top:12px;right:12px;width:310px;max-height:calc(100% - 300px);overflow:auto;z-index:5;background:rgba(20,22,26,.92);border:1px solid rgba(255,255,255,.2);border-radius:4px}
.tvk-info summary{padding:8px 12px;cursor:pointer;font-weight:600;list-style:none}
.tvk-info summary::-webkit-details-marker{display:none}
.tvk-info summary::after{content:"▾";float:right;opacity:.6}
.tvk-info:not([open]) summary::after{content:"▸"}
.tvk-compass i,.tvk-compass b{pointer-events:none}
.tvk-sec{padding:6px 12px 8px;border-top:1px solid rgba(255,255,255,.12)}
.tvk-sec h4{margin:0 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7fd3de;font-weight:600}
.tvk-row{display:flex;gap:8px;justify-content:space-between;padding:1px 0}
.tvk-row span:first-child{color:rgba(232,237,240,.65);flex:none}
.tvk-row span:last-child{text-align:right;overflow-wrap:anywhere;min-width:0}
.tvk-ok{color:#7fe0a0}.tvk-warn{color:#ffd166}.tvk-bad{color:#ff8a80}.tvk-dim{color:rgba(232,237,240,.5)}
.tvk-note{margin:4px 0 0;font-size:12px;color:#ffd166;overflow-wrap:anywhere}
.tvk-drop{position:absolute;inset:0;z-index:9;display:none;align-items:center;justify-content:center;border:2px dashed #5cc4d1;background:rgba(15,40,50,.72);font-size:16px;pointer-events:none}
.tvk-root[data-dragging="true"] .tvk-drop{display:flex}
.tvk-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;color:rgba(232,237,240,.55);padding:0 24px;pointer-events:none}
.tvk-pointer-row{display:flex;align-items:center;gap:8px;pointer-events:none}
.tvk-compass{position:relative;width:48px;height:48px;border-radius:50%;background:rgba(20,22,26,.88);border:1px solid rgba(255,255,255,.28);flex:none;pointer-events:auto;cursor:pointer}
.tvk-compass i{position:absolute;left:50%;top:3px;margin-left:-5px;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:12px solid #ff5555;transform-origin:50% 21px}
.tvk-compass b{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#ff5555;font-size:12px;line-height:1}
.tvk-readout{padding:3px 8px;background:rgba(20,22,26,.88);border:1px solid rgba(255,255,255,.2);border-radius:4px;font:11px/1.4 ui-monospace,Consolas,monospace;white-space:pre;color:#e8edf0}
.tvk-popup{position:absolute;z-index:8;padding:6px 10px;background:rgba(20,22,26,.94);border:1px solid rgba(255,255,255,.28);border-radius:4px;font-size:12px;line-height:1.5;white-space:pre-wrap;max-width:280px;pointer-events:none;transform:translate(-50%,-112%);overflow-wrap:anywhere}
@media (max-width:700px){.tvk-root .minimap{display:none!important}.tvk-info{left:12px;right:12px;width:auto;top:auto;bottom:52px;max-height:42%}.tvk-left{max-width:calc(100% - 24px)}.tvk-hint{display:none}}
`;

export function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * @param {HTMLElement} container
 * @param {{ onOpenFolder?: ()=>void, onReset: ()=>void, onToggleMeasure: (on:boolean)=>void, onClearMeasure: ()=>void }} handlers
 */
export function createKitUi(container, handlers) {
  injectStyle();
  const root = el('div', 'tvk-root');
  const canvasHost = el('div', 'tvk-canvas');
  const empty = el('div', 'tvk-empty', '타일셋(폴더) 또는 glb 모델을 불러오면 여기에 표시됩니다. 폴더나 glb 파일을 이 화면에 끌어다 놓아도 됩니다.');
  const toolbar = el('div', 'tvk-toolbar');
  const status = el('div', 'tvk-status', '준비됨');
  const hint = el('div', 'tvk-hint');
  const info = el('details', 'tvk-info');
  const drop = el('div', 'tvk-drop', '타일셋 폴더 또는 glb 파일을 놓으면 열립니다');
  info.open = true;
  info.hidden = true;
  info.appendChild(el('summary', null, '타일셋 정보'));
  const infoBody = el('div');
  info.appendChild(infoBody);

  function button(label, onClick, pressed) {
    const b = el('button', 'tvk-btn', label);
    b.type = 'button';
    if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', (e) => {
      onClick(e);
      b.blur(); // 키보드 입력(스페이스 등)이 버튼 재클릭으로 해석되지 않게
    });
    return b;
  }

  const buttons = {};
  if (handlers.onOpenFolder) {
    buttons.open = button('폴더 열기', handlers.onOpenFolder);
    toolbar.appendChild(buttons.open);
  }
  if (handlers.onOpenGlb) {
    buttons.glb = button('glb 열기', handlers.onOpenGlb);
    buttons.glb.title = 'glb 모델 파일 한 개를 열어 좌표를 입력해 배치하거나 단일 모델로 봅니다';
    toolbar.appendChild(buttons.glb);
  }
  buttons.reset = button('처음 시점', handlers.onReset);
  buttons.measure = button('거리재기', () => {
    const next = buttons.measure.getAttribute('aria-pressed') !== 'true';
    buttons.measure.setAttribute('aria-pressed', String(next));
    handlers.onToggleMeasure(next);
  }, false);
  buttons.clear = button('측정 지우기', handlers.onClearMeasure);
  buttons.annotate = button('메모 추가', () => {
    const next = buttons.annotate.getAttribute('aria-pressed') !== 'true';
    handlers.onToggleAnnotate(next);
  }, false);
  buttons.clearAnnotations = button('메모 지우기', handlers.onClearAnnotations);
  buttons.shot = button('스크린샷', handlers.onScreenshot);
  buttons.minimap = button('미니맵', () => {
    const next = buttons.minimap.getAttribute('aria-pressed') !== 'true';
    handlers.onToggleMinimap(next);
  }, handlers.minimapOn !== false);
  buttons.walk = button('체험(걷기)', () => {
    const next = buttons.walk.getAttribute('aria-pressed') !== 'true';
    handlers.onToggleWalk?.(next);
  }, false);
  buttons.walk.title = '시작 위치를 고르면 1인칭으로 걸어 다닙니다 (Tab: 1인칭/항공 전환, 항공: Space 위·Shift 아래, Esc: 종료)';
  buttons.layers = button('레이어', () => {
    const next = buttons.layers.getAttribute('aria-pressed') !== 'true';
    buttons.layers.setAttribute('aria-pressed', String(next));
    layers.hidden = !next;
  }, false);
  buttons.edit = button('모델 편집', () => {
    const next = buttons.edit.getAttribute('aria-pressed') !== 'true';
    setEditOpen(next);
  }, false);
  buttons.edit.hidden = true;
  buttons.edit.title = '배치한 모델의 위치·높이·각도·크기를 고칩니다';
  // 순서는 GIS 페이지(gis/)와 비슷하게: 열기 -> 배경 지도(레이어) -> 재기 -> 처음 시점 -> 스크린샷, 그 뒤에 이 페이지에만 있는 것들
  toolbar.append(
    buttons.layers, buttons.measure, buttons.clear, buttons.reset, buttons.shot,
    buttons.annotate, buttons.clearAnnotations, buttons.edit, buttons.walk, buttons.minimap,
  );

  // ---- 레이어 패널: 타일셋 / 배경 지도 / 메모 표시 켜고 끄기 + 배경 지도 설정 ----
  const layers = el('div', 'tvk-layers');
  layers.hidden = true;
  layers.appendChild(el('h4', null, '레이어'));
  const checks = {};
  function layerCheck(key, label, onChange) {
    const row = el('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.addEventListener('change', () => onChange(box.checked));
    row.append(box, el('span', null, label));
    checks[key] = box;
    return row;
  }
  const onVisible = (key) => (on) => handlers.onLayerVisible?.(key, on);
  layers.appendChild(layerCheck('tileset', '타일셋 / 모델', onVisible('tileset')));
  layers.appendChild(layerCheck('basemap', '배경 지도', onVisible('basemap')));

  const bm = el('div', 'tvk-bm');
  const providerSel = document.createElement('select');
  providerSel.setAttribute('aria-label', '배경 지도 종류');
  for (const [value, label] of [['none', '쓰지 않음'], ...Object.entries(PROVIDERS).map(([k, p]) => [k, p.label])]) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    providerSel.appendChild(o);
  }
  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.placeholder = 'API 키';
  keyInput.autocomplete = 'off';
  keyInput.setAttribute('aria-label', '배경 지도 API 키');
  keyInput.hidden = true;
  const applyBtn = button('적용', () => applyBasemap());
  const providerRow = el('div', 'tvk-bm-row');
  providerRow.append(providerSel, applyBtn);
  const heightRow = el('label');
  const heightInput = document.createElement('input');
  heightInput.type = 'number';
  heightInput.step = '1';
  heightInput.setAttribute('aria-label', '지도 높이(m)');
  heightInput.addEventListener('change', () => {
    const v = Number(heightInput.value);
    if (Number.isFinite(v)) handlers.onBasemapHeight?.(v);
  });
  heightRow.append(el('span', null, '지도 높이(m)'), heightInput);
  const bmMsg = el('small');
  const diagBtn = button('진단 정보 복사', () => handlers.onCopyDiagnostics?.());
  diagBtn.title = '화면이 이상할 때 원인을 찾기 위한 정보(GPU, 카메라, 배경 지도 상태)를 복사합니다. API 키는 포함되지 않습니다.';
  bm.append(providerRow, keyInput, heightRow, bmMsg, diagBtn);
  layers.appendChild(bm);
  layers.appendChild(layerCheck('memos', '메모', onVisible('memos')));

  const providerNeedsKey = () => !!PROVIDERS[providerSel.value]?.needsKey;
  providerSel.addEventListener('change', () => {
    keyInput.hidden = !providerNeedsKey();
    if (providerSel.value === 'none') applyBasemap();
  });
  function applyBasemap() {
    handlers.onBasemapApply?.({ provider: providerSel.value, apiKey: keyInput.value.trim() });
  }
  keyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyBasemap();
  });

  // ---- 모델 편집 패널: 배치한 glb의 위치·높이·각도·크기를 즉시 고친다 ----
  const edit = el('div', 'tvk-edit');
  edit.hidden = true;
  edit.appendChild(el('h4', null, '모델 편집'));

  function numberInput({ step = 'any', min, max, width } = {}) {
    const i = document.createElement('input');
    i.type = 'number';
    i.step = String(step);
    if (min != null) i.min = String(min);
    if (max != null) i.max = String(max);
    if (width) i.style.width = width;
    return i;
  }
  const editRow = (label, ...controls) => {
    const r = el('div', 'tvk-edit-row');
    r.append(el('label', null, label), ...controls);
    return r;
  };

  // 위치 (geo 모델에서만)
  const editGeo = el('div', 'tvk-edit-geo');
  const stepSel = document.createElement('select');
  stepSel.setAttribute('aria-label', '이동 단위');
  for (const v of [0.1, 1, 10, 100]) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = `${v} m`;
    if (v === 1) o.selected = true;
    stepSel.appendChild(o);
  }
  const stepM = () => Number(stepSel.value);
  const pad = el('div', 'tvk-pad');
  const padBtn = (label, title, dx, dy, cls) => {
    const b = button(label, () => handlers.onEditNudge?.(dx * stepM(), dy * stepM()));
    b.title = title;
    b.classList.add(cls);
    return b;
  };
  pad.append(
    padBtn('▲', '북쪽으로', 0, 1, 'tvk-pad-n'),
    padBtn('◀', '서쪽으로', -1, 0, 'tvk-pad-w'),
    padBtn('▶', '동쪽으로', 1, 0, 'tvk-pad-e'),
    padBtn('▼', '남쪽으로', 0, -1, 'tvk-pad-s'),
  );
  const posRead = el('div', 'tvk-edit-read');
  const moveRow = el('div', 'tvk-edit-row');
  moveRow.append(el('label', null, '이동'), pad);
  const stepRow = editRow('이동 단위', stepSel);
  const mapBtn = button('지도에서 다시 선택', () => handlers.onEditPickOnMap?.());
  const dragBtn = button('모델을 끌어서 이동', () => {
    const next = dragBtn.getAttribute('aria-pressed') !== 'true';
    handlers.onEditDragToggle?.(next);
  }, false);
  dragBtn.title = '켜면 화면에서 모델을 마우스로 끌어 옮길 수 있습니다 (지도 이동은 모델 밖에서)';
  const heightIn = numberInput({ step: 0.1 });
  const hMinus = button('−', () => handlers.onEditChange?.({ height: Number(heightIn.value || 0) - stepM() }));
  const hPlus = button('+', () => handlers.onEditChange?.({ height: Number(heightIn.value || 0) + stepM() }));
  hMinus.title = hPlus.title = '이동 단위만큼 낮추기/높이기';
  editGeo.append(posRead, moveRow, stepRow, el('div', 'tvk-edit-btnrow'), editRow('높이 (m)', hMinus, heightIn, hPlus));
  editGeo.children[3].append(mapBtn, dragBtn);

  // 각도·크기 (모든 모델)
  const headingRange = document.createElement('input');
  headingRange.type = 'range';
  headingRange.min = '-180';
  headingRange.max = '180';
  headingRange.step = '1';
  headingRange.setAttribute('aria-label', '방향 슬라이더');
  const headingIn = numberInput({ step: 1, width: '64px' });
  const pitchIn = numberInput({ step: 1, min: -180, max: 180 });
  const rollIn = numberInput({ step: 1, min: -180, max: 180 });
  const scaleIn2 = numberInput({ step: 0.01, min: 0.0001 });
  const hdgBtn = (label, d) => {
    const b = button(label, () => handlers.onEditChange?.({ headingDeg: Number(headingIn.value || 0) + d }));
    b.title = `${d > 0 ? '+' : ''}${d}°`;
    return b;
  };
  const headingRow = editRow('방향 (°)', headingRange, headingIn);
  const headingBtns = el('div', 'tvk-edit-btnrow');
  headingBtns.append(hdgBtn('−15°', -15), hdgBtn('−1°', -1), hdgBtn('+1°', 1), hdgBtn('+15°', 15));
  const tiltNote = el('div', 'tvk-edit-note', '기울기: 앞뒤 + 는 북쪽이 올라가고, 좌우 + 는 동쪽이 올라갑니다 (방향을 돌리면 모델과 함께 돕니다).');
  const resetBtn = button('처음 값으로', () => handlers.onEditReset?.());
  const closeBtn = button('닫기', () => setEditOpen(false));
  const editFoot = el('div', 'tvk-edit-btnrow');
  editFoot.append(resetBtn, closeBtn);
  edit.append(
    editGeo,
    headingRow, headingBtns,
    editRow('앞뒤 기울기 (°)', pitchIn),
    editRow('좌우 기울기 (°)', rollIn),
    tiltNote,
    editRow('크기 배율', scaleIn2),
    editFoot,
  );

  const patchFrom = (key, input) => () => {
    const v = Number(input.value);
    if (input.value.trim() !== '' && Number.isFinite(v)) handlers.onEditChange?.({ [key]: v });
  };
  heightIn.addEventListener('input', patchFrom('height', heightIn));
  headingIn.addEventListener('input', patchFrom('headingDeg', headingIn));
  headingRange.addEventListener('input', () => handlers.onEditChange?.({ headingDeg: Number(headingRange.value) }));
  pitchIn.addEventListener('input', patchFrom('pitchDeg', pitchIn));
  rollIn.addEventListener('input', patchFrom('rollDeg', rollIn));
  scaleIn2.addEventListener('input', () => {
    const v = Number(scaleIn2.value);
    if (v > 0 && Number.isFinite(v)) handlers.onEditChange?.({ scale: v });
  });

  // 칸을 벗어날 때 잘못된 값(빈 칸, 0 이하 배율 등)이 남아 있으면 실제 적용된 값으로 되돌린다
  for (const i of [heightIn, headingIn, pitchIn, rollIn, scaleIn2]) {
    i.addEventListener('change', () => setTimeout(() => handlers.onEditChange?.({}), 0));
  }

  function setEditOpen(on) {
    buttons.edit.setAttribute('aria-pressed', String(on));
    edit.hidden = !on;
    if (!on && dragBtn.getAttribute('aria-pressed') === 'true') handlers.onEditDragToggle?.(false);
  }

  const left = el('div', 'tvk-left');
  left.append(toolbar, layers, edit);
  const attrib = el('div', 'tvk-attrib');
  attrib.hidden = true;

  // 나침반 + 마우스 위치 좌표 (geo 모드에서만 나침반을 보여준다)
  const compass = el('div', 'tvk-compass');
  compass.title = '더블클릭: 북쪽 보기';
  compass.addEventListener('dblclick', () => handlers.onCompassDblClick?.());
  const needle = el('i');
  compass.append(needle, el('b', null, 'N'));
  const readout = el('div', 'tvk-readout', '마우스 위치: -');
  // 우측 하단 묶음: 미니맵 -> 나침반 -> 도움말 글자 (위에서 아래로). 서로 겹치지 않고 도움말을 가리지 않는다.
  const minimapSlot = el('div', 'tvk-minimap-slot');
  const br = el('div', 'tvk-br');
  const pointerRow = el('div', 'tvk-pointer-row'); // 마우스 위치는 나침반 왼쪽
  pointerRow.append(readout, compass);
  br.append(minimapSlot, pointerRow, hint);
  const popup = el('div', 'tvk-popup');
  popup.hidden = true;

  // ---- 확인 대화상자 (컨테이너 안에만 그린다. window.confirm은 임베드한 페이지 전체를 막고 모양을 못 바꾼다) ----
  const dialog = el('div', 'tvk-dialog');
  dialog.hidden = true;
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'true');
  const dialogBox = el('div', 'tvk-dialog-box');
  const dialogText = el('p');
  const dialogActions = el('div', 'tvk-dialog-actions');
  const dialogCancel = button('취소', () => closeDialog(false));
  const dialogOk = button('계속', () => closeDialog(true));
  dialogOk.classList.add('tvk-btn-danger');
  dialogActions.append(dialogCancel, dialogOk);
  dialogBox.append(dialogText, dialogActions);
  dialog.appendChild(dialogBox);
  let dialogResolve = null;
  let dialogReturnFocus = null;
  function closeDialog(result) {
    const resolve = dialogResolve;
    dialogResolve = null;
    dialog.hidden = true;
    dialogReturnFocus?.focus?.();
    dialogReturnFocus = null;
    resolve?.(result);
  }
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation(); // 도구 끄기(Esc) 처리로 번지지 않게
      closeDialog(false);
    } else if (e.key === 'Tab') {
      // 대화상자 밖으로 포커스가 나가지 않게 두 버튼 사이에서만 돈다
      e.preventDefault();
      (document.activeElement === dialogCancel ? dialogOk : dialogCancel).focus();
    }
  });

  // ---- glb 위치 정하기 대화상자 ----
  const place = el('div', 'tvk-dialog');
  place.hidden = true;
  place.setAttribute('role', 'dialog');
  place.setAttribute('aria-modal', 'true');
  let placeResolve = null;
  let placeReturnFocus = null;
  let activePicker = null;
  function closePlace(result) {
    const resolve = placeResolve;
    placeResolve = null;
    activePicker?.destroy();
    activePicker = null;
    place.hidden = true;
    place.replaceChildren();
    placeReturnFocus?.focus?.();
    placeReturnFocus = null;
    resolve?.(result);
  }
  place.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePlace(null);
    }
  });

  /** 숫자 입력칸 값 읽기. 비어 있으면 NaN */
  const num = (input) => (input.value.trim() === '' ? NaN : Number(input.value));

  /**
   * glb 위치를 사용자가 정하는 대화상자.
   * @param {{
   *   fileName: string,
   *   details?: string[],                    파일에서 읽은 정보(삼각형 수, 크기, 압축 등)
   *   warnings?: string[],
   *   detected?: {label:string, spec:object}|null,   파일에 위치 정보가 있을 때의 자동 판별 결과
   * }} o
   * @returns {Promise<object|null>} 배치 명세(modelPlacement.js의 PlacementSpec) 또는 취소 시 null
   */
  function askPlacement({ fileName, details = [], warnings = [], detected = null, map = null }) {
    if (placeResolve) closePlace(null);
    placeReturnFocus = document.activeElement;
    place.replaceChildren();
    const box = el('div', 'tvk-place-box');
    box.append(el('h3', null, `glb 위치 정하기`));
    box.append(el('p', 'tvk-sub', `${fileName}${details.length ? ' · ' + details.join(' · ') : ''}`));
    for (const w of warnings) box.append(el('p', 'tvk-hintline warn', w));

    // 모든 경우에 공통인 모양 설정 (단일 모델 보기에도 적용된다)
    const shape = el('fieldset');
    shape.append(el('legend', null, '모델 모양'));
    const shapeForm = el('div', 'tvk-form');
    const upSel = document.createElement('select');
    for (const [v, l] of [['Y', 'Y축이 위 (glTF 표준)'], ['Z', 'Z축이 위 (GIS/CAD에서 흔함)']]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = l;
      upSel.appendChild(o);
    }
    const headingIn = document.createElement('input');
    headingIn.type = 'number';
    headingIn.step = 'any';
    headingIn.value = '0';
    const scaleIn = document.createElement('input');
    scaleIn.type = 'number';
    scaleIn.step = 'any';
    scaleIn.value = '1';
    shapeForm.append(
      el('label', null, '위쪽 축'), upSel,
      el('label', null, '방향 (°, 시계)'), headingIn,
      el('label', null, '크기 배율'), scaleIn,
    );
    shape.appendChild(shapeForm);
    // 모델 단위 빠른 선택: 파일 단위가 mm/cm인 모델은 배율 0.001/0.01로 줄여야 m 크기가 된다
    const unitRow = el('div', 'tvk-sub', '파일 단위: ');
    for (const [label, v] of [['m (그대로)', 1], ['cm', 0.01], ['mm', 0.001]]) {
      const b = button(label, () => {
        scaleIn.value = String(v);
        scaleIn.dispatchEvent(new Event('input'));
      });
      b.type = 'button';
      unitRow.appendChild(b);
    }
    shape.appendChild(unitRow);

    const readShape = () => ({ upAxis: upSel.value, headingDeg: num(headingIn), scale: num(scaleIn) });
    const shapeError = () => {
      const s = readShape();
      if (!Number.isFinite(s.headingDeg)) return '방향은 숫자(도)로 입력하세요.';
      if (!(s.scale > 0) || !Number.isFinite(s.scale)) return '크기 배율은 0보다 큰 숫자여야 합니다. (단위가 mm면 0.001)';
      return null;
    };

    const errLine = el('p', 'tvk-hintline');

    // 1) 파일에 위치가 있는 경우
    // detected: 한 개 또는 여러 개({label, spec}). 여러 개면 첫 번째가 가장 유력한 추천이다.
    const suggestions = detected ? (Array.isArray(detected) ? detected : [detected]) : [];
    if (suggestions.length) {
      const first = suggestions[0].spec;
      if (first.upAxis) upSel.value = first.upAxis;
      if (first.scale) scaleIn.value = String(first.scale);
      const d = el('div', 'tvk-detected');
      const multi = suggestions.length > 1 || (suggestions[0].alternatives?.length ?? 0) > 1;
      d.append(el('div', null, multi ? '파일에서 위치 정보를 찾았습니다. 추천 위치:' : `파일에서 위치 정보를 찾았습니다: ${suggestions[0].label}`));
      d.append(el('div', 'tvk-sub', '자동 판별은 틀릴 수 있습니다. 위치가 이상하면 아래에서 지도를 클릭하거나 좌표를 직접 입력하세요.'));
      suggestions.forEach((s, i) => {
        const alts = s.alternatives ?? [];
        const preview = el('div', 'tvk-sub', s.label);
        if (multi) d.append(preview);
        if (alts.length > 1) {
          // 5185/5186/5187은 같은 숫자라도 위치가 다르다. 기본은 5186이고, 바꾸면 미리보기와 지도 핀이 따라 움직인다.
          const sel = document.createElement('select');
          for (const a of alts) {
            const o = document.createElement('option');
            o.value = a.crs;
            o.textContent = `${a.label} — 경도 ${a.lon.toFixed(3)}, 위도 ${a.lat.toFixed(3)}`;
            sel.appendChild(o);
          }
          sel.value = s.spec.crs;
          sel.setAttribute('aria-label', '파일 안 좌표의 좌표계');
          sel.addEventListener('change', () => {
            const a = alts.find((x) => x.crs === sel.value);
            if (!a) return;
            s.spec = { ...s.spec, crs: a.crs };
            preview.textContent = `${a.label} 좌표로 읽기 → 경도 ${a.lon.toFixed(5)}, 위도 ${a.lat.toFixed(5)} (중심 높이 ${a.elev.toFixed(1)} m)`;
            picker?.setMarker({ lon: a.lon, lat: a.lat });
          });
          d.append(el('div', 'tvk-sub', '같은 숫자라도 서부·중부·동부원점(5185/5186/5187)에 따라 위치가 달라집니다. 지도에서 맞는 곳인지 보고 고르세요.'), sel);
        }
        const useBtn = button(i === 0 ? '이 위치로 배치' : '이 좌표계로 읽어 배치', () => {
          if (s.spec.upAxis) upSel.value = s.spec.upAxis;
          if (s.spec.scale) scaleIn.value = String(s.spec.scale);
          const err = shapeError();
          if (err) return showError(err);
          closePlace({ ...s.spec, ...readShape() });
        });
        if (i === 0) useBtn.classList.add('tvk-btn-primary');
        d.appendChild(useBtn);
      });
      box.append(d);
    }

    // 2) 위치: 지도에서 클릭하거나, 좌표를 입력한다 (둘은 서로 값을 맞춰 준다)
    const coord = el('fieldset');
    coord.append(el('legend', null, map ? '위치 — 지도를 클릭하거나 좌표를 입력' : '좌표 입력으로 배치'));
    const form = el('div', 'tvk-form');
    const crsSel = document.createElement('select');
    for (const c of CRS_LIST) {
      const o = document.createElement('option');
      o.value = c.code;
      o.textContent = c.label;
      crsSel.appendChild(o);
    }
    crsSel.value = DEFAULT_CRS;
    const xLabel = el('label');
    const yLabel = el('label');
    const xIn = document.createElement('input');
    const yIn = document.createElement('input');
    const hIn = document.createElement('input');
    for (const i of [xIn, yIn, hIn]) {
      i.type = 'number';
      i.step = 'any';
    }
    hIn.value = '0';
    form.append(
      el('label', null, '좌표계'), crsSel,
      xLabel, xIn,
      yLabel, yIn,
      el('label', null, '높이 (m)'), hIn,
    );
    let picker = null;
    if (map) {
      picker = createMapPicker({
        provider: map.provider,
        center: map.center,
        zoom: map.zoom ?? 7,
        onPick: (ll) => {
          lastSource = 'map';
          pickedLL = ll;
          fillFromLonLat(ll);
        },
      });
      coord.appendChild(picker.element);
      activePicker = picker;
    }
    coord.appendChild(form);
    const hint = el('p', 'tvk-hintline');
    coord.appendChild(hint);
    coord.append(el('p', 'tvk-sub', '높이는 타원체고 기준입니다. 표고(해발고)와는 한국에서 수십 m 차이가 날 수 있어, 지도에 얹을 때 높이가 어긋나면 이 값을 조정하세요.'));
    box.append(coord, shape);

    // 마지막으로 위치를 바꾼 쪽: 'map'이면 좌표계를 바꿀 때 같은 지점을 새 좌표계 값으로 환산하고,
    // 'typed'면(좌표계를 잘못 골랐다가 고치는 경우) 입력한 숫자를 새 좌표계로 다시 해석한다.
    let lastSource = null;
    let pickedLL = null;

    /** 경위도를 현재 좌표계의 X/Y 칸에 채운다 */
    function fillFromLonLat(ll) {
      const c = getCrs(crsSel.value);
      const p = fromLonLat(crsSel.value, ll.lon, ll.lat);
      xIn.value = p.x.toFixed(c.geographic ? 6 : 2);
      yIn.value = p.y.toFixed(c.geographic ? 6 : 2);
      refreshHint();
      errLine.textContent = '';
    }

    /** 입력칸의 숫자를 해석해 지도의 핀을 맞춘다 */
    function syncMarkerFromInputs() {
      const x = num(xIn);
      const y = num(yIn);
      if (!picker || !Number.isFinite(x) || !Number.isFinite(y)) return;
      try {
        const ll = toLonLat(crsSel.value, x, y);
        if (isValidLonLat(ll)) {
          pickedLL = ll;
          picker.setMarker(ll);
        }
      } catch {
        /* 해석할 수 없는 값이면 핀은 그대로 */
      }
    }

    function refreshLabels() {
      const c = getCrs(crsSel.value);
      xLabel.textContent = c.xLabel;
      yLabel.textContent = c.yLabel;
      xIn.placeholder = c.geographic ? '예: 126.978' : '예: 953901.17';
      yIn.placeholder = c.geographic ? '예: 37.5665' : '예: 1952032.08';
    }
    function refreshHint() {
      hint.className = 'tvk-hintline';
      const x = num(xIn);
      const y = num(yIn);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        hint.textContent = '';
        return;
      }
      try {
        const ll = toLonLat(crsSel.value, x, y);
        if (!isValidLonLat(ll)) {
          hint.textContent = `경위도 범위를 벗어났습니다 (${ll.lon.toFixed(3)}, ${ll.lat.toFixed(3)}). 좌표계를 확인하세요.`;
          hint.classList.add('bad');
        } else if (!isNearKorea(ll)) {
          hint.textContent = `경도 ${ll.lon.toFixed(6)}, 위도 ${ll.lat.toFixed(6)} — 한국 주변이 아닙니다. 좌표계가 맞는지 확인하세요.`;
          hint.classList.add('warn');
        } else {
          hint.textContent = `경도 ${ll.lon.toFixed(6)}, 위도 ${ll.lat.toFixed(6)}`;
          hint.classList.add('ok');
        }
      } catch (e) {
        hint.textContent = e.message;
        hint.classList.add('bad');
      }
    }
    function showError(msg) {
      errLine.textContent = msg;
      errLine.className = 'tvk-hintline bad';
    }
    crsSel.addEventListener('change', () => {
      refreshLabels();
      if (lastSource === 'map' && pickedLL) {
        fillFromLonLat(pickedLL); // 같은 지점을 새 좌표계 값으로
      } else {
        refreshHint(); // 입력한 숫자를 새 좌표계로 다시 해석
        syncMarkerFromInputs();
      }
    });
    for (const i of [xIn, yIn]) {
      i.addEventListener('input', () => {
        lastSource = 'typed';
        refreshHint();
        syncMarkerFromInputs();
      });
    }
    // 값을 고치면 이전에 나온 오류 문구는 지운다
    for (const i of [xIn, yIn, hIn, headingIn, scaleIn, upSel, crsSel]) {
      i.addEventListener('input', () => {
        errLine.textContent = '';
      });
      i.addEventListener('change', () => {
        errLine.textContent = '';
      });
    }
    refreshLabels();

    // 3) 버튼
    const actions = el('div', 'tvk-place-actions');
    const cancelBtn = button('취소', () => closePlace(null));
    const singleBtn = button('좌표 없이 단일 모델로 보기', () => {
      const err = shapeError();
      if (err) return showError(err);
      closePlace({ type: 'single', ...readShape() });
    });
    singleBtn.title = '지도와 좌표 표시 없이 모델만 탐색합니다 (현재 화면의 내용은 이 모델로 바뀝니다)';
    const placeBtn = button('이 위치에 배치', () => {
      const err = shapeError();
      if (err) return showError(err);
      const x = num(xIn);
      const y = num(yIn);
      const height = num(hIn);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return showError(map ? '지도를 클릭해서 위치를 정하거나, X(경도)와 Y(위도)를 입력하세요.' : 'X(경도)와 Y(위도)를 입력하세요.');
      }
      if (!Number.isFinite(height)) return showError('높이를 숫자로 입력하세요.');
      try {
        const ll = toLonLat(crsSel.value, x, y);
        if (!isValidLonLat(ll)) return showError('좌표가 경위도 범위를 벗어났습니다. 좌표계를 확인하세요.');
      } catch (e) {
        return showError(e.message);
      }
      closePlace({ type: 'coords', crs: crsSel.value, x, y, height, ...readShape() });
    });
    placeBtn.classList.add('tvk-btn-primary');
    actions.append(cancelBtn, singleBtn, placeBtn);
    // 화면이 낮아 대화상자가 스크롤될 때도 버튼이 항상 보이도록 아래에 붙인다
    const foot = el('div', 'tvk-place-foot');
    foot.append(errLine, actions, el('p', 'tvk-place-note', '단일 모델 보기는 배경 지도와 좌표 표시 없이 모델만 확인하는 모드입니다.'));
    box.append(foot);

    place.appendChild(box);
    place.hidden = false;
    picker?.refresh(); // 화면에 붙은 뒤의 실제 크기로 타일을 다시 계산
    const hint0 = suggestions[0];
    if (hint0 && Number.isFinite(hint0.lon) && Number.isFinite(hint0.lat)) picker?.setMarker({ lon: hint0.lon, lat: hint0.lat }); // 추천 위치를 지도에 미리 보여 준다
    (suggestions.length ? box.querySelector('.tvk-detected button') : (picker?.element ?? xIn)).focus();
    return new Promise((resolve) => {
      placeResolve = resolve;
    });
  }

  /**
   * 지도에서 위치 한 곳을 다시 고르는 작은 대화상자 (배치한 모델을 옮길 때).
   * @param {{map:{provider:object, center:{lon:number,lat:number}, zoom?:number}, marker?:{lon:number,lat:number}|null, title?:string}} o
   * @returns {Promise<{lon:number, lat:number}|null>} 취소하면 null
   */
  function askLocation({ map, marker = null, title = '모델 위치를 지도에서 다시 선택' }) {
    if (placeResolve) closePlace(null);
    placeReturnFocus = document.activeElement;
    place.replaceChildren();
    const box = el('div', 'tvk-place-box');
    box.append(el('h3', null, title));
    box.append(el('p', 'tvk-sub', '지도를 끌어서 이동하고 휠로 확대한 뒤, 모델을 둘 곳을 클릭하세요.'));
    let picked = marker ? { ...marker } : null;
    const readout = el('p', 'tvk-hintline');
    const okBtn = button('이 위치로 이동', () => closePlace(picked));
    okBtn.classList.add('tvk-btn-primary');
    okBtn.disabled = !picked;
    const picker = createMapPicker({
      provider: map.provider,
      center: map.center,
      zoom: map.zoom ?? 16,
      marker,
      onPick: (ll) => {
        picked = ll;
        readout.className = 'tvk-hintline ok';
        readout.textContent = `경도 ${ll.lon.toFixed(6)}, 위도 ${ll.lat.toFixed(6)}`;
        okBtn.disabled = false;
      },
    });
    activePicker = picker;
    const actions = el('div', 'tvk-place-actions');
    actions.append(button('취소', () => closePlace(null)), okBtn);
    box.append(picker.element, readout, actions);
    place.appendChild(box);
    place.hidden = false;
    picker.refresh();
    picker.element.focus();
    return new Promise((resolve) => {
      placeResolve = resolve;
    });
  }

  /**
   * 긴 글을 선택해서 복사할 수 있게 보여 주는 대화상자 (클립보드 복사가 막힌 환경의 대비책).
   * @param {{title:string, text:string, note?:string}} o
   */
  function showText({ title, text, note = '' }) {
    if (placeResolve) closePlace(null);
    placeReturnFocus = document.activeElement;
    place.replaceChildren();
    const box = el('div', 'tvk-place-box');
    box.append(el('h3', null, title));
    if (note) box.append(el('p', 'tvk-sub', note));
    const ta = document.createElement('textarea');
    ta.className = 'tvk-textarea';
    ta.readOnly = true;
    ta.value = text;
    ta.addEventListener('focus', () => ta.select());
    const actions = el('div', 'tvk-place-actions');
    const copy = button('다시 복사', async () => {
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = '복사됨';
      } catch {
        ta.focus();
        ta.select(); // 직접 Ctrl+C
      }
    });
    const close = button('닫기', () => closePlace(null));
    close.classList.add('tvk-btn-primary');
    actions.append(copy, close);
    box.append(ta, actions);
    place.appendChild(box);
    place.hidden = false;
    ta.focus();
    return new Promise((resolve) => {
      placeResolve = resolve;
    });
  }

  // ---- 로딩 오버레이: 폴더 읽기/타일셋 확인처럼 화면에 아직 아무 변화가 없는 준비 단계를 알린다 ----
  const busy = el('div', 'tvk-busy');
  busy.hidden = true;
  busy.setAttribute('role', 'status');
  busy.setAttribute('aria-live', 'polite');
  const busyBox = el('div', 'tvk-busy-box');
  const busyText = el('span', 'tvk-busy-text');
  busyBox.append(el('span', 'tvk-spinner'), busyText);
  busy.appendChild(busyBox);
  let busyTimer = null;
  const BUSY_DELAY_MS = 250; // 이보다 빨리 끝나는 로드에서는 깜빡이지 않게 늦게 보여준다

  const notice = el('div', 'tvk-notice');
  notice.hidden = true;
  let noticeTimer = null;
  root.append(canvasHost, empty, left, info, br, popup, status, attrib, notice, busy, drop, dialog, place);
  container.appendChild(root);

  return {
    root,
    canvasHost,
    minimapSlot,
    setStatus(text, kind = 'idle') {
      status.textContent = text;
      status.dataset.kind = kind;
    },
    setMeasurePressed(on) {
      buttons.measure.setAttribute('aria-pressed', String(on));
    },
    setAnnotatePressed(on) {
      buttons.annotate.setAttribute('aria-pressed', String(on));
    },
    setMinimapPressed(on) {
      buttons.minimap.setAttribute('aria-pressed', String(on));
    },
    setWalkPressed(on) {
      buttons.walk.setAttribute('aria-pressed', String(on));
    },
    /** @param {'tileset'|'basemap'|'memos'} key */
    setLayerChecked(key, on) {
      if (checks[key]) checks[key].checked = !!on;
    },
    /**
     * 배경 지도 설정 영역 갱신.
     * @param {{supported?:boolean, message?:string, provider?:string, apiKey?:string, height?:number|null}} s
     */
    setBasemapState(s) {
      if (s.provider !== undefined) {
        providerSel.value = s.provider;
        keyInput.hidden = !providerNeedsKey();
      }
      if (s.apiKey !== undefined) keyInput.value = s.apiKey;
      if (s.supported !== undefined) {
        providerSel.disabled = keyInput.disabled = applyBtn.disabled = heightInput.disabled = checks.basemap.disabled = !s.supported;
      }
      if (s.height !== undefined) heightInput.value = s.height == null ? '' : String(Math.round(s.height * 10) / 10);
      if (s.message !== undefined) bmMsg.textContent = s.message;
      if (s.detail !== undefined) bmMsg.title = s.detail;
    },
    /**
     * 로딩 오버레이를 켜거나(문구) 끈다(null). 이미 켜져 있으면 문구만 바꾼다.
     * 처음 켤 때는 BUSY_DELAY_MS 뒤에 보여서, 금방 끝나는 작업에서는 아예 보이지 않는다.
     * @param {string|null} text
     */
    setBusy(text) {
      if (text == null) {
        clearTimeout(busyTimer);
        busyTimer = null;
        busy.hidden = true;
        return;
      }
      busyText.textContent = text;
      if (!busy.hidden || busyTimer) return;
      busyTimer = setTimeout(() => {
        busyTimer = null;
        busy.hidden = false;
      }, BUSY_DELAY_MS);
    },
    isBusy() {
      return !busy.hidden || busyTimer != null;
    },
    /**
     * 확인 대화상자. 기본 포커스는 "취소"(실수로 Enter를 눌러도 안전한 쪽). 이미 열려 있으면 앞의 것은 취소로 닫는다.
     * @param {{message:string, okLabel?:string, cancelLabel?:string}} o
     * @returns {Promise<boolean>} 계속하면 true, 취소/Esc/닫힘이면 false
     */
    confirm({ message, okLabel = '계속', cancelLabel = '취소' }) {
      if (dialogResolve) closeDialog(false);
      dialogText.textContent = message;
      dialogOk.textContent = okLabel;
      dialogCancel.textContent = cancelLabel;
      dialogReturnFocus = document.activeElement;
      dialog.hidden = false;
      dialogCancel.focus();
      return new Promise((resolve) => {
        dialogResolve = resolve;
      });
    },
    /** 열려 있는 확인 대화상자를 취소로 닫는다 (다른 로드가 끼어들었을 때 등). */
    dismissConfirm() {
      if (dialogResolve) closeDialog(false);
      if (placeResolve) closePlace(null);
    },
    askPlacement,
    askLocation,
    showText,
    /**
     * 모델 편집 버튼/패널을 보이거나 숨긴다.
     * @param {boolean} on
     * @param {{geo?:boolean}} [o] geo가 false면(단일 모델) 위치·높이 칸을 숨긴다
     */
    setEditAvailable(on, { geo = true } = {}) {
      buttons.edit.hidden = !on;
      editGeo.hidden = !geo;
      if (!on) setEditOpen(false);
    },
    /** 편집 입력칸을 현재 값으로 맞춘다 (지금 입력 중인 칸은 건드리지 않는다) */
    setEditValues(v) {
      const set = (input, value) => {
        if (value == null || document.activeElement === input) return;
        input.value = String(value);
      };
      set(heightIn, v.height == null ? null : +v.height.toFixed(2));
      set(headingIn, +v.headingDeg.toFixed(2));
      if (document.activeElement !== headingRange) headingRange.value = String(Math.max(-180, Math.min(180, Math.round(v.headingDeg))));
      set(pitchIn, +v.pitchDeg.toFixed(2));
      set(rollIn, +v.rollDeg.toFixed(2));
      set(scaleIn2, +v.scale.toFixed(4));
      posRead.textContent = v.lon == null ? '' : `경도 ${v.lon.toFixed(6)} · 위도 ${v.lat.toFixed(6)}`;
    },
    setEditDragPressed(on) {
      dragBtn.setAttribute('aria-pressed', String(on));
    },
    /** 눈에 띄는 경고/알림을 잠깐 화면 위쪽에 보여준다 (상태줄은 로딩 문구로 금방 덮이므로 따로 둔다). */
    showNotice(text, ms = 8000) {
      notice.textContent = text;
      notice.hidden = false;
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        notice.hidden = true;
      }, ms);
    },
    /** 배경 지도 출처 표시 (OSM 등은 표시가 이용 조건이다). 빈 문자열이면 숨김. */
    setAttribution(text) {
      attrib.textContent = text;
      attrib.hidden = !text;
    },
    setCompassVisible(on) {
      compass.hidden = !on;
    },
    /** @param {number} headingRad 카메라가 북(-z)에서 돌아선 각도 */
    setCompassHeading(headingRad) {
      needle.style.transform = `rotate(${-headingRad}rad)`;
    },
    setReadout(text) {
      readout.textContent = text;
    },
    /** @param {{x:number,y:number}} clientPos @param {string[]} lines */
    showPopup(clientPos, lines) {
      const r = root.getBoundingClientRect();
      popup.textContent = lines.join('\n');
      popup.style.left = `${clientPos.x - r.left}px`;
      popup.style.top = `${clientPos.y - r.top}px`;
      popup.hidden = false;
    },
    hidePopup() {
      popup.hidden = true;
    },
    setHint(text) {
      hint.textContent = text;
    },
    setDragging(on) {
      root.dataset.dragging = String(on);
    },
    hideEmpty() {
      empty.hidden = true;
    },
    showEmpty() {
      empty.hidden = false;
    },
    /** @param {Array<{title:string, rows?:Array<[string,string,string?]>, notes?:string[]}>} sections */
    renderInfo(sections) {
      infoBody.replaceChildren();
      for (const s of sections) {
        const sec = el('div', 'tvk-sec');
        sec.appendChild(el('h4', null, s.title));
        for (const [k, v, cls] of s.rows ?? []) {
          const row = el('div', 'tvk-row');
          row.appendChild(el('span', null, k));
          row.appendChild(el('span', cls ?? null, v));
          sec.appendChild(row);
        }
        for (const n of s.notes ?? []) sec.appendChild(el('p', 'tvk-note', n));
        infoBody.appendChild(sec);
      }
      info.hidden = false;
    },
    /** 실시간 현황 섹션 한 곳만 갱신하기 위한 행 컨테이너 */
    destroy() {
      if (dialogResolve) closeDialog(false);
      if (placeResolve) closePlace(null);
      clearTimeout(busyTimer);
      clearTimeout(noticeTimer);
      root.remove();
    },
  };
}
