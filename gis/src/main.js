/* global Cesium */
// GIS 확인 페이지(Cesium). ion을 쓰지 않고 OSM/VWorld만 쓴다. 서버 없이 로컬 폴더·파일을 바로 연다.
import { pickFolder, pickGlbFile, glbFromDropEvent, allFromDropEvent } from '../../viewer/src/kit/folderPicker.js';
import { inspectGlb } from '../../viewer/src/kit/glbInspect.js';
import { findEmbeddedPlacements } from '../../viewer/src/kit/embeddedCoords.js';
import { projectedAnchor } from '../../viewer/src/kit/projectedAnchor.js';
import { createVirtualFolders } from './virtualFiles.js';
import { installLocalFileLoader } from './cesiumLocalFiles.js';
import { IMAGERY_OPTIONS, createImageryProvider } from './imagery.js';
import { createLayerStore } from './layers.js';
import { buildModelMatrix, createModel } from './modelPlace.js';
import { nudgeLonLat, pickEditable, sanitizeEdit } from './modelEdit.js';
import { showEditPanel } from './modelEditUi.js';
import { collectGroups, isVectorFileName, readRaw } from './vectorParse.js';
import { applyStyle, createVectorDataSource, entityProperties, setRuleVisible, updateScale } from './vectorLayer.js';
import { parseSld } from './sld.js';
import { showVectorPanel } from './vectorUi.js';
import { readDemFile } from './demLoad.js';
import { readDemText } from './demText.js';
import { createDemTerrain, demInfoRows } from './demTerrain.js';
import { showDemPanel } from './demUi.js';
import { openTerrainTiles } from './terrainTiles.js';
import { terrainTilesInfoRows } from './terrainTilesCore.js';
import { classifyDrop, itemCount, kindCount } from './dropClassify.js';
import { showDropChoices } from './dropUi.js';
import { createHighlighter } from './highlight.js';
import { createMeasure } from './measure.js';
import { fitTopDown, freeRect } from './fitView.js';
import { createMemoStore } from './memoStore.js';
import { attributionText, composeScreenshot, downloadCanvas, footerLeft, screenshotFileName } from './screenshot.js';
import { createSnapper } from './snap.js';
import { CRS_LIST, DEFAULT_DISPLAY_CRS, coordLine, describeCoord, formatArea, formatDistance, formatHeight } from './coordFormat.js';
import { findTarget, highlightTarget, modelInfoRows, targetProperties, tilesetInfoRows } from './pickInfo.js';

const $ = (id) => document.getElementById(id);
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

