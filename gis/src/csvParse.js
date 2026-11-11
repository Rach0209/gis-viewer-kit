/**
 * 좌표가 든 CSV(또는 탭·세미콜론으로 나눈 글자표)를 점 FeatureCollection 으로 바꾼다. DOM·Cesium을 모르는 순수 함수.
 *
 *  - 구분자(쉼표/탭/세미콜론/세로줄)는 첫 줄들로 자동 판별, 따옴표 안의 구분자·줄 바꿈·"" 이스케이프를 처리한다.
 *  - 첫 줄이 머리글인지(숫자가 아닌 칸이 있으면 머리글) 판별한다.
 *  - 경도(X)/위도(Y) 열은 열 이름(lon, lng, longitude, x, 경도, 위도, lat, y …)으로 찾고, 못 찾으면 숫자 열에서 추정한다.
 *    찾은 열이 틀리면 사용자가 고른다 (xCol, yCol 은 0부터 센 열 번호).
 *  - 나머지 열은 속성이 된다 (모두 숫자인 열은 숫자로, 앞자리 0이 있는 코드 같은 것은 글자로 둔다).
 * 주소만 있고 좌표가 없는 표는 지오코딩(주소 -> 좌표)이 필요해서 여기서는 다루지 않는다.
 */

const DELIMITERS = [',', '\t', ';', '|'];

/** 줄 바꿈은 \n, \r\n, \r 모두. 따옴표 안의 줄 바꿈은 값의 일부다. */
export function parseDelimited(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row); // 빈 줄은 건너뛴다
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

/** 첫 줄들에서 어느 구분자가 일정하게 많이 나오는지로 고른다. 어디에도 없으면 쉼표. */
export function detectDelimiter(text) {
  const lines = text
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== '')
    .slice(0, 8);
  let best = ',';
  let bestScore = 0;
  for (const d of DELIMITERS) {
    // 따옴표 안은 세지 않는다
    const counts = lines.map((l) => {
      let q = false;
      let k = 0;
      for (const ch of l) {
        if (ch === '"') q = !q;
        else if (ch === d && !q) k++;
      }
      return k;
    });
    const min = Math.min(...counts, Infinity);
    if (Number.isFinite(min) && min > bestScore) {
      best = d;
      bestScore = min;
    }
  }
  return best;
}

const isNumeric = (s) => s !== '' && Number.isFinite(Number(String(s).trim().replace(/^\+/, ''))) && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(String(s).trim());

/** 첫 줄이 머리글인가: 숫자가 아닌 칸이 하나라도 있으면 머리글 */
export function hasHeaderRow(rows) {
  if (!rows.length) return false;
  return rows[0].some((c) => c.trim() !== '' && !isNumeric(c.trim()));
}

const X_NAMES = ['lon', 'lng', 'long', 'longitude', 'x', 'xcoord', 'x좌표', '경도', '동경', 'easting', 'east', '경도x'];
const Y_NAMES = ['lat', 'latitude', 'y', 'ycoord', 'y좌표', '위도', '북위', 'northing', 'north', '위도y'];

const normName = (s) => s.toLowerCase().replace(/[\s_\-().[\]]/g, '');

/** 열 이름에서 경도(X)/위도(Y) 열을 찾는다. 못 찾으면 -1 */
export function guessCoordColumnsByName(header) {
  const names = header.map(normName);
  const find = (set) => {
    // 이름이 정확히 같은 것을 먼저, 그다음 이름이 그 낱말로 시작하거나 끝나는 것 (예: "경도(wgs84)", "lon_deg")
    let i = names.findIndex((n) => set.includes(n));
    if (i < 0) i = names.findIndex((n) => set.some((s) => (s.length >= 3 || /[가-힣]/.test(s)) && (n.startsWith(s) || n.endsWith(s))));
    return i;
  };
  // lon/lat/경도/위도 가 x/y 보다 확실하므로 그것부터 본다
  const strongX = ['lon', 'lng', 'long', 'longitude', '경도', '동경'];
  const strongY = ['lat', 'latitude', '위도', '북위'];
  let xi = find(strongX);
  let yi = find(strongY);
  if (xi < 0) xi = find(X_NAMES);
  if (yi < 0) yi = find(Y_NAMES);
  if (xi === yi) yi = -1;
  return { xCol: xi, yCol: yi };
}

/** 값이 모두(비어 있지 않은 것 중) 숫자인 열 번호들 */
export function numericColumns(rows, ncols, sample = 200) {
  const out = [];
  for (let c = 0; c < ncols; c++) {
    let seen = 0;
    let ok = true;
    for (let r = 0; r < rows.length && seen < sample; r++) {
      const v = (rows[r][c] ?? '').trim();
      if (v === '') continue;
      seen++;
      if (!isNumeric(v)) {
        ok = false;
        break;
      }
    }
    if (ok && seen > 0) out.push(c);
  }
  return out;
}

