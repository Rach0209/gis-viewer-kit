/**
 * 내려받기·복사 화면 조각: 벡터 레이어 저장 패널, 복사 버튼, 파일 내려받기. Cesium을 모른다.
 */
import { CRS_LIST, customCrsList } from '../../viewer/src/kit/crsList.js';
import { enhanceCrsSelect } from '../../viewer/src/kit/crsPicker.js';
import { safeFileName, toCsvText, toGeoJsonText } from './exportData.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** 글을 파일로 내려받는다 (브라우저 안에서 만들어 바로 저장, 어디로도 보내지 않는다) */
export function downloadText(fileName, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** 클립보드에 복사. 막힌 환경이면 선택해서 복사할 수 있게 임시 글상자를 쓴다. 성공 여부를 돌려준다 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/**
 * 벡터 레이어 저장 패널.
 * @param {HTMLElement} panel
 * @param {{name:string, collection:object, count:number}} layer
 * @param {{onDone:(msg:string)=>void, onCancel:()=>void}} o
 */
export function showExportPanel(panel, { name, collection, count }, { onDone, onCancel }) {
  panel.replaceChildren();
  panel.hidden = false;
  panel.append(el('h2', null, '저장하기 (내려받기)'));
  panel.append(el('div', 'sub', `${name} · 피처 ${count.toLocaleString('ko-KR')}개. 이 브라우저 안에서 파일을 만들어 바로 저장합니다 (어디로도 보내지 않습니다).`));

  const form = el('div', 'form');
  const fmt = document.createElement('select');
  for (const [v, l] of [['geojson', 'GeoJSON (.geojson)'], ['csv', 'CSV (.csv, 엑셀용 — 점은 경도·위도 열, 선·면은 WKT 열)']]) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = l;
    fmt.appendChild(o);
  }
  const crsSel = document.createElement('select');
  for (const c of [...CRS_LIST, ...customCrsList()]) {
    const o = document.createElement('option');
    o.value = c.code;
    o.textContent = c.label;
    crsSel.appendChild(o);
  }
  enhanceCrsSelect(crsSel);
  crsSel.value = 'EPSG:4326';
  form.append(el('label', null, '형식'), fmt, el('label', null, '좌표계'), crsSel);

  const note = el('div', 'sub');
  const refreshNote = () => {
    note.textContent =
      crsSel.value === 'EPSG:4326'
        ? '경위도(WGS84)로 저장합니다. 대부분의 프로그램이 그대로 읽습니다.'
        : `좌표를 ${crsSel.value}(으)로 바꿔 저장합니다.${fmt.value === 'geojson' ? ' GeoJSON 에는 좌표계 이름(crs)을 함께 적습니다 (QGIS·ArcGIS는 읽지만, 일부 웹 도구는 경위도만 기대합니다).' : ''}`;
  };
  fmt.addEventListener('change', refreshNote);
  crsSel.addEventListener('change', refreshNote);
  refreshNote();

  const err = el('div', 'warn');
  const save = el('button', 'primary', '저장');
  save.type = 'button';
  const cancel = el('button', null, '닫기');
  cancel.type = 'button';
  save.addEventListener('click', () => {
    err.textContent = '';
    try {
      const crs = crsSel.value;
      if (fmt.value === 'geojson') {
        const file = safeFileName(name, 'geojson');
        downloadText(file, toGeoJsonText(collection, { crs }), 'application/geo+json');
        onDone(`저장했습니다: ${file} (${crs})`);
      } else {
        const file = safeFileName(name, 'csv');
        downloadText(file, toCsvText(collection, { crs }), 'text/csv;charset=utf-8');
        onDone(`저장했습니다: ${file} (${crs})`);
      }
    } catch (e) {
      err.textContent = String(e?.message ?? e);
    }
  });
  cancel.addEventListener('click', onCancel);
  const actions = el('div', 'actions');
  actions.append(save, cancel);
  panel.append(form, note, err, actions);
}