// ---------------------------------------------------------------- 상태 표시
const statusEl = $('status');
let statusTimer = null;
function setStatus(msg, kind = '') {
  clearTimeout(statusTimer);
  if (!msg) {
    statusEl.hidden = true;
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = msg;
  statusEl.className = kind;
  if (kind === '') statusTimer = setTimeout(() => (statusEl.hidden = true), 6000);
}
const errMsg = (e) => String(e?.message ?? e);

// ---------------------------------------------------------------- 뷰어 (ion 없이)
const viewer = new Cesium.Viewer('cesium', {
  baseLayer: false,
  baseLayerPicker: false, // ion 지도 선택기 끔
  geocoder: false, // ion 지오코더 끔
  animation: false,
  timeline: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
});
viewer.scene.globe.depthTestAgainstTerrain = true;

const folders = createVirtualFolders();
installLocalFileLoader(Cesium, folders);
const layers = createLayerStore(viewer, { memoStore: createMemoStore() });
const highlighter = createHighlighter(viewer);
layers.onChange(() => highlighter.validate()); // 강조 중인 레이어를 지우거나 끄면 강조도 없앤다

const KOREA = Cesium.Rectangle.fromDegrees(124.0, 33.0, 132.0, 39.0);
const goHome = (duration = 0.8) => viewer.camera.flyTo({ destination: KOREA, duration });
viewer.camera.setView({ destination: KOREA });
$('btn-home').addEventListener('click', () => goHome());
// 사이트(GitHub Pages 등)로 빌드한 화면에서만 시작 화면으로 돌아가는 링크를 보인다 (개발 서버에서는 상위 폴더가 없다)
if (import.meta.env.PROD) $('home-link').hidden = false;

// ---------------------------------------------------------------- 배경 지도
const selMap = $('sel-map');
const inKey = $('in-key');
for (const o of IMAGERY_OPTIONS) {
  const opt = document.createElement('option');
  opt.value = o.id;
  opt.textContent = `배경: ${o.label}`;
  selMap.appendChild(opt);
}
let baseLayer = null; // 배경 지도 레이어 (지형 음영 같은 다른 이미지 레이어는 건드리지 않는다)
function setBaseLayer(provider) {
  if (baseLayer) viewer.imageryLayers.remove(baseLayer, true);
  baseLayer = provider ? new Cesium.ImageryLayer(provider) : null;
  if (baseLayer) {
    viewer.imageryLayers.add(baseLayer); // add 는 아무것도 돌려주지 않아서 레이어를 따로 들고 있는다
    viewer.imageryLayers.lowerToBottom(baseLayer);
  }
}
function applyImagery() {
  const opt = IMAGERY_OPTIONS.find((o) => o.id === selMap.value);
  inKey.hidden = !opt?.needsKey;
  try {
    const provider = createImageryProvider(Cesium, selMap.value, inKey.value.trim());
    setBaseLayer(provider);
    setStatus(provider ? `배경 지도: ${opt.label}` : '배경 지도를 쓰지 않습니다');
  } catch (e) {
    setBaseLayer(null);
    setStatus(errMsg(e), 'error'); // 예: VWorld는 API 키가 필요합니다
  }
}
selMap.addEventListener('change', applyImagery);
inKey.addEventListener('change', applyImagery);
selMap.value = 'osm';
applyImagery();

// ---------------------------------------------------------------- 레이어 패널
const listEl = $('layer-list');
const legendOpen = new Set(); // 범례를 펼친 레이어 id
const memoOpen = new Set(); // 메모를 펼친 레이어 id
function renderLayers(list) {
  listEl.replaceChildren();
  if (!list.length) {
    listEl.appendChild(el('div', 'empty', '열린 데이터가 없습니다. 위에서 폴더나 glb를 여세요.'));
    return;
  }
  // 전체 켜기/끄기, 전체 삭제
  const bar = el('div', 'row bar');
  const all = document.createElement('input');
  all.type = 'checkbox';
  const shown = list.filter((l) => l.visible).length;
  all.checked = shown === list.length;
  all.indeterminate = shown > 0 && shown < list.length; // 일부만 켜져 있으면 중간 표시
  all.setAttribute('aria-label', '모든 레이어 표시');
  all.addEventListener('change', () => layers.setAllVisible(all.checked));
  const allLabel = el('span', 'name', `전체 ${list.length}개 (${shown}개 표시 중)`);
  bar.append(all, allLabel, button('전체 삭제', () => removeAllLayers(list.length), 'small'));
  listEl.appendChild(bar);
  for (const l of list) {
    const row = el('div', 'row');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = l.visible;
    cb.setAttribute('aria-label', `${l.name} 표시`);
    cb.addEventListener('change', () => layers.setVisible(l.id, cb.checked));
    const name = el('span', 'name', `${{ tileset: '[3D] ', model: '[glb] ', terrain: '[지형] ' }[l.kind] ?? '[벡터] '}${l.name}`);
    name.title = l.name;
    row.append(cb, name, button('이동', () => layers.zoomTo(l.id), 'small'));
    if (l.kind !== 'vector') row.append(button('정보', () => showLayerInfo(l.id), 'small'));
    if (l.kind === 'model') row.append(button('편집', () => openEdit(l.id), 'small'));
    if (l.kind === 'terrain') row.append(shadeToggle(l), exaggerationSelect(l));
    if (l.kind === 'vector') {
      if (l.style) {
        row.append(button(legendOpen.has(l.id) ? '범례 ▴' : '범례 ▾', () => {
          if (legendOpen.has(l.id)) legendOpen.delete(l.id);
          else legendOpen.add(l.id);
          layers.refresh();
        }, 'small'));
      }
      row.append(button('스타일', () => applySldToLayer(l.id), 'small'));
    }
    const memoBtn = button(l.memo ? '메모 ●' : '메모', () => {
      if (memoOpen.has(l.id)) memoOpen.delete(l.id);
      else memoOpen.add(l.id);
      layers.refresh();
    }, 'small');
    memoBtn.title = l.memo ? l.memo.slice(0, 200) : '이 레이어에 메모 남기기';
    row.append(memoBtn);
    row.append(button('삭제', () => {
      if (editing?.layerId === l.id) closeEdit(); // 편집 중인 모델이면 편집 패널도 닫는다
      legendOpen.delete(l.id);
      memoOpen.delete(l.id);
      layers.remove(l.id);
    }, 'small'));
    listEl.appendChild(row);
    if (memoOpen.has(l.id)) listEl.appendChild(memoEl(l, memoBtn));
    if (l.style && legendOpen.has(l.id)) listEl.appendChild(legendEl(l));
  }
}
/** 레이어 메모 입력칸: 입력하는 대로 저장하고, 목록은 다시 그리지 않는다 (글을 쓰다 포커스를 잃지 않게) */
function memoEl(l, memoBtn) {
  const box = el('div', 'memo');
  const ta = document.createElement('textarea');
  ta.value = l.memo ?? '';
  ta.maxLength = 2000;
  ta.placeholder = '이 레이어에 대한 메모';
  ta.setAttribute('aria-label', `${l.name} 메모`);
  ta.addEventListener('input', () => {
    layers.setMemo(l.id, ta.value);
    memoBtn.textContent = ta.value ? '메모 ●' : '메모';
    memoBtn.title = ta.value ? ta.value.slice(0, 200) : '이 레이어에 메모 남기기';
  });
  box.append(ta, el('div', 'sub', '입력하면 이 브라우저에 자동 저장됩니다. 같은 이름의 레이어를 다시 열면 불러옵니다.'));
  return box;
}

/** 열린 레이어를 모두 지운다 (확인을 받는다. 모델 위치 편집 같은 작업은 저장되지 않는다) */
function removeAllLayers(count) {
  if (!window.confirm(`레이어 ${count}개를 모두 삭제할까요?\n(열린 데이터가 지도에서 사라지고, 모델 편집 내용은 저장되지 않습니다)`)) return;
  if (editing) closeEdit();
  closeInfo();
  legendOpen.clear();
  memoOpen.clear();
  layers.clear();
  setStatus(`레이어 ${count}개를 삭제했습니다.`);
}

/** SLD 범례: 규칙마다 색, 이름, 피처 수와 켜고 끄기 */
function legendEl(l) {
  const box = el('div', 'legend');
  const st = l.style;
  const dsObject = () => layers.get(l.id)?.object;
  st.style.rules.forEach((rule, i) => {
    const row = el('label', st.counts[i] ? 'lg' : 'lg dim');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !st.hiddenRules.has(i);
    cb.addEventListener('change', () => setRuleVisible(dsObject(), st, i, cb.checked));
    const sw = el('span', 'sw');
    const p = rule.polygon;
    const col = (p?.fill ? { c: p.fill, a: p.fillOpacity } : rule.line ? { c: rule.line.color, a: rule.line.opacity } : rule.point ? { c: rule.point.fill, a: rule.point.fillOpacity } : null);
    if (col?.c) {
      const m = /^#([0-9a-f]{6})$/i.exec(col.c);
      if (m) {
        const n = parseInt(m[1], 16);
        sw.style.background = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(col.a, 0.25)})`;
      }
    }
    const range = rule.minScale != null || rule.maxScale != null ? ` · 1:${rule.minScale?.toLocaleString('ko-KR') ?? '0'} ~ 1:${rule.maxScale?.toLocaleString('ko-KR') ?? '∞'}` : '';
    row.append(cb, sw, el('span', null, `${rule.title} (${st.counts[i].toLocaleString('ko-KR')})${range}${rule.text ? ' · 글자' : ''}`));
    if (st.scaleHidden?.has(i)) {
      row.classList.add('dim');
      row.title = '지금 지도 축척에서는 이 규칙이 적용되지 않아 감춰져 있습니다 (SLD의 축척 범위)';
    }
    box.appendChild(row);
  });
  if (st.unmatched) box.appendChild(el('div', 'lg dim', `해당 규칙 없음(감춤): ${st.unmatched.toLocaleString('ko-KR')}개`));
  for (const w of st.style.warnings) box.appendChild(el('div', 'warn', w));
  return box;
}

/** 이미 열린 벡터 레이어에 SLD 파일을 골라 적용한다 */
function applySldToLayer(layerId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.sld,.xml';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    try {
      const style = parseSld(new TextDecoder('utf-8').decode(await file.arrayBuffer()));
      const layer = layers.get(layerId);
      if (!layer) return;
      setStatus('스타일 적용 중…', 'busy');
      const state = applyStyle(layer.object, style, layer.data);
      layers.setStyle(layerId, state);
      updateScaleAll();
      legendOpen.add(layerId);
      layers.refresh();
      const matched = state.counts.reduce((a, b) => a + b, 0);
      setStatus(`스타일을 적용했습니다: 규칙 ${style.rules.length}개, 피처 ${matched.toLocaleString('ko-KR')}개${state.unmatched ? ` (해당 없음 ${state.unmatched.toLocaleString('ko-KR')}개는 감춤)` : ''}`);
    } catch (e) {
      setStatus(errMsg(e), 'error');
    }
  });
  input.addEventListener('cancel', () => input.remove());
  document.body.appendChild(input);
  input.click();
}

layers.onChange(renderLayers);
renderLayers([]);

// ---------------------------------------------------------------- SLD 축척 범위
/** 지금 화면의 축척 분모 (1:N 의 N). OGC 기준 화소 크기 0.28 mm. 지구 밖을 보고 있으면 null */
function scaleDenominator() {
  const W = viewer.canvas.clientWidth;
  const H = viewer.canvas.clientHeight;
  const center = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(W / 2, H / 2), viewer.scene.globe.ellipsoid);
  if (!center) return null;
  return viewer.camera.getPixelSize(new Cesium.BoundingSphere(center, 0), W, H) / 0.00028;
}
/** 축척 범위가 있는 스타일의 규칙을 지금 축척에 맞게 켜고 끈다 */
function updateScaleAll() {
  const denom = scaleDenominator();
  if (denom == null) return;
  let changed = false;
  for (const l of layers.list()) {
    const layer = layers.get(l.id);
    if (layer?.kind === 'vector' && layer.style?.hasScale && updateScale(layer.object, layer.style, denom)) changed = true;
  }
  if (changed) layers.refresh();
}
let scaleTimer = 0;
viewer.camera.percentageChanged = 0.05;
const scheduleScale = () => {
  if (scaleTimer) return;
  scaleTimer = window.setTimeout(() => {
    scaleTimer = 0;
    updateScaleAll();
  }, 150);
};
viewer.camera.changed.addEventListener(scheduleScale);
viewer.camera.moveEnd.addEventListener(scheduleScale);

// ---------------------------------------------------------------- 지도 클릭으로 위치 정하기
const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
let pick = null; // { onPick(cartographic, fromSurface) }
function armPick(onPick) {
  pick = { onPick };
  $('cesium').classList.add('picking');
}
function disarmPick() {
  pick = null;
  $('cesium').classList.toggle('picking', !!measure?.active); // 거리 재기 중이면 십자 커서는 그대로
}
/**
 * 화면 위치가 가리키는 세계 좌표. 3D 타일·모델이 있으면 그 표면의 점(높이 포함), 없으면 지구 표면(타원체)의 점.
 * @returns {{cartesian:Cesium.Cartesian3, lon:number, lat:number, height:number, fromSurface:boolean}|null}
 */
function pickWorld(position) {
  let pos = viewer.scene.pickPositionSupported ? viewer.scene.pickPosition(position) : undefined;
  const fromSurface = !!pos;
  if (!pos) pos = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
  if (!pos) return null;
  const c = Cesium.Cartographic.fromCartesian(pos);
  return { cartesian: pos, lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude), height: c.height, fromSurface };
}

handler.setInputAction((click) => {
  if (!pick) {
    if (measure.active) return addMeasurePoint(click.position);
    return showClickInfo(click.position);
  }
  const w = pickWorld(click.position);
  if (!w) return setStatus('이 위치에는 지도가 없습니다. 지구 위를 클릭하세요.', 'error');
  const { onPick } = pick;
  disarmPick();
  return onPick({ lon: w.lon, lat: w.lat, height: w.height }, w.fromSurface);
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// ---------------------------------------------------------------- 3D Tiles (로컬 폴더)
async function openTilesFromFiles(files, name = '로컬 폴더') {
  const reg = folders.register(files);
  if (!reg.entryUrl) {
    folders.release(reg.id);
    throw new Error('선택한 폴더에서 tileset.json 을 찾지 못했습니다. 3D Tiles 폴더(tileset.json이 들어 있는 폴더)를 고르세요.');
  }
  setStatus('3D Tiles 여는 중…', 'busy');
  let tileset;
  try {
    tileset = await Cesium.Cesium3DTileset.fromUrl(reg.entryUrl, { maximumScreenSpaceError: 16 });
  } catch (e) {
    folders.release(reg.id);
    throw e;
  }
  viewer.scene.primitives.add(tileset);
  layers.add({ name, kind: 'tileset', object: tileset, host: 'primitives', meta: { files: files.size }, dispose: () => folders.release(reg.id) });
  await viewer.zoomTo(tileset);
  setStatus(`3D Tiles를 열었습니다: ${name} (파일 ${files.size}개)`);
  return tileset;
}

async function openFolderDialog() {
  queue.length = 0;
  try {
    const src = await pickFolder({
      onPicked: () => setStatus('폴더 읽는 중…', 'busy'),
      onProgress: (n) => setStatus(`폴더 읽는 중… 파일 ${n}개`, 'busy'),
    });
    await openTilesFromFiles(src.files, src.name);
  } catch (e) {
    if (e?.name === 'AbortError') return setStatus('');
    setStatus(errMsg(e), 'error');
  }
}
$('btn-folder').addEventListener('click', openFolderDialog);

// ---------------------------------------------------------------- glb: 위치 정하기 패널
const placeEl = $('place');
function closePlace() {
  disarmPick();
  // 편집 중이던 모델의 끌어서 이동은 패널이 사라지면 같이 끝낸다 (지도 이동이 잠긴 채로 남지 않게)
  if (editing || dragEnabled) {
    dragEnabled = false;
    drag = null;
    editing = null;
    viewer.scene.screenSpaceCameraController.enableInputs = true;
  }
  placeEl.hidden = true;
  placeEl.replaceChildren();
}

/** 이어서 열 작업 (끌어놓은 자료를 여러 개 골랐을 때 glb 위치 정하기를 하나씩 이어 간다) */
const queue = [];
function advanceQueue() {
  const job = queue.shift();
  if (job) job();
}

const numField = (value, step = 'any') => {
  const i = document.createElement('input');
  i.type = 'number';
  i.step = step;
  i.value = String(value);
  return i;
};

/** 파일을 열어 검사하고 위치 정하기 패널을 띄운다 */
async function startGlb(file) {
  let info;
  try {
    info = inspectGlb(await file.arrayBuffer());
  } catch (e) {
    setStatus(errMsg(e), 'error');
    return advanceQueue();
  }
  if (!info) {
    setStatus(`${file.name}: glb 파일이 아닙니다 (.gltf는 읽을 수 없습니다. 하나로 합친 .glb를 쓰세요).`, 'error');
    return advanceQueue();
  }
  showPlacePanel({ file, info, found: findEmbeddedPlacements(info) });
}

function showPlacePanel({ file, info, found }) {
  closePlace();
  placeEl.hidden = false;
  placeEl.append(el('h2', null, 'glb 위치 정하기'));
  const details = [`삼각형 ${info.triangles.toLocaleString('ko-KR')}`];
  if (info.size) details.push(`크기 ${info.size.map((v) => v.toFixed(1)).join(' × ')}`);
  placeEl.append(el('div', 'sub', `${file.name} · ${details.join(' · ')}`));
  if (queue.length) placeEl.append(el('div', 'sub', `이어서 위치를 정할 glb가 ${queue.length}개 더 있습니다.`));
  for (const w of [...info.warnings, ...found.warnings]) placeEl.append(el('div', 'warn', w));

  // 모양 설정 (모든 배치 방법에 공통)
  const fs = el('fieldset');
  fs.append(el('legend', null, '모델 모양'));
  const form = el('div', 'form');
  const upSel = document.createElement('select');
  for (const [v, l] of [['Y', 'Y축이 위 (glTF 표준)'], ['Z', 'Z축이 위 (GIS/CAD에서 흔함)']]) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = l;
    upSel.appendChild(o);
  }
  const headingIn = numField(0);
  const scaleIn = numField(1);
  const heightIn = numField(0);
  const clickH = document.createElement('input');
  clickH.type = 'checkbox';
  form.append(
    el('label', null, '위쪽 축'), upSel,
    el('label', null, '방향 (°, 시계)'), headingIn,
    el('label', null, '크기 배율'), scaleIn,
    el('label', null, '높이 (m)'), heightIn,
  );
  fs.append(form);
  const unitRow = el('div', 'sub', '파일 단위: ');
  for (const [label, v] of [['m (그대로)', 1], ['cm', 0.01], ['mm', 0.001]]) unitRow.append(button(label, () => (scaleIn.value = String(v)), 'small'));
  fs.append(unitRow);
  const hRow = el('label', 'sub');
  hRow.append(clickH, ' 지도를 클릭할 때 그 지점(3D 타일 등)의 높이를 사용');
  fs.append(hRow);
  placeEl.append(fs);

  const err = el('div', 'warn');
  const shape = () => {
    const s = { upAxis: upSel.value, headingDeg: Number(headingIn.value), scale: Number(scaleIn.value), height: Number(heightIn.value) };
    if (!Number.isFinite(s.headingDeg)) throw new Error('방향은 숫자(도)로 입력하세요.');
    if (!(s.scale > 0)) throw new Error('크기 배율은 0보다 큰 숫자여야 합니다. (단위가 mm면 0.001)');
    if (!Number.isFinite(s.height)) throw new Error('높이는 숫자로 입력하세요.');
    return s;
  };
  const run = async (fn) => {
    try {
      err.textContent = '';
      await fn();
    } catch (e) {
      err.textContent = errMsg(e);
      setStatus(errMsg(e), 'error');
    }
  };

  // 1) 파일 안 좌표 추천
  const sug = found.suggestions[0];
  if (sug) {
    const box = el('div', 'picked');
    box.append(el('div', null, '파일 안에 실제 좌표가 들어 있는 것 같습니다.'));
    const preview = el('div', 'sub', sug.label);
    box.append(preview);
    let crs = sug.spec.crs;
    if (sug.alternatives.length > 1) {
      const sel = document.createElement('select');
      for (const a of sug.alternatives) {
        const o = document.createElement('option');
        o.value = a.crs;
        o.textContent = `${a.label} — 경도 ${a.lon.toFixed(3)}, 위도 ${a.lat.toFixed(3)}`;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => {
        crs = sel.value;
        const a = sug.alternatives.find((x) => x.crs === crs);
        preview.textContent = `${a.label} 좌표로 읽기 → 경도 ${a.lon.toFixed(5)}, 위도 ${a.lat.toFixed(5)} (중심 높이 ${a.elev.toFixed(1)} m)`;
      });
      box.append(el('div', 'sub', '같은 숫자라도 서부·중부·동부원점(5185/5186/5187)에 따라 위치가 달라집니다.'), sel);
    }
    box.append(button('이 위치로 배치', () => run(async () => {
      upSel.value = sug.spec.upAxis;
      scaleIn.value = String(sug.spec.scale);
      const s = shape();
      const a = projectedAnchor({ crs, upAxis: s.upAxis, scale: s.scale }, info.bounds);
      await placeModel(file, { lon: a.lon, lat: a.lat, height: a.height, headingDeg: s.headingDeg, scale: s.scale, upAxis: s.upAxis, pivot: a.pivot });
      closePlace();
      advanceQueue();
    }), 'primary'));
    placeEl.append(box);
  }

  // 2) 지도 클릭
  const hint = el('div', 'sub', '');
  const actions = el('div', 'actions');
  actions.append(
    button('지도에서 클릭해 배치', () => run(async () => {
      const s = shape();
      hint.textContent = '지도에서 놓을 위치를 클릭하세요.';
      armPick(async (p, fromSurface) => {
        await run(async () => {
          await placeModel(file, { lon: p.lon, lat: p.lat, height: clickH.checked && fromSurface ? p.height : s.height, headingDeg: s.headingDeg, scale: s.scale, upAxis: s.upAxis, pivot: null });
          closePlace();
          advanceQueue();
        });
      });
    }), sug ? '' : 'primary'),
    button(queue.length ? '건너뛰기' : '취소', () => {
      closePlace();
      advanceQueue();
    }),
  );
  placeEl.append(err, hint, actions);
}

/** 모델을 만들어 화면에 올리고 레이어로 등록한다 */
async function placeModel(file, p) {
  setStatus('모델 올리는 중…', 'busy');
  const { model, objectUrl } = await createModel(file, p);
  viewer.scene.primitives.add(model);
  await new Promise((resolve) => (model.ready ? resolve() : model.readyEvent.addEventListener(resolve)));
  const layer = layers.add({ name: file.name, kind: 'model', object: model, host: 'primitives', meta: { ...p, initial: pickEditable(p) }, dispose: () => URL.revokeObjectURL(objectUrl), data: file });
  await layers.zoomTo(layer.id);
  setStatus(`glb를 놓았습니다: 경도 ${p.lon.toFixed(6)}, 위도 ${p.lat.toFixed(6)}, 높이 ${p.height.toFixed(1)} m`);
  return model;
}

// ---------------------------------------------------------------- 놓은 모델 편집
/** @type {{layerId:string, ui:{update:Function, setDragPressed:Function}}|null} */
let editing = null;
/** 끌어서 이동 중인 상태 */
let drag = null;
let dragEnabled = false;

const cameraInputs = (on) => {
  viewer.scene.screenSpaceCameraController.enableInputs = on;
};

function closeEdit() {
  dragEnabled = false;
  drag = null;
  cameraInputs(true);
  disarmPick();
  editing = null;
  closePlace();
}

/** 고친 값을 모델에 반영한다. 위쪽 축이 바뀌면 모델을 다시 만든다 (Cesium은 로딩할 때만 위쪽 축을 정한다). */
async function applyModelPatch(layer, patch) {
  const clean = sanitizeEdit(patch);
  const next = { ...layer.meta, ...clean };
  if (clean.upAxis && clean.upAxis !== layer.meta.upAxis) {
    // 같은 pivot이라도 위쪽 축에 따라 파일 좌표의 뜻이 달라서, 파일 안 좌표로 놓은 모델은 처음 값으로만 되돌릴 수 있다
    await rebuildModel(layer, next);
  } else {
    layer.meta = next;
    layer.object.modelMatrix = buildModelMatrix(next);
  }
  editing?.ui.update(layer.meta);
}

async function rebuildModel(layer, meta) {
  setStatus('모델 다시 만드는 중…', 'busy');
  const { model, objectUrl } = await createModel(layer.data, meta);
  viewer.scene.primitives.add(model);
  await new Promise((resolve) => (model.ready ? resolve() : model.readyEvent.addEventListener(resolve)));
  viewer.scene.primitives.remove(layer.object);
  layer.dispose?.();
  layer.object = model;
  layer.dispose = () => URL.revokeObjectURL(objectUrl);
  layer.meta = meta;
  model.show = layer.visible;
  setStatus('');
}

/** 그 위치의 지형 높이(타원체고). 열린 DEM에서 바로 읽고, 없으면 화면의 지형에서. 평평한 지구면 0. 알 수 없으면 null */
function terrainHeightAt(lon, lat) {
  const dem = layers.list().map((l) => layers.get(l.id)).find((l) => l.kind === 'terrain' && l.visible);
  if (dem) {
    const h = dem.object.heightAt(lon, lat);
    return h == null ? 0 : h; // DEM 범위 밖은 높이 0 (지형도 그렇게 그려진다)
  }
  const h = viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(lon, lat));
  return h ?? null;
}

function openEdit(layerId) {
  const layer = layers.get(layerId);
  if (!layer || layer.kind !== 'model') return;
  closePlace();
  disarmPick();
  const ui = showEditPanel(placeEl, {
    name: layer.name,
    hasPivot: !!layer.meta.pivot,
    getMeta: () => layer.meta,
    onNudge: (dE, dN) => {
      const p = nudgeLonLat(layer.meta, dE, dN);
      return applyModelPatch(layer, p);
    },
    onPatch: (patch) => applyModelPatch(layer, patch),
    onGround: async () => {
      const h = terrainHeightAt(layer.meta.lon, layer.meta.lat);
      if (h == null) throw new Error('이 위치의 지형 높이를 알 수 없습니다 (DEM 범위 밖이거나 지형이 아직 불러와지지 않았습니다).');
      await applyModelPatch(layer, { height: h });
      setStatus(`모델 높이를 지형에 맞췄습니다: ${h.toFixed(2)} m`);
    },
    onPickMap: () => {
      setStatus('모델을 옮길 위치를 지도에서 클릭하세요.', 'busy');
      armPick(async (c) => {
        await applyModelPatch(layer, { lon: c.lon, lat: c.lat });
        setStatus(`모델을 옮겼습니다: 경도 ${c.lon.toFixed(6)}, 위도 ${c.lat.toFixed(6)}`);
      });
    },
    onDragToggle: (on) => {
      dragEnabled = on;
      ui.setDragPressed(on);
      setStatus(on ? '모델을 마우스로 끌어 옮기세요 (모델 밖을 끌면 지도가 움직입니다).' : '');
    },
    onReset: async () => {
      await applyModelPatch(layer, layer.meta.initial);
      setStatus('처음 값으로 되돌렸습니다.');
    },
    onClose: closeEdit,
  });
  editing = { layerId, ui };
}

// 끌어서 이동: 모델 위에서 마우스를 누르면 잡고, 누른 채 움직이면 따라온다 (지구 표면 기준)
const surfacePoint = (position) => {
  const pos = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
  if (!pos) return null;
  const c = Cesium.Cartographic.fromCartesian(pos);
  return { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude) };
};
handler.setInputAction((down) => {
  if (!dragEnabled || !editing) return;
  const layer = layers.get(editing.layerId);
  const picked = viewer.scene.pick(down.position);
  if (!layer || picked?.primitive !== layer.object) return;
  const p = surfacePoint(down.position);
  if (!p) return;
  drag = { layer, dLon: layer.meta.lon - p.lon, dLat: layer.meta.lat - p.lat };
  cameraInputs(false); // 끄는 동안 지도가 같이 움직이지 않게
}, Cesium.ScreenSpaceEventType.LEFT_DOWN);
handler.setInputAction((move) => {
  onPointerMove(move.endPosition);
  if (!drag) return;
  const p = surfacePoint(move.endPosition);
  if (!p) return;
  drag.layer.meta = { ...drag.layer.meta, lon: p.lon + drag.dLon, lat: Math.max(-89.9, Math.min(89.9, p.lat + drag.dLat)) };
  drag.layer.object.modelMatrix = buildModelMatrix(drag.layer.meta);
  editing?.ui.update(drag.layer.meta);
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
handler.setInputAction(() => {
  if (!drag) return;
  drag = null;
  cameraInputs(true);
}, Cesium.ScreenSpaceEventType.LEFT_UP);

$('btn-glb').addEventListener('click', async () => {
  queue.length = 0;
  try {
    await startGlb(await pickGlbFile());
  } catch (e) {
    if (e?.name !== 'AbortError') setStatus(errMsg(e), 'error');
  }
});

// ---------------------------------------------------------------- GeoJSON / SHP
const infoEl = $('info');
function closeInfo() {
  clearSelection();
  infoEl.hidden = true;
  infoEl.replaceChildren();
}
let undoHighlight = () => {}; // 3D Tiles 피처·모델 강조를 되돌리는 함수
function clearSelection() {
  undoHighlight();
  undoHighlight = () => {};
  highlighter.clear();
}

/** 정보 패널을 채운다. sections: [{heading?, rows:[[이름, 값]], note?}] */
function renderInfo(title, sections) {
  infoEl.replaceChildren();
  infoEl.hidden = false;
  infoEl.append(button('닫기', closeInfo, 'small close'), el('h2', null, title));
  for (const sec of sections) {
    if (sec.heading) infoEl.append(el('div', 'sub', sec.heading));
    if (sec.note) infoEl.append(el('div', 'sub', sec.note));
    if (!sec.rows?.length) continue;
    const table = document.createElement('table');
    for (const [k, v] of sec.rows) {
      const tr = document.createElement('tr');
      tr.append(el('td', null, k), el('td', null, v));
      table.appendChild(tr);
    }
    infoEl.append(table);
  }
}

/** 클릭한 지점의 좌표 [이름, 값] (고른 좌표계와 경위도·높이) */
function pointRows(w) {
  const rows = [];
  const d = describeCoord(displayCrs, w.lon, w.lat);
  rows.push([d.xLabel, `${d.x} ${d.unit}`], [d.yLabel, `${d.y} ${d.unit}`]);
  if (displayCrs !== 'EPSG:4326') rows.push(['경위도', `${w.lon.toFixed(6)}, ${w.lat.toFixed(6)}`]);
  rows.push(['높이(타원체)', w.fromSurface ? formatHeight(w.height) : '– (지구 표면)']);
  return rows;
}

const layerOfObject = (obj) => layers.list().map((l) => layers.get(l.id)).find((l) => l.object === obj);

/** 지도를 클릭하면: 누른 것(벡터 피처, 3D Tiles 피처, glb, 타일셋)의 속성과 강조, 클릭 지점의 좌표를 보여 준다 */
function showClickInfo(position) {
  clearSelection();
  const w = pickWorld(position);
  const target = findTarget(viewer.scene, position);
  const sections = [];
  let title = '클릭 지점';
  if (target?.kind === 'entity') {
    highlighter.show(target.entity);
    const rows = targetProperties(target);
    title = target.entity.name || rows.find(([k, v]) => /^(name|title|이름|명칭)$/i.test(k) && v)?.[1] || '속성';
    sections.push({ heading: '피처 속성', rows, note: rows.length ? '' : '속성이 없습니다.' });
  } else if (target?.kind === 'tile-feature') {
    undoHighlight = highlightTarget(target);
    const layer = layerOfObject(target.feature.tileset);
    title = layer?.name ?? '3D Tiles 피처';
    const rows = targetProperties(target);
    sections.push({ heading: layer ? `3D Tiles: ${layer.name}` : '3D Tiles 피처', rows, note: rows.length ? '' : '이 피처에는 속성이 없습니다.' });
  } else if (target?.kind === 'model') {
    undoHighlight = highlightTarget(target);
    const layer = layerOfObject(target.model);
    if (layer) {
      title = layer.name;
      sections.push({ heading: 'glb 모델', rows: modelInfoRows(layer) });
    } else {
      title = '3D 모델';
      sections.push({ heading: '3D Tiles 안의 모델 (속성 없음)', rows: [] });
    }
  } else if (target?.kind === 'tileset') {
    const layer = layerOfObject(target.tileset);
    title = layer?.name ?? '3D Tiles';
    sections.push({ heading: '3D Tiles (이 부분에는 피처 속성이 없습니다)', rows: tilesetInfoRows(target.tileset, layer?.meta) });
  }
  if (w) sections.push({ heading: '클릭 지점', rows: pointRows(w) });
  if (!sections.length) return closeInfo();
  return renderInfo(title, sections);
}

/** 레이어 줄의 `정보` 버튼 */
function showLayerInfo(layerId) {
  const layer = layers.get(layerId);
  if (!layer) return;
  clearSelection();
  if (layer.kind === 'tileset') renderInfo(layer.name, [{ heading: '3D Tiles 정보', rows: tilesetInfoRows(layer.object, layer.meta) }]);
  else if (layer.kind === 'model') renderInfo(layer.name, [{ heading: 'glb 모델', rows: modelInfoRows(layer) }]);
  else if (layer.kind === 'terrain' && layer.meta.source === 'tiles') renderInfo(layer.name, [{ heading: '지형 타일', rows: terrainTilesInfoRows(layer.data) }]);
  else if (layer.kind === 'terrain') renderInfo(layer.name, [{ heading: '지형(DEM)', rows: demInfoRows(layer.data, layer.meta) }]);
}

/** 지형 레이어 줄의 음영 켜기/끄기 */
function shadeToggle(l) {
  const label = el('label', 'small');
  label.style.cssText = 'display:flex;align-items:center;gap:2px;font-size:12px;cursor:pointer;flex:none';
  label.title = '지형 음영(그림자) 겹치기: 배경 지도가 평평해서 안 보이는 기복을 보여 줍니다';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  const obj = layers.get(l.id)?.object;
  cb.checked = obj?.shade ?? true;
  if (obj?.canShade === false) {
    cb.disabled = true;
    label.title = '이 지형 타일에는 법선(음영용) 정보가 없어 음영을 낼 수 없습니다';
  }
  cb.addEventListener('change', () => {
    const h = layers.get(l.id)?.object;
    if (h) h.shade = cb.checked;
  });
  label.append(cb, '음영');
  return label;
}

/** 지형 레이어 줄의 높이 과장 선택 (보기용: 땅이 평평해 보일 때 기복을 키워 본다) */
function exaggerationSelect(l) {
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', '지형 높이 과장');
  sel.title = '보기용 높이 과장. 지형과 3D 타일이 과장되어 보이고, 이때 클릭·측정 높이는 실제와 다를 수 있습니다.';
  sel.style.cssText = 'padding:0 2px;font-size:12px;flex:none';
  for (const v of [1, 2, 3, 5]) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = `${v}배`;
    sel.appendChild(o);
  }
  sel.value = String(viewer.scene.verticalExaggeration ?? 1);
  sel.addEventListener('change', () => {
    viewer.scene.verticalExaggeration = Number(sel.value);
    if (Number(sel.value) !== 1) setStatus('높이 과장은 보기용입니다. 지형과 3D 타일이 과장되어 보이고, 클릭·측정 높이는 실제와 다를 수 있습니다.');
  });
  return sel;
}

// ---------------------------------------------------------------- 지형(DEM)
/** GeoTIFF 한 개를 읽어 열기 패널을 띄운다 */
async function startDem(file) {
  return openDem(() => readDemFile(file), file.name);
}

/** 글자(XYZ 점 목록 여러 개 / ASCII 격자) DEM 파일들을 하나의 지형으로 읽어 열기 패널을 띄운다 */
async function startDemText(files) {
  return openDem(() => readDemText(files), files.length === 1 ? files[0].name : `${files[0].name} 외 ${files.length - 1}개`);
}

/** 선택한 DEM 파일들: GeoTIFF는 하나씩, 글자 파일(.txt/.xyz/.asc)은 모두 합쳐서 하나로 */
async function startDemFiles(files) {
  const isText = (f) => /\.(txt|xyz|asc|csv)$/i.test(f.name);
  const text = files.filter(isText);
  const tifs = files.filter((f) => !isText(f));
  for (const f of tifs) queue.push(() => startDem(f));
  if (text.length) return startDemText(text);
  return advanceQueue();
}

async function openDem(load, label) {
  try {
    setStatus(`지형 읽는 중… ${label}`, 'busy');
    const dem = await load();
    const replacing = layers.list().some((l) => l.kind === 'terrain');
    closePlace();
    showDemPanel(placeEl, dem, {
      replacing,
      onCancel: () => {
        closePlace();
        advanceQueue();
      },
      onConfirm: async ({ crs, offset }) => {
        const handle = createDemTerrain(viewer, dem, { crs, offset });
        for (const old of layers.list().filter((x) => x.kind === 'terrain')) layers.remove(old.id); // 지형은 하나만
        layers.add({
          name: dem.name,
          kind: 'terrain',
          object: handle,
          host: 'terrain',
          meta: { crs, offset, extent: handle.extent },
          data: dem,
          dispose: () => {
            handle.dispose();
            viewer.scene.verticalExaggeration = 1;
          },
        });
        closePlace();
        setStatus(`지형을 열었습니다: ${dem.name}${dem.source ? ` [${dem.source}]` : ''} (${crs}, 높이 보정 ${offset} m)`);
        await handle.flyTo();
        advanceQueue();
      },
    });
    setStatus('');
  } catch (e) {
    setStatus(errMsg(e), 'error');
    advanceQueue();
  }
}

/** Cesium 지형 타일 폴더(layer.json + .terrain)를 연다. files: 폴더 안 상대경로 -> File */
async function startTerrainTiles(files, name = '지형 타일') {
  try {
    setStatus(`지형 타일 여는 중… ${name}`, 'busy');
    const handle = await openTerrainTiles(viewer, folders, files);
    for (const old of layers.list().filter((x) => x.kind === 'terrain')) layers.remove(old.id); // 지형은 하나만
    layers.add({
      name,
      kind: 'terrain',
      object: handle,
      host: 'terrain',
      meta: { source: 'tiles' },
      data: handle,
      dispose: () => {
        handle.dispose();
        viewer.scene.verticalExaggeration = 1;
      },
    });
    setStatus(`지형 타일을 열었습니다: ${name} (${handle.summary.format || '형식 미상'}, 파일 ${files.size.toLocaleString('ko-KR')}개)`);
    await handle.flyTo();
  } catch (e) {
    setStatus(errMsg(e), 'error');
  }
}

$('btn-terrain').addEventListener('click', async () => {
  queue.length = 0;
  try {
    const src = await pickFolder({
      onPicked: () => setStatus('폴더 읽는 중…', 'busy'),
      onProgress: (n) => setStatus(`폴더 읽는 중… 파일 ${n.toLocaleString('ko-KR')}개`, 'busy'),
    });
    await startTerrainTiles(src.files, src.name);
  } catch (e) {
    if (e?.name === 'AbortError') return setStatus('');
    return setStatus(errMsg(e), 'error');
  }
  return undefined;
});

$('btn-dem').addEventListener('click', () => {
  queue.length = 0;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.tif,.tiff,.txt,.xyz,.asc';
  input.multiple = true; // 글자 DEM은 도엽(파일)이 여러 개라 한꺼번에 고를 수 있다
  input.style.display = 'none';
  input.addEventListener('change', () => {
    const picked = [...(input.files ?? [])];
    input.remove();
    if (!picked.length) return;
    const first = picked.length === 1 && /\.tiff?$/i.test(picked[0].name);
    if (first) startDem(picked[0]);
    else startDemFiles(picked);
  });
  input.addEventListener('cancel', () => input.remove());
  document.body.appendChild(input);
  input.click();
});

/** 선택한 파일들(GeoJSON, SHP 묶음, ZIP)을 읽어 열기 패널을 띄운다 */
async function startVector(fileList) {
  const files = [...fileList];
  try {
    setStatus('파일 읽는 중…', 'busy');
    const { groups, skipped, styles: styleFiles } = await collectGroups(files);
    if (!groups.length) {
      setStatus('GeoJSON 또는 SHP(.shp)를 찾지 못했습니다. SHP는 .shp와 함께 .dbf/.prj 파일도 같이 선택하세요(또는 .zip).', 'error');
      return advanceQueue();
    }
    const items = [];
    const errors = [];
    for (const g of groups) {
      try {
        items.push({ name: g.name, raw: await readRaw(g) });
      } catch (e) {
        errors.push(errMsg(e));
      }
    }
    if (!items.length) {
      setStatus(errors[0], 'error');
      return advanceQueue();
    }
    const styles = [];
    for (const s of styleFiles) {
      try {
        styles.push({ name: s.name, style: parseSld(new TextDecoder('utf-8').decode(await s.read())) });
      } catch (e) {
        errors.push(`${s.name}: ${errMsg(e)}`);
      }
    }
    closePlace();
    showVectorPanel(placeEl, items, {
      skipped: [...skipped, ...errors],
      styles,
      onCancel: () => {
        closePlace();
        advanceQueue();
      },
      onConfirm: async (results) => {
        try {
          let last = null;
          for (const r of results) {
            const ds = await createVectorDataSource(r.collection, { name: r.name });
            const styleState = r.style ? applyStyle(ds, r.style, r.collection) : null; // 지도에 올리기 전에 칠해야 빠르다
            await viewer.dataSources.add(ds);
            const added = layers.add({ name: r.name, kind: 'vector', object: ds, host: 'dataSources', meta: r.info, style: styleState, data: r.collection });
            if (styleState?.hasScale) updateScaleAll();
            if (styleState) {
              legendOpen.add(added.id);
              layers.refresh(); // 범례를 바로 펼쳐 보여 준다
            }
            last = ds;
          }
          closePlace();
          if (last) await viewer.zoomTo(last);
          setStatus(`${results.length}개 레이어를 열었습니다 (피처 ${results.reduce((a, r) => a + r.info.count, 0).toLocaleString('ko-KR')}개). 지도에서 피처를 클릭하면 속성이 보입니다.`);
        } catch (e) {
          setStatus(errMsg(e), 'error');
        }
        advanceQueue();
      },
    });
    setStatus('');
  } catch (e) {
    setStatus(errMsg(e), 'error');
    advanceQueue();
  }
  return undefined;
}

$('btn-vec').addEventListener('click', () => {
  queue.length = 0;
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.geojson,.json,.zip,.shp,.dbf,.prj,.cpg,.shx,.sld';
  input.style.display = 'none';
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    input.remove();
    if (files.length) startVector(files);
  });
  input.addEventListener('cancel', () => input.remove());
  document.body.appendChild(input);
  input.click();
});

// ---------------------------------------------------------------- 끌어놓기
const dropEl = $('drop');
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  dropEl.classList.add('on');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropEl.classList.remove('on');
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropEl.classList.remove('on');
  // dataTransfer는 await 전에 꺼내 둔다
  queue.length = 0;
  const glb = glbFromDropEvent(e);
  if (glb) return startGlb(glb);
  try {
    // 파일·폴더 어느 쪽이든 놓은 것을 전부 읽어서 무엇인지 판단한다
    const src = await allFromDropEvent(e, {
      onPicked: () => setStatus('파일 읽는 중…', 'busy'),
      onProgress: (n) => setStatus(`파일 읽는 중… ${n}개`, 'busy'),
    });
    await openDropped(src);
  } catch (err) {
    setStatus(errMsg(err), 'error');
  }
  return undefined;
});

/**
 * 끌어놓은 자료를 분류해서 연다. 열 것이 하나뿐이거나 벡터뿐이면 바로 열고, 여러 종류가 섞였으면 체크 목록을 보여 준다.
 * @param {{files:Map<string,File>, name:string}} src
 */
async function openDropped(src) {
  const plan = classifyDrop([...src.files.keys()]);
  const total = itemCount(plan);
  if (!total) {
    return setStatus('열 수 있는 파일이 없습니다. 3D Tiles 폴더, 지형 타일 폴더(layer.json), .glb, GeoJSON, SHP(.shp + .dbf/.prj), ZIP, 지형(.tif)을 놓아 주세요.', 'error');
  }
  const vectorFiles = (idx) => {
    const paths = new Set(plan.styles); // SLD는 같이 넘겨서 열기 패널에서 고르게 한다
    for (const i of idx) for (const p of plan.vectors[i].paths) paths.add(p);
    return [...paths].map((p) => ({ name: p, arrayBuffer: () => src.files.get(p).arrayBuffer() }));
  };
  const run = async ({ tilesets, terrains = [], models, dems = [], vectors }) => {
    closePlace();
    // 3D Tiles는 바로 열고, 벡터와 glb는 패널에서 정하는 것이 있으니 차례로 이어 간다
    for (const i of tilesets) {
      const t = plan.tilesets[i];
      const files = new Map();
      for (const [p, f] of src.files) if (p.startsWith(t.root)) files.set(p.slice(t.root.length), f);
      try {
        await openTilesFromFiles(files, t.name || src.name);
      } catch (err) {
        setStatus(`${t.name || src.name}: ${errMsg(err)}`, 'error');
      }
    }
    for (const i of terrains) {
      const t = plan.terrains[i];
      const files = new Map();
      for (const [p, f] of src.files) if (p.startsWith(t.root)) files.set(p.slice(t.root.length), f);
      await startTerrainTiles(files, t.name || src.name);
    }
    for (const i of models) queue.push(() => startGlb(src.files.get(plan.models[i].path)));
    if (dems.length) {
      const picked = dems.map((i) => src.files.get(plan.dems[i].path));
      queue.push(() => startDemFiles(picked));
    }
    if (vectors.length) await startVector(vectorFiles(vectors));
    else advanceQueue();
  };

  // 벡터뿐이거나 하나뿐이면 묻지 않고 연다
  if (total === 1 || (kindCount(plan) === 1 && plan.vectors.length)) {
    return run({ tilesets: plan.tilesets.map((_, i) => i), terrains: plan.terrains.map((_, i) => i), models: plan.models.map((_, i) => i), dems: plan.dems.map((_, i) => i), vectors: plan.vectors.map((_, i) => i) });
  }
  showDropChoices(placeEl, plan, { onOpen: run, onCancel: closePlace });
  return undefined;
}

// ---------------------------------------------------------------- 마우스 위치 좌표
let displayCrs = DEFAULT_DISPLAY_CRS;
const selCrs = $('sel-crs');
for (const c of CRS_LIST) {
  const opt = document.createElement('option');
  opt.value = c.code;
  opt.textContent = c.code.replace('EPSG:', 'EPSG ') + (c.geographic ? ' 경위도' : '');
  opt.title = c.label;
  selCrs.appendChild(opt);
}
selCrs.value = displayCrs;
const coordText = $('coord-text');
let lastWorld = null;
function showCoord(w) {
  if (!w) {
    coordText.textContent = '지도 밖';
    return;
  }
  coordText.textContent = `${coordLine(displayCrs, w.lon, w.lat)}  ${w.fromSurface ? `높이 ${formatHeight(w.height)}` : ''}`;
}
selCrs.addEventListener('change', () => {
  displayCrs = selCrs.value;
  showCoord(lastWorld);
});
let moveTimer = 0;
let lastMovePos = null;
/** 마우스가 움직일 때: 좌표 표시와 거리 재기의 고무줄 선 (너무 자주 계산하지 않게 줄인다) */
function onPointerMove(position) {
  lastMovePos = position;
  if (moveTimer) return;
  moveTimer = window.setTimeout(() => {
    moveTimer = 0;
    if (!lastMovePos) return;
    lastWorld = pickWorld(lastMovePos);
    showCoord(lastWorld);
    if (measure.active) {
      const sn = findSnap(lastMovePos, lastWorld);
      measure.setSnap(sn?.cartesian ?? null, sn ? `${sn.label}에 맞춤` : '');
      measure.setHover(sn?.cartesian ?? lastWorld?.cartesian ?? null);
    }
  }, 50);
}
$('cesium').addEventListener('mouseleave', () => {
  lastMovePos = null;
});

// ---------------------------------------------------------------- 거리 재기
const measureEl = $('measure');
const btnMeasure = $('btn-measure');
const btnArea = $('btn-area');
const measure = createMeasure(viewer, { onChange: renderMeasure });
// 자동 맞춤: 이미 찍은 점, 열린 벡터의 점(POI)·꼭짓점으로 (화면 12px 안이면)
let snapOn = true;
const snapper = createSnapper(viewer, {
  getSources: () => layers.list().filter((l) => l.kind === 'vector' && l.visible).map((l) => layers.get(l.id)?.object).filter(Boolean),
  getMeasurePoints: () => measure.snapPoints(),
});
const findSnap = (windowPos, world) => (snapOn ? snapper.find(windowPos, world?.cartesian ?? null) : null);
viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

function renderMeasure(state) {
  btnMeasure.setAttribute('aria-pressed', String(state.active && state.mode === 'distance'));
  btnArea.setAttribute('aria-pressed', String(state.active && state.mode === 'area'));
  const prevScroll = measureEl.querySelector('.m-body')?.scrollTop ?? 0; // 다시 그려도 보던 위치를 유지
  measureEl.replaceChildren();
  if (!state.active && !state.lines.length) {
    measureEl.hidden = true;
    return;
  }
  measureEl.hidden = false;
  const body = el('div', 'm-body'); // 스크롤되는 부분
  measureEl.append(body);
  const isArea = state.mode === 'area';
  body.append(el('h2', null, state.active ? (isArea ? '면적 재기' : '거리 재기') : '잰 결과'));
  if (state.active) {
    body.append(el('div', 'sub', isArea ? '지도를 클릭해 꼭짓점을 찍으세요 (3점 이상). 오른쪽 클릭 또는 Enter: 면 닫기, Esc: 찍던 면 취소.' : '지도를 클릭해 점을 찍으세요. 오른쪽 클릭 또는 Enter: 선 끝내기, Esc: 찍던 선 취소.'));
    const snapRow = el('label', 'sub');
    snapRow.style.cssText = 'display:flex;gap:6px;align-items:center;cursor:pointer;margin:4px 0';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = snapOn;
    cb.addEventListener('change', () => {
      snapOn = cb.checked;
      if (!snapOn) measure.setSnap(null);
    });
    snapRow.append(cb, `자동 맞춤 (이전 점·벡터의 점/꼭짓점, 화면 ${snapper.radiusPx}px 안). 확대할수록 세밀하게 찍힙니다.`);
    body.append(snapRow);
  }
  const counter = { distance: 0, area: 0 };
  state.lines.forEach((line, i) => {
    const n = ++counter[line.kind];
    body.append(el('div', 'sub', `${line.kind === 'area' ? '면' : '선'} ${n}${line.done ? '' : ' (찍는 중)'} — 점 ${line.points}개`));
    if (line.segments.length) {
      const table = document.createElement('table');
      const head = document.createElement('tr');
      for (const h of ['구간', '수평', '직선', '높이차']) head.append(el('th', null, h));
      table.append(head);
      line.segments.forEach((s, k) => {
        const tr = document.createElement('tr');
        tr.className = `clickable${state.selected?.line === i && state.selected.seg === k ? ' sel' : ''}`;
        tr.title = '클릭하면 이 구간으로 이동하고 강조합니다 (다시 클릭하면 해제)';
        tr.addEventListener('click', () => focusMeasure(i, k));
        tr.append(el('td', null, `${k + 1}`), el('td', null, formatDistance(s.horizontal)), el('td', null, formatDistance(s.straight)), el('td', null, `${s.dHeight >= 0 ? '+' : ''}${s.dHeight.toFixed(1)} m`));
        table.append(tr);
      });
      const total = document.createElement('tr');
      total.style.fontWeight = '600';
      total.className = `clickable${state.selected?.line === i && state.selected.seg === null ? ' sel' : ''}`;
      total.title = '클릭하면 이 선 전체로 이동하고 강조합니다 (다시 클릭하면 해제)';
      total.addEventListener('click', () => focusMeasure(i, null));
      total.append(el('td', null, line.kind === 'area' ? '둘레' : '합계'), el('td', null, formatDistance(line.horizontal)), el('td', null, formatDistance(line.straight)), el('td'));
      table.append(total);
      if (line.kind === 'area' && line.area != null) {
        const ar = document.createElement('tr');
        ar.style.fontWeight = '600';
        const cell = el('td', null, formatArea(line.area));
        cell.colSpan = 3;
        cell.style.textAlign = 'left';
        ar.append(el('td', null, '면적'), cell);
        table.append(ar);
      }
      body.append(table);
    }
  });
  const actions = el('div', 'actions');
  if (state.active) actions.append(button(isArea ? '면 닫기' : '선 끝내기', () => measure.finish(), 'small'));
  if (state.lines.length) actions.append(button('모두 지우기', () => measure.clear(), 'small'));
  actions.append(button(state.active ? '재기 끝' : '닫기', () => (state.active ? setMeasuring(false) : measure.clear()), 'small'));
  const foot = el('div', 'm-foot'); // 항상 보이는 버튼 줄
  foot.append(actions);
  measureEl.append(foot);
  body.scrollTop = prevScroll;
}

/** 화면 위에 떠 있는 패널들 (지도를 가리는 것) 중 지금 보이는 것의 영역 (지도 캔버스 기준 px) */
function panelRects() {
  const base = viewer.canvas.getBoundingClientRect();
  return ['layers', 'measure', 'info', 'place', 'coord']
    .map((id) => $(id))
    .filter((e) => e && !e.hidden)
    .map((e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left - base.left, top: r.top - base.top, right: r.right - base.left, bottom: r.bottom - base.top };
    });
}

/**
 * 패널에서 구간(또는 선 전체)을 누르면: 그 부분을 강조하고, 위에서 수직(북쪽이 위)으로 내려다보며
 * 점들이 **패널에 가리지 않는 빈 화면 영역**에 여유 있게 다 들어오도록 카메라를 옮긴다.
 * 이미 강조 중인 것을 다시 누르면 강조만 끈다.
 */
function focusMeasure(lineIndex, seg) {
  const hit = measure.select(lineIndex, seg);
  if (!hit) return;
  const cam = viewer.camera;
  const W = viewer.canvas.clientWidth;
  const H = viewer.canvas.clientHeight;
  // 지금 카메라에서 "높이 1 m 당 화면 1px 이 나타내는 땅의 길이"를 구한다 (수직 시점에서는 높이에 비례)
  const center = cam.pickEllipsoid(new Cesium.Cartesian2(W / 2, H / 2)) ?? hit.points[0];
  const mPerPx = cam.getPixelSize(new Cesium.BoundingSphere(center, 0), W, H);
  const k = mPerPx / Cesium.Cartesian3.distance(cam.position, center);
  const carto = hit.points.map((p) => Cesium.Cartographic.fromCartesian(p));
  const fit = fitTopDown(
    carto.map((c) => ({ lon: c.longitude, lat: c.latitude })),
    freeRect(W, H, panelRects()),
    { W, H, metersPerPxPerHeight: k },
  );
  const meanHeight = carto.reduce((a, c) => a + c.height, 0) / carto.length;
  cam.flyTo({
    destination: Cesium.Cartesian3.fromRadians(fit.lon, fit.lat, fit.height + meanHeight),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 0.8,
  });
}

function setMeasuring(on, kind = 'distance') {
  if (on) {
    closePlace(); // 위치 정하기·모델 편집 중이던 것은 끝낸다 (끌어서 이동 등이 겹치지 않게)
    closeInfo();
  }
  measure.setActive(on, on ? kind : undefined);
  $('cesium').classList.toggle('picking', on);
  if (on) setStatus(kind === 'area' ? '면적 재기: 지도를 클릭해 꼭짓점을 찍으세요 (3점 이상).' : '거리 재기: 지도를 클릭해 점을 찍으세요.');
  else setStatus('');
}
// 같은 버튼을 다시 누르면 끝, 다른 종류 버튼을 누르면 그 종류로 바꾼다
btnMeasure.addEventListener('click', () => (measure.active && measure.mode === 'distance' ? setMeasuring(false) : setMeasuring(true, 'distance')));
btnArea.addEventListener('click', () => (measure.active && measure.mode === 'area' ? setMeasuring(false) : setMeasuring(true, 'area')));

function addMeasurePoint(position) {
  const w = pickWorld(position);
  if (!w) return setStatus('이 위치에는 지도가 없습니다.', 'error');
  const sn = findSnap(position, w); // 맞출 점이 가까이 있으면 그 점으로
  return measure.addPoint(sn?.cartesian ?? w.cartesian);
}
handler.setInputAction(() => {
  if (measure.active) measure.finish();
}, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
window.addEventListener('keydown', (e) => {
  if (!measure.active || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) return;
  if (e.key === 'Enter') measure.finish();
  else if (e.key === 'Escape') {
    if (measure.isDrawing()) measure.cancelCurrent();
    else setMeasuring(false);
  }
});

// ---------------------------------------------------------------- 스크린샷
$('btn-shot').addEventListener('click', async () => {
  try {
    const now = new Date();
    // 지도를 그린 직후, 같은 동작 안에서 캔버스를 복사해야 빈 화면이 되지 않는다
    viewer.scene.render();
    const cam = viewer.camera.positionCartographic;
    const target = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2), viewer.scene.globe.ellipsoid);
    const c = target ? Cesium.Cartographic.fromCartesian(target) : cam;
    const baseCredit = baseLayer?.imageryProvider.credit;
    const credit = baseCredit ? attributionText(baseCredit.html ?? baseCredit.toString?.()) : '';
    const out = composeScreenshot(viewer.canvas, {
      left: footerLeft(now, { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude), cameraHeight: cam.height }),
      right: credit ? `지도: ${credit}` : '',
    });
    const name = screenshotFileName(now);
    const size = await downloadCanvas(out, name);
    setStatus(`스크린샷을 저장했습니다: ${name} (${out.width}×${out.height}, ${(size / 1024).toFixed(0)} KB). 화면 위의 패널은 들어가지 않고 지도만 담깁니다.`);
  } catch (e) {
    setStatus(errMsg(e), 'error');
  }
});

// 시험·콘솔용
window.gis = { viewer, layers, folders, openTilesFromFiles, startGlb, placeModel, startVector, startDem, startDemText, startDemFiles, startTerrainTiles, openDropped, highlighter, measure, pickWorld, showClickInfo, goHome, Cesium };