/** 열 이름으로 못 찾았을 때: 값 범위로 경위도 열 쌍을, 그다음 숫자 열 앞의 두 개를 고른다 */
export function guessCoordColumnsByValues(rows, ncols) {
  const nums = numericColumns(rows, ncols);
  const range = (c) => {
    let min = Infinity;
    let max = -Infinity;
    for (let r = 0; r < Math.min(rows.length, 500); r++) {
      const v = Number((rows[r][c] ?? '').trim());
      if (Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    return [min, max];
  };
  // 경도 범위(±180) 열 다음에 위도 범위(±90) 열이 오는 쌍
  for (let i = 0; i + 1 < nums.length; i++) {
    const [a0, a1] = range(nums[i]);
    const [b0, b1] = range(nums[i + 1]);
    if (a0 >= -180 && a1 <= 180 && b0 >= -90 && b1 <= 90 && (a1 - a0 > 0 || b1 - b0 > 0)) return { xCol: nums[i], yCol: nums[i + 1] };
  }
  // 위도 열 다음에 경도 열이 오는 쌍 (순서가 거꾸로인 자료)
  for (let i = 0; i + 1 < nums.length; i++) {
    const [a0, a1] = range(nums[i]);
    const [b0, b1] = range(nums[i + 1]);
    if (a0 >= -90 && a1 <= 90 && b0 >= 90 && b1 <= 180) return { xCol: nums[i + 1], yCol: nums[i] };
  }
  // 투영 좌표(큰 숫자) 두 열
  for (let i = 0; i + 1 < nums.length; i++) {
    const [a0] = range(nums[i]);
    const [b0] = range(nums[i + 1]);
    if (Math.abs(a0) > 1000 && Math.abs(b0) > 1000) return { xCol: nums[i], yCol: nums[i + 1] };
  }
  return { xCol: -1, yCol: -1 };
}

/** 모든 값이 숫자인 열은 숫자로, 앞자리 0이 있는 코드(우편번호 등)는 글자로 둔다 */
function typedValue(raw, numericCol) {
  const v = raw ?? '';
  if (!numericCol) return v;
  const t = v.trim();
  if (t === '') return null;
  if (/^0\d/.test(t)) return v;
  return Number(t);
}

/**
 * 글자 전체를 점 FeatureCollection(원래 좌표계 그대로)으로.
 * @param {string} text
 * @param {{delimiter?:string, xCol?:number, yCol?:number, header?:boolean}} [o] 값이 없으면 자동 판별
 * @returns {{features:object[], columns:string[], xCol:number, yCol:number, delimiter:string, header:boolean, rows:number, skipped:number, warnings:string[]}}
 */
export function csvToPoints(text, { delimiter = 'auto', xCol, yCol, header } = {}) {
  const warnings = [];
  const clean = text.replace(/^﻿/, '');
  const d = delimiter && delimiter !== 'auto' ? delimiter : detectDelimiter(clean);
  const rows = parseDelimited(clean, d);
  if (!rows.length) return { features: [], columns: [], xCol: -1, yCol: -1, delimiter: d, header: false, rows: 0, skipped: 0, warnings: ['내용이 비어 있습니다.'] };
  const ncols = Math.max(...rows.slice(0, 200).map((r) => r.length));
  const hdr = header ?? hasHeaderRow(rows);
  const columns = hdr ? Array.from({ length: ncols }, (_, i) => (rows[0][i] ?? '').trim() || `열${i + 1}`) : Array.from({ length: ncols }, (_, i) => `열${i + 1}`);
  const body = hdr ? rows.slice(1) : rows;

  let xi = Number.isInteger(xCol) ? xCol : -1;
  let yi = Number.isInteger(yCol) ? yCol : -1;
  if (xi < 0 || yi < 0) {
    const byName = hdr ? guessCoordColumnsByName(columns) : { xCol: -1, yCol: -1 };
    const byValue = byName.xCol >= 0 && byName.yCol >= 0 ? byName : guessCoordColumnsByValues(body, ncols);
    if (xi < 0) xi = byName.xCol >= 0 && byName.yCol >= 0 ? byName.xCol : byValue.xCol;
    if (yi < 0) yi = byName.xCol >= 0 && byName.yCol >= 0 ? byName.yCol : byValue.yCol;
  }
  if (xi < 0 || yi < 0 || xi >= ncols || yi >= ncols) {
    warnings.push('경도(X)·위도(Y) 열을 찾지 못했습니다. 아래에서 직접 고르세요.');
    return { features: [], columns, xCol: xi, yCol: yi, delimiter: d, header: hdr, rows: body.length, skipped: body.length, warnings };
  }

  const numericCols = new Set(numericColumns(body, ncols));
  const features = [];
  let skipped = 0;
  for (const r of body) {
    const x = Number((r[xi] ?? '').trim());
    const y = Number((r[yi] ?? '').trim());
    if (!(r[xi] ?? '').trim() || !(r[yi] ?? '').trim() || !Number.isFinite(x) || !Number.isFinite(y)) {
      skipped++;
      continue;
    }
    const props = {};
    for (let c = 0; c < ncols; c++) {
      if (c === xi || c === yi) continue;
      props[columns[c]] = typedValue(r[c], numericCols.has(c));
    }
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: props });
  }
  if (skipped) warnings.push(`좌표가 비었거나 숫자가 아닌 줄 ${skipped.toLocaleString('ko-KR')}개는 건너뛰었습니다.`);
  return { features, columns, xCol: xi, yCol: yi, delimiter: d, header: hdr, rows: body.length, skipped, warnings };
}
