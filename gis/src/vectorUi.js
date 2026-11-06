/**
 * GeoJSON/SHP 열기 패널: 파일을 읽은 결과를 보여 주고, 인코딩·좌표계를 바꿔 가며 확인한 뒤 연다.
 * 한글이 깨져 보이거나 위치가 어긋나 보이면 여기서 고른다 (설정을 바꾸면 바로 다시 계산해서 미리 보여 준다).
 */
import { CRS_CHOICES, buildCollection } from './vectorParse.js';
import { pickRule } from './sld.js';

const ENCODING_CHOICES = [
  ['auto', '자동 판별'],
  ['utf-8', 'UTF-8'],
  ['euc-kr', 'EUC-KR / CP949 (한글 윈도우 기본)'],
  ['windows-1252', 'Windows-1252 (영문)'],
];

const ENCODING_SOURCE = {
  cpg: '.cpg 파일',
  ascii: '영문·숫자만 있음',
  utf8: '내용으로 판단',
  'euc-kr-guess': '내용으로 판단(UTF-8이 아니라서)',
  user: '직접 선택',
};
const CRS_SOURCE = { prj: '.prj', 'geojson-crs': 'GeoJSON crs', guess: '좌표 범위로 추정', default: '기본값', user: '직접 선택' };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function select(options, value) {
  const s = document.createElement('select');
  for (const [v, l] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = l;
    s.appendChild(o);
  }
  s.value = value;
  return s;
}

const sampleText = (props) =>
  props ? Object.entries(props).slice(0, 4).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') : '(속성 없음)';

/**
 * @param {HTMLElement} panel 비어 있는 패널 요소 (이 함수가 내용을 채운다)
 * @param {Array<{name:string, raw:object}>} items 읽은 파일 묶음(원본)
 * @param {{skipped?:string[], styles?:Array<{name:string, style:object}>, onConfirm:(results:Array<{name:string, collection:object, info:object, style:object|null}>)=>void|Promise<void>, onCancel:()=>void}} o
 *   styles: 같이 읽은 SLD 스타일 (parseSld 결과). 데이터가 쓰는 속성이 모두 있는 스타일을 자동으로 고른다.
 */
