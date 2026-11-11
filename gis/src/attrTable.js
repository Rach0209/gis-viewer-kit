/**
 * 속성 표의 계산 부분: FeatureCollection → 열·행, 검색·조건·정렬, 열 요약, 피처의 위치 범위. DOM·Cesium을 모르는 순수 함수.
 *
 * 행은 collection.features 의 순번(0부터)으로만 다룬다. 값은 필요할 때 꺼내서 글자로 바꾼다 (피처가 수십만 개여도 복사하지 않는다).
 */

/** 열 종류: index(번호), geom(도형 종류), prop(속성) */
const GEOM_LABEL = { Point: '점', MultiPoint: '점(여러 개)', LineString: '선', MultiLineString: '선(여러 개)', Polygon: '면', MultiPolygon: '면(여러 개)', GeometryCollection: '혼합' };

/** 값 → 표에 보일 글자 */
export function displayValue(v) {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * @param {{features:Array<{properties?:object, geometry?:object|null}>}} collection
 * @param {{maxColumns?:number}} [o]
 * @returns {{
 *   size:number, columns:Array<{key:string, name:string, kind:'index'|'geom'|'prop'}>, truncated:boolean,
 *   raw:(row:number, col:number)=>any, text:(row:number, col:number)=>string
 * }}
 */
export function buildTable(collection, { maxColumns = 300 } = {}) {
  const features = collection?.features ?? [];
  const names = new Map();
  let truncated = false;
  for (const f of features) {
    const p = f.properties;
    if (!p) continue;
    for (const k of Object.keys(p)) {
      if (names.has(k)) continue;
      if (names.size >= maxColumns) {
        truncated = true;
        continue;
      }
      names.set(k, names.size);
    }
  }
  const columns = [
    { key: '#', name: '번호', kind: 'index' },
    { key: '__geom', name: '도형', kind: 'geom' },
    ...[...names.keys()].map((k) => ({ key: k, name: k, kind: 'prop' })),
  ];
  const raw = (row, col) => {
    const c = columns[col];
    if (c.kind === 'index') return row + 1;
    if (c.kind === 'geom') return features[row].geometry?.type ?? null;
    return features[row].properties?.[c.key];
  };
  const text = (row, col) => {
    const c = columns[col];
    if (c.kind === 'geom') return GEOM_LABEL[features[row].geometry?.type] ?? (features[row].geometry ? features[row].geometry.type : '(없음)');
    return displayValue(raw(row, col));
  };
  return { size: features.length, columns, truncated, raw, text };
}

const numericLike = (v) => (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
const toNumber = (v) => (typeof v === 'number' ? v : Number(v));

const CONDITION = /^\s*(>=|<=|!=|>|<|=)\s*(-?\d+(?:\.\d+)?)\s*$/;

/**
 * 검색칸의 글자를 조건으로 바꾼다. 열을 하나 골랐고 ">100", "<=3.5", "=12", "!=0" 처럼 쓰면 숫자 조건, 그 밖에는 글자 포함 검색.
 * @returns {{kind:'none'}|{kind:'text', needle:string}|{kind:'number', op:string, value:number}}
 */
export function parseCondition(input, columnSelected) {
  const s = String(input ?? '');
  if (!s.trim()) return { kind: 'none' };
  const m = columnSelected ? CONDITION.exec(s) : null;
  if (m) return { kind: 'number', op: m[1], value: Number(m[2]) };
  return { kind: 'text', needle: s.trim().toLowerCase() };
}

const NUM_TEST = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '=': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

/**
 * 보일 행 순번 목록을 만든다 (검색 → 정렬).
 * @param {ReturnType<typeof buildTable>} table
 * @param {{search?:string, column?:number, sortCol?:number, sortDir?:1|-1}} q
 *   column: 검색할 열 번호(-1 또는 없음이면 모든 열). sortCol: 정렬할 열(-1 이면 원래 순서), sortDir: 1 오름차순, -1 내림차순
 * @returns {{rows:number[], condition:ReturnType<typeof parseCondition>}}
 */
export function queryRows(table, { search = '', column = -1, sortCol = -1, sortDir = 1 } = {}) {
  const cond = parseCondition(search, column >= 0);
  let rows;
  if (cond.kind === 'none') {
    rows = Array.from({ length: table.size }, (_, i) => i);
  } else {
    rows = [];
    const cols = column >= 0 ? [column] : table.columns.map((_, i) => i);
    for (let r = 0; r < table.size; r++) {
      let hit = false;
      if (cond.kind === 'number') {
        const v = table.raw(r, column);
        hit = numericLike(v) && NUM_TEST[cond.op](toNumber(v), cond.value);
      } else {
        for (const c of cols) {
          if (table.text(r, c).toLowerCase().includes(cond.needle)) {
            hit = true;
            break;
          }
        }
      }
      if (hit) rows.push(r);
    }
  }
  if (sortCol >= 0) rows = sortRows(table, rows, sortCol, sortDir);
  return { rows, condition: cond };
}

/** 열이 모두 숫자처럼 보이면 숫자로, 아니면 글자(한글 순)로 정렬한다. 빈 값은 방향과 상관없이 맨 아래. */
export function sortRows(table, rows, col, dir = 1) {
  const vals = rows.map((r) => table.raw(r, col));
  const filled = vals.filter((v) => v != null && v !== '');
  const numeric = filled.length > 0 && filled.every(numericLike);
  const keyed = rows.map((r, i) => ({ r, empty: vals[i] == null || vals[i] === '', k: numeric ? toNumber(vals[i]) : displayValue(vals[i]) }));
  const collator = new Intl.Collator('ko', { numeric: true });
  const cmp = numeric ? (a, b) => a.k - b.k : (a, b) => collator.compare(a.k, b.k);
  keyed.sort((a, b) => {
    if (a.empty !== b.empty) return a.empty ? 1 : -1;
    if (a.empty) return a.r - b.r;
    const c = cmp(a, b);
    return c !== 0 ? dir * c : a.r - b.r; // 같으면 원래 순서 유지
  });
  return keyed.map((x) => x.r);
}

/**
 * 한 열의 요약.
 * @returns {{count:number, empty:number, distinct:number, distinctCapped:boolean, numeric:{min:number,max:number,mean:number}|null, top:Array<[string,number]>}}
 */
export function columnStats(table, rows, col, { topN = 5, distinctCap = 50000 } = {}) {
  let empty = 0;
  let count = 0;
  const seen = new Map();
  let capped = false;
  let allNumeric = true;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let nums = 0;
  for (const r of rows) {
    const v = table.raw(r, col);
    if (v == null || v === '') {
      empty++;
      continue;
    }
    count++;
    if (allNumeric) {
      if (numericLike(v)) {
        const n = toNumber(v);
        if (n < min) min = n;
        if (n > max) max = n;
        sum += n;
        nums++;
      } else allNumeric = false;
    }
    const key = displayValue(v);
    const had = seen.get(key);
    if (had !== undefined) seen.set(key, had + 1);
    else if (seen.size < distinctCap) seen.set(key, 1);
    else capped = true;
  }
  const top = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
  return {
    count,
    empty,
    distinct: seen.size,
    distinctCapped: capped,
    numeric: allNumeric && nums > 0 ? { min, max, mean: sum / nums } : null,
    top,
  };
}

/** 도형의 경위도 범위 [서, 남, 동, 북] (좌표가 하나도 없으면 null) */
export function geometryBounds(geometry) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return;
      if (c[0] < w) w = c[0];
      if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1];
      if (c[1] > n) n = c[1];
    } else c.forEach(walk);
  };
  const visit = (g) => {
    if (!g) return;
    if (g.type === 'GeometryCollection') g.geometries.forEach(visit);
    else if (g.coordinates) walk(g.coordinates);
  };
  visit(geometry);
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

