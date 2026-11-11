/**
 * 속성 표 화면: 지도 아래쪽에 붙는 표. 열 제목을 누르면 정렬, 검색칸으로 거르기(열을 고르면 ">100" 같은 숫자 조건도),
 * 열 요약, 행을 누르면 지도에서 그 피처로 이동·강조한다. DOM만 다루고 Cesium은 모른다 (지도 쪽 동작은 콜백으로 받는다).
 *
 * 피처가 수십만 개여도 느려지지 않게 화면에 보이는 행만 만든다 (줄 높이가 고정이라 스크롤 위치로 범위를 안다).
 */
import { buildTable, columnStats, columnWidths, queryRows, tableToTsv } from './attrTable.js';
import { copyText } from './exportUi.js';

const ROW_H = 22;
const HEAD_H = 26;
const OVERSCAN = 6;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const fmt = (n) => n.toLocaleString('ko-KR');
const num = (n) => (Number.isInteger(n) ? fmt(n) : n.toLocaleString('ko-KR', { maximumFractionDigits: 4 }));

/**
 * @param {HTMLElement} panel 비어 있는 패널 요소 (이 함수가 내용을 채우고 보이게 한다)
 * @param {{name:string, collection:{features:object[]}, onSelect?:(row:number, feature:object)=>void, onClose?:()=>void, onNotice?:(msg:string)=>void}} o
 * @returns {{close:()=>void, select:(row:number)=>void, selected:()=>number}}
 */
