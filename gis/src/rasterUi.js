/**
 * 이미지(항공·위성 사진, 월드파일 이미지) 열기 패널: 어느 좌표계인지 확인하고, 투명·불투명도를 정한 뒤 지도에 겹친다.
 */
import { CRS_LIST, customCrsList, isNearKorea } from '../../viewer/src/kit/crsList.js';
import { enhanceCrsSelect } from '../../viewer/src/kit/crsPicker.js';
import { lonLatExtent } from './demCore.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * @param {HTMLElement} panel
 * @param {{name:string, srcWidth:number, srcHeight:number, bbox:number[], crs:string|null, crsHint:string, guessedCrs:string|null, blackCorners:boolean}} info
 * @param {{onConfirm:(o:{crs:string, transparentBlack:boolean, opacity:number})=>void|Promise<void>, onCancel:()=>void}} o
 */
export function showRasterPanel(panel, info, { onConfirm, onCancel }) {
  panel.replaceChildren();
  panel.hidden = false;
  panel.append(el('h2', null, '이미지 열기 (지도 위에 겹치기)'));
  panel.append(el('div', 'sub', `${info.name} · ${info.srcWidth.toLocaleString('ko-KR')} × ${info.srcHeight.toLocaleString('ko-KR')} 화소`));

  if (info.note) panel.append(el('div', 'sub', info.note));

  const form = el('div', 'form');
  const crsSel = document.createElement('select');
  for (const c of [...CRS_LIST, ...customCrsList()]) {
    const o = document.createElement('option');
    o.value = c.code;
    o.textContent = c.label;
    crsSel.appendChild(o);
  }
  enhanceCrsSelect(crsSel);
  const initial = info.crs ?? info.guessedCrs ?? 'EPSG:4326';
  crsSel.value = [...crsSel.options].some((o) => o.value === initial) ? initial : 'EPSG:4326';

  const black = document.createElement('input');
  black.type = 'checkbox';
  black.checked = !!info.blackCorners;
  const blackRow = el('label');
  blackRow.append(black, document.createTextNode(' 검은색(0,0,0)을 투명으로 (사진 둘레의 검은 테두리 제거)'));
  blackRow.style.gridColumn = '1 / -1';

  const opacity = document.createElement('input');
  opacity.type = 'range';
  opacity.min = '0.2';
  opacity.max = '1';
  opacity.step = '0.05';
  opacity.value = '1';
  form.append(el('label', null, '좌표계'), crsSel, el('label', null, '불투명도'), opacity, blackRow);

  const source = el('div', 'sub');
  source.textContent = info.crs
    ? `좌표계: 파일에서 읽음 (${info.crs})`
    : info.crsHint
      ? `파일의 좌표계(${info.crsHint})는 목록에 없습니다. ${info.guessedCrs ? `범위 값으로 ${info.guessedCrs}를 추정했습니다. ` : ''}직접 고르거나 "좌표계 직접 입력…"을 쓰세요.`
      : `좌표계 정보가 없습니다. ${info.guessedCrs ? `범위 값으로 ${info.guessedCrs}를 추정했습니다. ` : ''}직접 고르세요. (월드파일 옆에 .prj 가 있으면 같이 고르면 자동으로 읽습니다)`;

  const detail = el('div', 'sub');
  const warn = el('div', 'warn');
  const err = el('div', 'warn');
  const open = el('button', 'primary', '이미지 열기');
  open.type = 'button';
  const cancel = el('button', null, '취소');
  cancel.type = 'button';

  const refresh = () => {
    warn.textContent = '';
    try {
      const ext = lonLatExtent(info.bbox, crsSel.value);
      if (!ext.every(Number.isFinite) || Math.abs(ext[0]) > 180 || Math.abs(ext[2]) > 180 || Math.abs(ext[1]) > 90 || Math.abs(ext[3]) > 90) throw new Error('범위가 지구를 벗어납니다');
      detail.textContent = `이 좌표계로 읽으면: 경도 ${ext[0].toFixed(5)} ~ ${ext[2].toFixed(5)}, 위도 ${ext[1].toFixed(5)} ~ ${ext[3].toFixed(5)}`;
      if (!isNearKorea({ lon: (ext[0] + ext[2]) / 2, lat: (ext[1] + ext[3]) / 2 })) warn.textContent = '한국 밖입니다. 해외 자료가 맞다면 그대로 두고, 아니라면 좌표계를 확인하세요.';
      open.disabled = false;
    } catch (e) {
      detail.textContent = '';
      warn.textContent = `이 좌표계로는 읽을 수 없습니다 (${e.message}). 다른 좌표계를 고르세요.`;
      open.disabled = true;
    }
  };
  crsSel.addEventListener('change', refresh);

  open.addEventListener('click', async () => {
    err.textContent = '';
    open.disabled = true;
    try {
      await onConfirm({ crs: crsSel.value, transparentBlack: black.checked, opacity: Number(opacity.value) });
    } catch (e) {
      err.textContent = String(e?.message ?? e);
      open.disabled = false;
    }
  });
  cancel.addEventListener('click', onCancel);

  const actions = el('div', 'actions');
  actions.append(open, cancel);
  panel.append(source, form, detail, warn, err, actions);
  refresh();
}
