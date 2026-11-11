/**
 * 지형(DEM) 열기 패널: 읽은 GeoTIFF의 정보를 보여 주고, 좌표계와 높이 보정을 정한 뒤 연다. DOM만 다루고 Cesium은 모른다.
 */
import { CRS_LIST, customCrsList } from '../../viewer/src/kit/crsList.js';
import { enhanceCrsSelect } from '../../viewer/src/kit/crsPicker.js';
import { isNearKorea } from '../../viewer/src/kit/crsList.js';
import { guessDemCrs, lonLatExtent } from './demCore.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** 격자 좌표계로 고를 수 있는 목록 (대표 좌표계 + 지금까지 직접 추가한 것). 그 밖의 좌표계는 "직접 입력…" 으로 추가한다. */
export const demCrsChoices = () => [...CRS_LIST, ...customCrsList()].map((c) => ({ code: c.code, label: c.label }));

/**
 * @param {HTMLElement} panel
 * @param {Awaited<ReturnType<import('./demLoad.js').readDemFile>>} dem
 * @param {{ replacing?:boolean, onConfirm:(o:{crs:string, offset:number})=>void|Promise<void>, onCancel:()=>void }} o
 */
export function showDemPanel(panel, dem, { replacing = false, onConfirm, onCancel }) {
  panel.replaceChildren();
  panel.hidden = false;
  panel.append(el('h2', null, '지형(DEM) 열기'));
  const st = dem.stats;
  const res = dem.resolution[0] === dem.resolution[1] ? `${dem.resolution[0]}` : `${dem.resolution[0]} × ${dem.resolution[1]}`;
  const size = dem.tiles ? `도엽 ${dem.tiles.length}장 · 화소 ${dem.stats.valid.toLocaleString('ko-KR')}개` : `${dem.width.toLocaleString('ko-KR')} × ${dem.height.toLocaleString('ko-KR')} 화소`;
  panel.append(el('div', 'sub', `${dem.name} · ${size} · 해상도 ${res} (좌표계 단위)${dem.bands > 1 ? ` · 밴드 ${dem.bands}개 중 1번 사용` : ''}`));
  if (st.min != null) panel.append(el('div', 'sub', `높이 최소 ${st.min.toFixed(1)} m · 최대 ${st.max.toFixed(1)} m · 평균 ${st.mean.toFixed(1)} m${st.invalid ? ` · 값 없음 ${st.invalid.toLocaleString('ko-KR')}개` : ''}`));
  else panel.append(el('div', 'warn', '값이 있는 화소가 없습니다 (모두 값 없음).'));
  if (replacing) panel.append(el('div', 'warn', '이미 열린 지형이 있습니다. 열면 지금 지형을 대체합니다.'));

  const form = el('div', 'form');
  const crsSel = document.createElement('select');
  for (const c of demCrsChoices()) {
    const o = document.createElement('option');
    o.value = c.code;
    o.textContent = c.label;
    crsSel.appendChild(o);
  }
  enhanceCrsSelect(crsSel); // 목록에 없는 좌표계(해외, 옛 좌표계)는 직접 입력
  const guessed = dem.crs ?? guessDemCrs(dem.bbox);
  crsSel.value = guessed ?? 'EPSG:5186';
  const offsetIn = document.createElement('input');
  offsetIn.type = 'number';
  offsetIn.step = 'any';
  offsetIn.value = '0';
  form.append(el('label', null, '좌표계'), crsSel, el('label', null, '높이 보정 (m)'), offsetIn);

  const source = el('div', 'sub');
  const detail = el('div', 'sub');
  const warn = el('div', 'warn');
  const err = el('div', 'warn');
  const open = el('button', 'primary', '지형 열기');
  open.type = 'button';
  const cancel = el('button', null, '취소');
  cancel.type = 'button';

  const refresh = () => {
    const code = crsSel.value;
    warn.textContent = '';
    try {
      const ext = lonLatExtent(dem.bbox, code);
      if (!ext.every(Number.isFinite) || Math.abs(ext[0]) > 180 || Math.abs(ext[2]) > 180 || Math.abs(ext[1]) > 90 || Math.abs(ext[3]) > 90) throw new Error('범위가 지구를 벗어납니다');
      detail.textContent = `이 좌표계로 읽으면: 경도 ${ext[0].toFixed(5)} ~ ${ext[2].toFixed(5)}, 위도 ${ext[1].toFixed(5)} ~ ${ext[3].toFixed(5)}`;
      if (!isNearKorea({ lon: (ext[0] + ext[2]) / 2, lat: (ext[1] + ext[3]) / 2 })) warn.textContent = '한국 밖입니다. 해외 자료가 맞다면 그대로 두고, 아니라면 좌표계를 확인하세요.';
      else if (['EPSG:5185', 'EPSG:5186', 'EPSG:5187'].includes(code)) warn.textContent = '서부·중부·동부원점(5185/5186/5187)은 값이 비슷해서, 틀리면 위치가 수십~수백 km 어긋납니다. 위 경도로 확인하세요.';
      open.disabled = false;
    } catch (e) {
      detail.textContent = '';
      warn.textContent = `이 좌표계로는 읽을 수 없습니다 (${e.message}). 다른 좌표계를 고르세요.`;
      open.disabled = true;
    }
  };
  source.textContent = dem.crs
    ? `좌표계: 파일에서 읽음 (${dem.crs})`
    : dem.crsHint
      ? `파일의 좌표계(${dem.crsHint})는 지원하지 않거나 알 수 없습니다. ${guessed ? `범위 값으로 ${guessed}를 추정했습니다. ` : ''}직접 고르세요.`
      : `파일에 좌표계 정보가 없습니다. ${guessed ? `범위 값으로 ${guessed}를 추정했습니다. ` : ''}직접 고르세요.`;
  crsSel.addEventListener('change', refresh);

  const note = el('div', 'sub', '높이 보정: 표고(해수면 기준) DEM은 지도의 타원체고와 한국에서 대략 20~30 m 차이가 납니다. 3D 타일이나 GPS 높이(타원체고)와 맞추려면 그 차이를 넣으세요. 범위 밖과 값 없는 곳은 높이 0입니다.');
  open.addEventListener('click', async () => {
    const offset = Number(offsetIn.value);
    if (!Number.isFinite(offset)) {
      err.textContent = '높이 보정은 숫자로 입력하세요.';
      return;
    }
    err.textContent = '';
    open.disabled = true;
    try {
      await onConfirm({ crs: crsSel.value, offset });
    } catch (e) {
      err.textContent = String(e?.message ?? e);
      open.disabled = false;
    }
  });
  cancel.addEventListener('click', onCancel);

  const actions = el('div', 'actions');
  actions.append(open, cancel);
  panel.append(source, form, detail, warn, note, err, actions);
  refresh();
}
