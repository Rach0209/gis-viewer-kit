/**
 * GeoJSON/SHP 열기 패널: 파일을 읽은 결과를 보여 주고, 인코딩·좌표계를 바꿔 가며 확인한 뒤 연다.
 * 한글이 깨져 보이거나 위치가 어긋나 보이면 여기서 고른다 (설정을 바꾸면 바로 다시 계산해서 미리 보여 준다).
 */
import { CRS_LIST } from '../../viewer/src/kit/crsList.js';
import { enhanceCrsSelect } from '../../viewer/src/kit/crsPicker.js';
import { explainSkipped } from './diagnose.js';
import { problemNode } from './diagnoseUi.js';
import { POINT_STYLES, hasPointGeometry, lightPointStyleFor, loadPointStyle, pointStyleSpec, savePointStyle } from './pointStyles.js';
import { pickRule } from './sld.js';

const CRS_CHOICES = CRS_LIST.map((c) => ({ code: c.code, label: c.label }));

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
const CRS_SOURCE = { prj: '.prj', 'geojson-crs': 'GeoJSON crs', guess: '좌표 범위로 추정', default: '기본값', user: '직접 선택', format: 'KML·GPX 규격', gpkg: 'GeoPackage 파일 안의 정의' };

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
 * @param {{skipped?:string[] (건너뛴 파일 경로), errors?:string[] (읽다가 난 오류 안내), styles?:Array<{name:string, style:object}>, onConfirm:(results:Array<{name:string, collection:object, info:object, style:object|null}>)=>void|Promise<void>, onCancel:()=>void}} o
 *   styles: 같이 읽은 SLD 스타일 (parseSld 결과). 데이터가 쓰는 속성이 모두 있는 스타일을 자동으로 고른다.
 */