export function showVectorPanel(panel, items, { skipped = [], styles = [], onConfirm, onCancel }) {
  panel.replaceChildren();
  panel.hidden = false;
  panel.append(el('h2', null, 'GeoJSON / SHP 열기'));
  panel.append(el('div', 'sub', '한글이 깨져 보이거나 위치가 어긋나 보이면 아래에서 인코딩·좌표계를 고르세요.'));
  if (skipped.length) panel.append(el('div', 'warn', `건너뛴 파일: ${skipped.slice(0, 6).join(', ')}${skipped.length > 6 ? ' …' : ''}`));

  const states = items.map((item) => ({ item, opts: { encoding: 'auto', crs: 'auto' }, result: null, styleIndex: null }));

  for (const st of states) {
    const fs = el('fieldset');
    const legend = el('legend', null, `${st.item.name} (${st.item.raw.kind === 'shp' ? 'SHP' : 'GeoJSON'})`);
    fs.append(legend);
    const summary = el('div', 'sub');
    const form = el('div', 'form');
    const crsSel = select([['auto', '자동 (.prj / 추정)'], ...CRS_CHOICES.map((c) => [c.code, c.label])], 'auto');
    form.append(el('label', null, '좌표계'), crsSel);
    let encSel = null;
    if (st.item.raw.kind === 'shp' && st.item.raw.dbfBuf) {
      encSel = select(ENCODING_CHOICES, 'auto');
      form.append(el('label', null, '속성 인코딩'), encSel);
    }
    let styleSel = null;
    if (styles.length) {
      styleSel = select([['-1', '스타일 없음'], ...styles.map((s, i) => [String(i), `SLD: ${s.name}`])], '-1');
      form.append(el('label', null, '스타일(SLD)'), styleSel);
    }
    const detail = el('div', 'sub');
    const sample = el('div', 'sample');
    const styleInfo = el('div', 'sub');
    const warns = el('div');
    fs.append(summary, form, detail, sample, styleInfo, warns);
    panel.append(fs);

    /** 이 데이터가 가진 속성 이름을 모두 쓰는 스타일을 찾는다 (SLD 필터가 가리키는 속성이 있어야 칠할 수 있다) */
    const autoStyleIndex = () => {
      const keys = new Set(Object.keys(st.result?.info.sampleProperties ?? {}));
      return styles.findIndex((s) => s.style.properties.length > 0 && s.style.properties.every((p) => keys.has(p)));
    };
    const refreshStyle = () => {
      const msgs = [];
      styleInfo.textContent = '';
      if (st.styleIndex >= 0 && st.result) {
        const style = styles[st.styleIndex].style;
        let matched = 0;
        for (const f of st.result.collection.features) if (pickRule(style, f.properties)) matched++;
        const none = st.result.info.count - matched;
        styleInfo.textContent = `스타일: 규칙 ${style.rules.length}개 · 적용 ${matched.toLocaleString('ko-KR')}개${none ? ` · 해당 없음(감춤) ${none.toLocaleString('ko-KR')}개` : ''}`;
        const keys = new Set(Object.keys(st.result.info.sampleProperties ?? {}));
        const missing = style.properties.filter((p) => !keys.has(p));
        if (missing.length) msgs.push(`스타일이 쓰는 속성(${missing.join(', ')})이 이 데이터에 없습니다. 모든 피처가 "해당 없음"이 될 수 있습니다.`);
        msgs.push(...style.warnings);
      }
      return msgs;
    };

    const recompute = () => {
      try {
        st.result = buildCollection(st.item.raw, st.opts);
      } catch (e) {
        st.result = null;
        warns.replaceChildren(el('div', 'warn', e.message));
        return;
      }
      const { info } = st.result;
      summary.textContent = `피처 ${info.count.toLocaleString('ko-KR')}개 · ${info.geometryTypes.join(', ') || '-'}`;
      detail.textContent =
        `좌표계: ${info.crs.label} (${CRS_SOURCE[info.crs.source] ?? info.crs.source})` +
        (info.center ? ` · 중심 경도 ${info.center.lon.toFixed(5)}, 위도 ${info.center.lat.toFixed(5)}` : '') +
        (info.encoding ? ` · 인코딩: ${info.encoding.encoding} (${ENCODING_SOURCE[info.encoding.source] ?? info.encoding.source})` : '');
      sample.textContent = info.encoding || st.item.raw.kind === 'geojson' ? `속성 예: ${sampleText(info.sampleProperties)}` : '';
      if (st.styleIndex === null) {
        // 처음 한 번: 맞는 스타일이 있으면 자동으로 고른다
        st.styleIndex = autoStyleIndex();
        if (styleSel) styleSel.value = String(st.styleIndex);
      }
      warns.replaceChildren(...[...info.warnings, ...refreshStyle()].map((w) => el('div', 'warn', w)));
    };
    styleSel?.addEventListener('change', () => {
      st.styleIndex = Number(styleSel.value);
      recompute();
    });
    crsSel.addEventListener('change', () => {
      st.opts = { ...st.opts, crs: crsSel.value };
      recompute();
    });
    encSel?.addEventListener('change', () => {
      st.opts = { ...st.opts, encoding: encSel.value };
      recompute();
    });
    recompute();
  }

  const actions = el('div', 'actions');
  const ok = el('button', 'primary', '열기');
  ok.type = 'button';
  ok.addEventListener('click', async () => {
    const results = states.filter((s) => s.result).map((s) => ({ name: s.item.name, collection: s.result.collection, info: s.result.info, style: s.styleIndex >= 0 ? styles[s.styleIndex].style : null }));
    if (!results.length) return;
    ok.disabled = true;
    try {
      await onConfirm(results);
    } finally {
      ok.disabled = false;
    }
  });
  const cancel = el('button', null, '취소');
  cancel.type = 'button';
  cancel.addEventListener('click', onCancel);
  actions.append(ok, cancel);
  panel.append(actions);
}
