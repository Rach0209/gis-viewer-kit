/**
 * 좌표계 선택 칸(<select>)에 "좌표계 직접 입력…"을 붙인다. 3D 뷰어(glb 위치)와 GIS 작업실(SHP·지형·마우스 좌표)이 같이 쓴다.
 *
 * 고르면 작은 입력 창이 떠서 EPSG 번호(목록에 없으면 인터넷에서 정의를 가져옴), PROJ 문자열, WKT(.prj 내용)를 받는다.
 * 성공하면 모든 좌표계 선택 칸에 새 항목이 생기고, 이 칸이 그 값으로 바뀌면서 'change' 이벤트가 나간다
 * (그래서 기존 코드는 그대로 `select.value` 와 'change' 만 쓰면 된다).
 *
 * 주의: 기존 코드의 'change' 구독보다 먼저 enhanceCrsSelect(select) 를 불러야 한다
 * ("직접 입력…"을 골랐을 때 그 이벤트가 기존 코드에 닿지 않도록 막기 때문이다).
 */
import { customCrsList } from './crsList.js';
import { resolveCrsInput, restoreRecentCrs } from './crsLookup.js';

export const CUSTOM_VALUE = '__custom__';

/** 이 페이지에서 만든 선택 칸들 -> 새 좌표계 항목을 만들 때 쓸 글자 함수 */
const registry = new Map();
let restored = false;

function optionFor(select, info) {
  if ([...select.options].some((o) => o.value === info.code)) return;
  const o = document.createElement('option');
  o.value = info.code;
  o.textContent = registry.get(select)?.optionText(info) ?? info.label;
  o.title = info.label;
  const custom = [...select.options].find((x) => x.value === CUSTOM_VALUE);
  select.insertBefore(o, custom ?? null);
}

function addEverywhere(info) {
  for (const sel of [...registry.keys()]) {
    if (!sel.isConnected && registry.size > 40) registry.delete(sel); // 사라진 패널의 칸은 정리 (너무 쌓일 때만)
    else optionFor(sel, info);
  }
}

const css = (el, style) => Object.assign(el.style, style);

/** 입력 창을 띄우고 결과 CrsInfo(취소하면 null)를 돌려준다 */
export function openCrsDialog() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    css(overlay, { position: 'fixed', inset: '0', background: 'rgba(0,0,0,.55)', zIndex: '100000', display: 'flex', alignItems: 'center', justifyContent: 'center' });
    const box = document.createElement('div');
    css(box, { width: 'min(520px, 92vw)', background: '#14191d', color: '#e8edf0', border: '1px solid #2b353c', borderRadius: '6px', padding: '14px 16px', font: '13px/1.5 system-ui, sans-serif', boxShadow: '0 8px 30px rgba(0,0,0,.5)' });
    const h = document.createElement('div');
    h.textContent = '좌표계 직접 입력';
    css(h, { fontSize: '15px', fontWeight: '600', marginBottom: '6px' });
    const help = document.createElement('div');
    help.innerHTML =
      'EPSG 번호, PROJ 문자열, 또는 <code>.prj</code> 파일 내용(WKT)을 넣으세요.<br>' +
      '예) <code>EPSG:2154</code> (프랑스), <code>EPSG:32633</code> (UTM 33N), <code>EPSG:6677</code> (일본)<br>' +
      '<span style="opacity:.7">목록에 없는 EPSG 번호는 인터넷(epsg.io)에서 정의만 가져옵니다. 자료는 어디로도 보내지 않습니다.</span>';
    css(help, { fontSize: '12px', marginBottom: '8px' });
    const ta = document.createElement('textarea');
    ta.rows = 3;
    ta.placeholder = 'EPSG:2154';
    ta.spellcheck = false;
    css(ta, { width: '100%', boxSizing: 'border-box', background: '#0f1318', color: 'inherit', border: '1px solid #2b353c', borderRadius: '4px', padding: '6px 8px', font: '12px ui-monospace, Consolas, monospace', resize: 'vertical' });
    const msg = document.createElement('div');
    css(msg, { minHeight: '1.4em', margin: '6px 0', fontSize: '12px', color: '#ff8a80' });
    const row = document.createElement('div');
    css(row, { display: 'flex', gap: '8px', justifyContent: 'flex-end' });
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = '적용';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '취소';
    for (const b of [ok, cancel]) css(b, { padding: '4px 14px', background: '#1d2a31', color: 'inherit', border: '1px solid #3a4a54', borderRadius: '4px', cursor: 'pointer', font: 'inherit' });
    row.append(cancel, ok);
    box.append(h, help, ta, msg, row);
    overlay.append(box);
    document.body.append(overlay);
    ta.focus();

    const close = (v) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const apply = async () => {
      msg.style.color = '#9fb3bd';
      msg.textContent = '확인하는 중…';
      ok.disabled = true;
      try {
        close(await resolveCrsInput(ta.value));
      } catch (e) {
        msg.style.color = '#ff8a80';
        msg.textContent = e?.message ?? String(e);
        ok.disabled = false;
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !ta.value.includes('\n'))) {
        if (document.activeElement === ta && !ok.disabled) {
          e.preventDefault();
          apply();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    ok.addEventListener('click', apply);
    cancel.addEventListener('click', () => close(null));
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close(null);
    });
  });
}

/**
 * @param {HTMLSelectElement} select 좌표계 코드를 value 로 갖는 선택 칸
 * @param {{optionText?:(info:import('./crsList.js').CrsInfo)=>string}} [o] 새 항목에 보일 글자 (칸마다 모양이 달라서)
 */
export function enhanceCrsSelect(select, { optionText = (info) => info.label } = {}) {
  if (!restored) {
    restored = true;
    restoreRecentCrs();
  }
  registry.set(select, { optionText });
  const custom = document.createElement('option');
  custom.value = CUSTOM_VALUE;
  custom.textContent = '좌표계 직접 입력… (EPSG 번호·PROJ·WKT)';
  select.appendChild(custom);
  for (const info of customCrsList()) optionFor(select, info);
  select.dataset.prev = select.value;

  select.addEventListener('change', (e) => {
    if (select.value !== CUSTOM_VALUE) {
      select.dataset.prev = select.value;
      return;
    }
    e.stopImmediatePropagation(); // 기존 코드는 "직접 입력…"이라는 값을 받지 않게 한다
    const back = select.dataset.prev;
    select.value = back;
    openCrsDialog().then((info) => {
      if (!info) return;
      addEverywhere(info);
      select.value = info.code;
      select.dataset.prev = info.code;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  return select;
}