export function showVectorPanel(panel, items, { skipped = [], errors = [], styles = [], onConfirm, onCancel }) {
  panel.replaceChildren();
  panel.hidden = false;
  panel.append(el('h2', null, '벡터 자료 열기'));
  panel.append(el('div', 'sub', '한글이 깨져 보이거나 위치가 어긋나 보이면 아래에서 인코딩·좌표계를 고르세요.'));
  // 읽다가 난 오류와 건너뛴 파일은 이유와 해결 방법을 같이 보여 준다
  for (const m of [...errors, ...explainSkipped(skipped)]) panel.append(problemNode(m));

  const states = items.map((item) => ({ item, opts: { encoding: 'auto', crs: 'auto' }, result: null, styleIndex: null, pending: false, useHeights: false, heightOffset: 0, pointStyle: loadPointStyle() }));
  // 계산이 끝나지 않았거나 열 수 있는 게 없으면 "열기"를 잠근다
  let okBtn = null;
  let confirming = false;
  const refreshOk = () => {
    if (okBtn) okBtn.disabled = confirming || states.some((s) => s.pending) || !states.some((s) => s.result);
  };

  for (const st of states) {
    const fs = el('fieldset');
    const legend = el('legend', null, `${st.item.name} (${st.item.label ?? st.item.kind})`);
    fs.append(legend);
    const summary = el('div', 'sub');
    const form = el('div', 'form');
    const crsSel = select([['auto', '자동 (.prj · 추정 · 형식 규격)'], ...CRS_CHOICES.map((c) => [c.code, c.label])], 'auto');
    enhanceCrsSelect(crsSel); // 목록에 없는 좌표계(해외, 옛 좌표계)는 직접 입력
    form.append(el('label', null, '좌표계'), crsSel);
    let encSel = null;
    if (st.item.hasEncoding ?? (st.item.kind === 'shp' && st.item.hasDbf)) {
      encSel = select(ENCODING_CHOICES, 'auto');
      form.append(el('label', null, '속성 인코딩'), encSel);
    }
    // CSV: 경도(X)·위도(Y) 열과 구분자를 고른다 (처음에는 열 이름·값으로 자동으로 고르고, 계산 뒤 목록을 채운다)
    let delimSel = null;
    let xSel = null;
    let ySel = null;
    if (st.item.kind === 'csv') {
      delimSel = select([['auto', '자동'], [',', '쉼표 ,'], ['	', '탭'], [';', '세미콜론 ;'], ['|', '세로줄 |']], 'auto');
      xSel = select([['-1', '(자동)']], '-1');
      ySel = select([['-1', '(자동)']], '-1');
      form.append(el('label', null, '구분자'), delimSel, el('label', null, '경도(X) 열'), xSel, el('label', null, '위도(Y) 열'), ySel);
    }
    let styleSel = null;
    if (styles.length) {
      styleSel = select([['-1', '스타일 없음'], ...styles.map((s, i) => [String(i), `SLD: ${s.name}`])], '-1');
      form.append(el('label', null, '스타일(SLD)'), styleSel);
    }
    // 높이: 좌표에 높이(세 번째 값)가 있는 자료(KML, GPX, 3차원 SHP)에서만 보인다. 기본은 모두 지면에 붙인다.
    const heightRow = el('div', 'sub');
    heightRow.hidden = true;
    const useH = document.createElement('input');
    useH.type = 'checkbox';
    const useHLabel = el('label');
    useHLabel.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer';
    useHLabel.append(useH, document.createTextNode('파일의 높이 사용 (지면에 붙이지 않고 좌표의 높이대로 그림)'));
    const offsetIn = document.createElement('input');
    offsetIn.type = 'number';
    offsetIn.step = 'any';
    offsetIn.value = '0';
    offsetIn.disabled = true;
    offsetIn.style.width = '72px';
    const offsetRow = el('label');
    offsetRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:2px';
    offsetRow.append(document.createTextNode('높이 보정 (m)'), offsetIn);
    const offsetNote = el('div', 'sub', '구글어스·GPS 높이는 보통 해수면 기준 표고라, 지도의 타원체고와 한국에서 대략 25~30 m 차이가 납니다. 건물·지형 위에 정확히 얹으려면 그 차이를 넣으세요. 이 자료에 높이가 있어 "지면에 붙이기"를 끄고 쓸 수 있습니다.');
    heightRow.append(useHLabel, offsetRow, offsetNote);
    useH.addEventListener('change', () => {
      st.useHeights = useH.checked;
      offsetIn.disabled = !useH.checked;
    });
    offsetIn.addEventListener('input', () => {
      st.heightOffset = Number(offsetIn.value) || 0;
    });
    // X·Y 순서 바꾸기: 위도, 경도 순으로 저장된 자료(진단이 알아차렸을 때만 보인다)
    const swapRow = el('label');
    swapRow.hidden = true;
    swapRow.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;margin:4px 0';
    const swapCb = document.createElement('input');
    swapCb.type = 'checkbox';
    swapRow.append(swapCb, document.createTextNode('X·Y 순서 바꾸기 (좌표가 위도, 경도 순으로 저장된 자료)'));
    swapCb.addEventListener('change', () => {
      st.opts = { ...st.opts, swapXY: swapCb.checked };
      recompute();
    });
    // 점 모양: 점이 있는 자료에서만 보인다. 마지막으로 고른 모양을 기억해 다음에도 기본으로 쓴다.
    const pointRow = el('div', 'form');
    pointRow.hidden = true;
    const pointSel = select(POINT_STYLES.map((p) => [p.id, p.label]), st.pointStyle);
    pointSel.title = '점을 지도에 그리는 모양. 점이 아주 많으면 "작은 점"이 보기 좋고 가볍습니다. 열고 난 뒤에도 레이어 줄에서 바꿀 수 있습니다.';
    pointRow.append(el('label', null, '점 모양'), pointSel);
    const pointNote = el('div', 'sub'); // 점이 많아서 모양을 바꿔 열 때 이유를 알려 준다
    pointNote.hidden = true;
    pointSel.addEventListener('change', () => {
      st.pointStyle = pointSel.value;
      savePointStyle(st.pointStyle);
      pointNote.hidden = true; // 직접 골랐으니 안내는 접는다
    });
    const detail = el('div', 'sub');
    const sample = el('div', 'sample');
    const styleInfo = el('div', 'sub');
    const warns = el('div');
    fs.append(summary, form, swapRow, pointRow, pointNote, detail, sample, styleInfo, heightRow, warns);
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

    // 계산은 워커가 하므로 기다리는 동안 화면은 그대로 움직인다. 설정을 연달아 바꾸면 마지막 것만 반영한다.
    let latest = 0;
    const recompute = async () => {
      const mine = ++latest;
      st.pending = true;
      refreshOk();
      summary.textContent = '계산 중…';
      let result;
      try {
        result = await st.item.build(st.opts);
      } catch (e) {
        if (mine !== latest) return;
        st.pending = false;
        st.result = null;
        warns.replaceChildren(problemNode(e.message));
        refreshOk();
        return;
      }
      if (mine !== latest) return;
      st.pending = false;
      st.result = result;
      refreshOk();
      const { info } = st.result;
      summary.textContent = `피처 ${info.count.toLocaleString('ko-KR')}개 · ${info.geometryTypes.join(', ') || '-'}`;
      detail.textContent =
        `좌표계: ${info.crs.label} (${CRS_SOURCE[info.crs.source] ?? info.crs.source})` +
        (info.center ? ` · 중심 경도 ${info.center.lon.toFixed(5)}, 위도 ${info.center.lat.toFixed(5)}` : '') +
        (info.encoding ? ` · 인코딩: ${info.encoding.encoding} (${ENCODING_SOURCE[info.encoding.source] ?? info.encoding.source})` : '');
      sample.textContent = info.encoding || st.item.kind === 'geojson' || st.item.kind === 'csv' ? `속성 예: ${sampleText(info.sampleProperties)}` : '';
      swapRow.hidden = !info.swapSuspected;
      pointRow.hidden = !hasPointGeometry(info.geometryTypes);
      // 점이 아주 많은데 핀이면(처음 한 번) 가벼운 모양으로 바꿔 연다. 기억해 둔 선택(저장소)은 그대로 둔다.
      if (!st.pointChecked && hasPointGeometry(info.geometryTypes)) {
        st.pointChecked = true;
        const light = lightPointStyleFor(st.pointStyle, info.count);
        if (light !== st.pointStyle) {
          st.pointStyle = light;
          pointSel.value = light;
          pointNote.textContent = `점이 ${info.count.toLocaleString('ko-KR')}개로 많아서 이번에는 '${pointStyleSpec(light).label}'으로 열도록 바꿨습니다. '핀'은 점이 많으면 지도에 올리는 데 오래 걸려 화면이 한참 멈춥니다 (PC에 따라 수 초~수십 초). 원하면 위에서 다시 고르세요.`;
          pointNote.hidden = false;
        }
      }
      heightRow.hidden = !info.hasHeights;
      if (!info.hasHeights && st.useHeights) {
        st.useHeights = false;
        useH.checked = false;
        offsetIn.disabled = true;
      }
      if (xSel && info.csv) {
        // 열 이름 목록을 채우고, 자동으로 고른 열을 보여 준다
        for (const [sel, chosen] of [[xSel, info.csv.xCol], [ySel, info.csv.yCol]]) {
          sel.replaceChildren(...[['-1', '(못 찾음 — 고르세요)'], ...info.csv.columns.map((c, i) => [String(i), `${i + 1}. ${c}`])].map(([v, l]) => {
            const o = document.createElement('option');
            o.value = v;
            o.textContent = l;
            return o;
          }));
          sel.value = String(chosen);
        }
        detail.textContent += ` · 행 ${info.csv.rows.toLocaleString('ko-KR')}개`;
      }
      if (st.styleIndex === null) {
        // 처음 한 번: 맞는 스타일이 있으면 자동으로 고른다
        st.styleIndex = autoStyleIndex();
        if (styleSel) styleSel.value = String(st.styleIndex);
      }
      warns.replaceChildren(...[...info.warnings, ...refreshStyle()].map((w) => problemNode(w)));
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
    delimSel?.addEventListener('change', () => {
      // 구분자를 바꾸면 열 번호가 달라지므로 열 선택은 다시 자동으로
      st.opts = { ...st.opts, delimiter: delimSel.value, xCol: undefined, yCol: undefined };
      recompute();
    });
    const onColumnChange = () => {
      st.opts = { ...st.opts, xCol: Number(xSel.value), yCol: Number(ySel.value) };
      recompute();
    };
    xSel?.addEventListener('change', onColumnChange);
    ySel?.addEventListener('change', onColumnChange);
    recompute();
  }

  const actions = el('div', 'actions');
  const ok = el('button', 'primary', '열기');
  ok.type = 'button';
  okBtn = ok;
  refreshOk();
  ok.addEventListener('click', async () => {
    const results = states.filter((s) => s.result).map((s) => ({ name: s.item.name, collection: s.result.collection, info: s.result.info, style: s.styleIndex >= 0 ? styles[s.styleIndex].style : null, useHeights: s.useHeights && !!s.result.info.hasHeights, heightOffset: Number(s.heightOffset) || 0, pointStyle: s.pointStyle }));
    if (!results.length) return;
    confirming = true;
    ok.textContent = '올리는 중…';
    refreshOk();
    try {
      await onConfirm(results);
    } finally {
      confirming = false;
      ok.textContent = '열기';
      refreshOk();
    }
  });
  const cancel = el('button', null, '취소');
  cancel.type = 'button';
  cancel.addEventListener('click', onCancel);
  actions.append(ok, cancel);
  panel.append(actions);
}