/** 글자 폭 어림값: 한글·한자 등 넓은 글자는 영문·숫자의 두 배로 센다 */
export function visualLength(s) {
  let n = 0;
  for (const ch of String(s)) n += ch.charCodeAt(0) > 0x2e7f ? 2 : 1;
  return n;
}

/** 열 폭(픽셀)을 제목과 앞쪽 값의 길이로 정한다 (제목은 굵고 정렬 표시가 붙으므로 여유를 둔다) */
export function columnWidths(table, { sample = 60, min = 56, max = 280, perChar = 7.2, pad = 20 } = {}) {
  const n = Math.min(table.size, sample);
  return table.columns.map((c, ci) => {
    let longest = visualLength(c.name) + 2;
    for (let r = 0; r < n; r++) {
      const len = visualLength(table.text(r, ci));
      if (len > longest) longest = len;
    }
    return Math.max(min, Math.min(max, Math.ceil(longest * perChar + pad)));
  });
}

/** 표 전체를 탭으로 나눈 글자로 (엑셀에 붙여 넣기용). 지금 보이는 행 순서 그대로 */
export function tableToTsv(table, rows) {
  const clean = (s) => String(s).replace(/[\t\r\n]+/g, ' ');
  const lines = [table.columns.map((c) => clean(c.name)).join('\t')];
  for (const r of rows) lines.push(table.columns.map((_, ci) => clean(table.text(r, ci))).join('\t'));
  return lines.join('\n');
}