export function showAttrTable(panel, { name, collection, onSelect, onClose, onNotice }) {
  const table = buildTable(collection);
  const widths = columnWidths(table);
  const totalW = widths.reduce((a, b) => a + b, 0);
  const template = widths.map((w) => `${w}px`).join(' ');

  const query = { search: '', column: -1, sortCol: -1, sortDir: 1 };
  let rows = [];
  let selected = -1; // 원래 피처 순번
  let closed = false;

  panel.replaceChildren();
  panel.hidden = false;
  panel.classList.add('attr');

  // ---- 위쪽 막대
  const head = el('div', 'a-head');
  const grip = el('div', 'a-grip');
  grip.title = '위아래로 끌어 높이를 바꿉니다';
  const title = el('strong', 'a-title', `속성 표 — ${name}`);
  title.title = name;
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = '검색 (열을 고르면 >100 같은 숫자 조건도)';
  search.setAttribute('aria-label', '속성 검색');
  const colSel = document.createElement('select');
  colSel.setAttribute('aria-label', '검색·요약할 열');
  const optAll = document.createElement('option');
  optAll.value = '-1';
  optAll.textContent = '모든 열';
  colSel.appendChild(optAll);
  table.columns.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = c.name;
    colSel.appendChild(o);
  });
  const count = el('span', 'a-count');
  const copyBtn = el('button', 'small', '표 복사');
  copyBtn.type = 'button';
  copyBtn.title = '지금 보이는 표를 탭으로 나눈 글자로 복사합니다 (엑셀에 붙여 넣을 수 있습니다)';
  const closeBtn = el('button', 'small', '닫기');
  closeBtn.type = 'button';
  head.append(title, search, colSel, count, copyBtn, closeBtn);

  const stats = el('div', 'a-stats');
  stats.hidden = true;
  const note = el('div', 'a-stats');
  note.hidden = true;
  if (table.truncated) {
    note.hidden = false;
    note.textContent = `열이 너무 많아 앞의 ${fmt(table.columns.length - 2)}개 속성만 보여 줍니다.`;
  }

  // ---- 표 (스크롤 영역)
  const scroll = el('div', 'a-scroll');
  scroll.tabIndex = 0;
  const header = el('div', 'a-row a-header');
  header.style.cssText = `grid-template-columns:${template};width:${totalW}px;height:${HEAD_H}px`;
  const headCells = table.columns.map((c, ci) => {
    const cell = el('div', 'a-cell a-hcell');
    cell.title = `${c.name} — 눌러서 정렬`;
    cell.addEventListener('click', () => toggleSort(ci));
    header.appendChild(cell);
    return cell;
  });
  const spacer = el('div', 'a-spacer');
  spacer.style.width = `${totalW}px`;
  const view = el('div', 'a-view');
  spacer.appendChild(view);
  scroll.append(header, spacer);

  panel.append(grip, head, note, stats, scroll);

  // ---- 그리기
  function paintHeaders() {
    table.columns.forEach((c, ci) => {
      headCells[ci].textContent = `${c.name}${query.sortCol === ci ? (query.sortDir === 1 ? ' ▲' : ' ▼') : ''}`;
      headCells[ci].classList.toggle('sorted', query.sortCol === ci);
    });
  }

  function paintRows() {
    const top = Math.max(0, Math.floor(scroll.scrollTop / ROW_H) - OVERSCAN);
    const visible = Math.ceil(scroll.clientHeight / ROW_H) + OVERSCAN * 2;
    const end = Math.min(rows.length, top + visible);
    view.style.top = `${top * ROW_H}px`;
    view.style.width = `${totalW}px`;
    const frag = document.createDocumentFragment();
    for (let i = top; i < end; i++) {
      const r = rows[i];
      const row = el('div', r === selected ? 'a-row sel' : 'a-row');
      row.style.cssText = `grid-template-columns:${template};height:${ROW_H}px`;
      row.dataset.row = String(r);
      table.columns.forEach((c, ci) => {
        const text = table.text(r, ci);
        const cell = el('div', c.kind === 'index' ? 'a-cell num' : 'a-cell', text);
        if (text.length > 12) cell.title = text.length > 400 ? `${text.slice(0, 400)}…` : text;
        row.appendChild(cell);
      });
      frag.appendChild(row);
    }
    view.replaceChildren(frag);
  }

  function paintCount() {
    count.textContent = rows.length === table.size ? `${fmt(table.size)}개` : `${fmt(rows.length)} / ${fmt(table.size)}개`;
  }

  function paintStats() {
    if (query.column < 0) {
      stats.hidden = true;
      return;
    }
    const s = columnStats(table, rows, query.column);
    const parts = [`값 ${fmt(s.count)}개`];
    if (s.empty) parts.push(`빈 값 ${fmt(s.empty)}개`);
    parts.push(`서로 다른 값 ${fmt(s.distinct)}${s.distinctCapped ? '+' : ''}개`);
    if (s.numeric) parts.push(`최소 ${num(s.numeric.min)}`, `최대 ${num(s.numeric.max)}`, `평균 ${num(s.numeric.mean)}`);
    else if (s.top.length && s.distinct > 1) parts.push(`많은 값: ${s.top.map(([v, n]) => `${v.length > 20 ? `${v.slice(0, 20)}…` : v}(${fmt(n)})`).join(', ')}`);
    stats.hidden = false;
    stats.textContent = `${table.columns[query.column].name} — ${parts.join(' · ')}`;
  }

  function refresh({ resetScroll = true } = {}) {
    rows = queryRows(table, query).rows;
    if (resetScroll) scroll.scrollTop = 0;
    spacer.style.height = `${rows.length * ROW_H}px`;
    paintHeaders();
    paintCount();
    paintStats();
    paintRows();
  }

  function toggleSort(ci) {
    if (query.sortCol !== ci) {
      query.sortCol = ci;
      query.sortDir = 1;
    } else if (query.sortDir === 1) query.sortDir = -1;
    else {
      query.sortCol = -1;
      query.sortDir = 1;
    }
    refresh();
  }

  // ---- 선택
  function select(row, { reveal = true } = {}) {
    if (row < 0 || row >= table.size) return;
    selected = row;
    if (reveal) {
      const at = rows.indexOf(row);
      if (at >= 0) {
        const y = at * ROW_H;
        if (y < scroll.scrollTop) scroll.scrollTop = y;
        else if (y + ROW_H > scroll.scrollTop + scroll.clientHeight - HEAD_H) scroll.scrollTop = y + ROW_H - scroll.clientHeight + HEAD_H;
      }
    }
    paintRows();
    onSelect?.(row, collection.features[row]);
  }

  view.addEventListener('click', (e) => {
    const rowEl = e.target.closest('.a-row');
    if (rowEl) select(Number(rowEl.dataset.row), { reveal: false });
  });

  scroll.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (!rows.length) return;
    const at = rows.indexOf(selected);
    const next = e.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at < 0 ? 0 : at - 1);
    select(rows[next]);
  });

  let ticking = false;
  scroll.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (!closed) paintRows();
    });
  });
  const resizeObs = typeof ResizeObserver === 'function' ? new ResizeObserver(() => !closed && paintRows()) : null;
  resizeObs?.observe(scroll);

  // ---- 검색·열 선택·복사·닫기
  let timer = 0;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      query.search = search.value;
      refresh();
    }, 150);
  });
  colSel.addEventListener('change', () => {
    query.column = Number(colSel.value);
    refresh();
  });
  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(tableToTsv(table, rows));
    onNotice?.(ok ? `표 ${fmt(rows.length)}행을 복사했습니다. 엑셀 등에 붙여 넣으세요.` : '복사하지 못했습니다. 브라우저가 클립보드를 막았을 수 있습니다.');
  });

  // 위쪽 손잡이를 끌면 높이가 바뀐다 (지도를 더 보고 싶을 때)
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = panel.getBoundingClientRect().height;
    const parentH = panel.parentElement?.getBoundingClientRect().height ?? 600;
    grip.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const h = Math.max(120, Math.min(parentH - 120, startH + (startY - ev.clientY)));
      panel.style.height = `${h}px`;
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    resizeObs?.disconnect();
    panel.hidden = true;
    panel.classList.remove('attr');
    panel.replaceChildren();
    onClose?.();
  }
  closeBtn.addEventListener('click', close);

  refresh();
  return { close, select, selected: () => selected };
}
