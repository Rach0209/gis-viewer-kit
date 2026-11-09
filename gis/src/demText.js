/**
 * 글자(텍스트)로 된 DEM을 읽는다. 국토지리정보원 등에서 받는 ASCII 형식이 이 둘 중 하나다.
 *  1) XYZ 점 목록: 한 줄에 "X Y 높이" (공백·쉼표·탭 구분). 일정한 간격의 격자 점이어야 한다. 도엽(파일)이 여러 개면 합친다.
 *  2) Arc ASCII Grid: ncols/nrows/xllcorner/yllcorner/cellsize/NODATA_value 설명 줄 + 행마다 값 (북쪽 행부터)
 * 결과는 demLoad.js의 readDemFile과 같은 모양이라 지형 열기 패널과 demTerrain.js 를 그대로 쓴다.
 * 이 형식에는 좌표계 정보가 없어서 crs는 null이다 (열기 패널이 범위 값으로 추정하고 사용자가 고른다).
 */
import { MAX_PIXELS, heightStats } from './demCore.js';


/** 첫 줄이 Arc ASCII Grid 설명 줄(ncols)인가 */
export function isAsciiGrid(text) {
  return /^\s*ncols\s+\d+/i.test(text.slice(0, 200));
}

// 구분자: 공백류, 쉼표, 세미콜론 (정규식 /[\s,;]+/ 와 같은 집합)
const isSep = (c) => c <= 32 || c === 44 || c === 59 || c === 0xa0 || c === 0xfeff || c === 0x2028 || c === 0x2029;
const POW10 = [1, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15];

/** text[s, e) 한 토큰을 숫자로. 흔한 모양("-123.45")은 문자열을 만들지 않고 계산하고, 그 밖(지수 표기 등)은 Number()에 맡긴다. */
function tokenToNumber(text, s, e) {
  let i = s;
  let c = text.charCodeAt(i);
  let neg = false;
  if (c === 45) {
    neg = true;
    i++;
  } else if (c === 43) i++;
  let mant = 0;
  let digits = 0;
  let frac = 0;
  let dot = false;
  for (; i < e; i++) {
    c = text.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      mant = mant * 10 + (c - 48);
      digits++;
      if (dot) frac++;
    } else if (c === 46 && !dot) dot = true;
    else return Number(text.slice(s, e));
  }
  // 15자리까지의 정수를 10의 거듭제곱으로 나눈 값은 정확히 반올림되어 Number()와 같다
  if (digits === 0 || digits > 15) return Number(text.slice(s, e));
  const v = frac ? mant / POW10[frac] : mant;
  return neg ? -v : v;
}

const SPLIT = /[\s,;]+/;

/**
 * XYZ 점 목록을 읽는다. 숫자 세 개가 아닌 줄(머리글, 빈 줄)은 건너뛴다.
 * (줄을 쪼개 읽는 방식이 직접 한 글자씩 읽는 것보다 빨라서 이렇게 둔다 — 225만 줄로 측정)
 * @returns {{x:Float64Array, y:Float64Array, z:Float64Array, skipped:number}}
 */
export function parseXyz(text) {
  const xs = [];
  const ys = [];
  const zs = [];
  let skipped = 0;
  let start = 0;
  const n = text.length;
  while (start < n) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = n;
    const line = text.slice(start, end).trim();
    start = end + 1;
    if (!line) continue;
    const p = line.split(SPLIT);
    const x = Number(p[0]);
    const y = Number(p[1]);
    const z = Number(p[2]);
    if (p.length >= 3 && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      xs.push(x);
      ys.push(y);
      zs.push(z);
    } else skipped++;
  }
  return { x: Float64Array.from(xs), y: Float64Array.from(ys), z: Float64Array.from(zs), skipped };
}

/** 정렬된 고유 값들의 간격(중앙값). 격자가 아니면 오류 */
function spacingOf(sortedUnique, label) {
  if (sortedUnique.length < 2) return null;
  const diffs = [];
  for (let i = 1; i < sortedUnique.length; i++) diffs.push(sortedUnique[i] - sortedUnique[i - 1]);
  diffs.sort((a, b) => a - b);
  const step = diffs[Math.floor(diffs.length / 2)];
  if (!(step > 0)) throw new Error(`${label} 방향 간격을 알 수 없습니다.`);
  return step;
}

/**
 * XYZ 점들을 일정한 간격의 격자로 만든다. 점은 화소(셀) 중심으로 본다. 점이 없는 칸은 값 없음(NaN).
 * @param {{x:ArrayLike<number>, y:ArrayLike<number>, z:ArrayLike<number>}} pts
 */
export function gridFromXyz(pts, { maxPixels = MAX_PIXELS, hint = '' } = {}) {
  const count = pts.x.length;
  if (count < 4) throw new Error('점이 너무 적습니다 (격자를 만들려면 최소 4개). "X Y 높이" 형식인지 확인하세요.');
  // 부동소수 오차를 없애려고 값을 정수로 바꿔 고유 값을 센다 (경위도면 1e-7도, 평면이면 1 cm 단위)
  let maxAbsX = 0;
  let maxAbsY = 0;
  for (let i = 0; i < count; i++) {
    maxAbsX = Math.max(maxAbsX, Math.abs(pts.x[i]));
    maxAbsY = Math.max(maxAbsY, Math.abs(pts.y[i]));
  }
  const q = maxAbsX <= 180 && maxAbsY <= 90 ? 1e7 : 100;
  const key = (v) => Math.round(v * q);
  const uniqueSorted = (arr) => {
    const set = new Set();
    for (let i = 0; i < count; i++) set.add(key(arr[i]));
    return Float64Array.from(set).sort(); // 타입 배열의 sort는 숫자 순서
  };
  const ux = uniqueSorted(pts.x);
  const uy = uniqueSorted(pts.y);
  const sx = spacingOf(ux, 'X');
  const sy = spacingOf(uy, 'Y');
  if (sx == null || sy == null) throw new Error('점들이 한 줄로만 있어 격자가 아닙니다.');
  const resX = sx / q;
  const resY = sy / q;
  const width = Math.round((ux[ux.length - 1] - ux[0]) / sx) + 1;
  const height = Math.round((uy[uy.length - 1] - uy[0]) / sy) + 1;
  if (width * height > maxPixels) throw new Error(`격자가 너무 큽니다 (${width.toLocaleString('ko-KR')}×${height.toLocaleString('ko-KR')} 화소). 쓸 지역의 파일만 고르세요.${hint}`);
  // 점 개수에 비해 격자가 너무 성기면(대부분 빈 칸) 격자형 자료가 아닐 가능성이 높다
  if (width * height > count * 50 + 1000) throw new Error(`점이 일정한 격자로 놓여 있지 않은 것 같습니다 (점 ${count.toLocaleString('ko-KR')}개, 격자 ${width.toLocaleString('ko-KR')}×${height.toLocaleString('ko-KR')}).`);
  const data = new Float32Array(width * height).fill(Number.NaN);
  const minX = ux[0];
  const maxY = uy[uy.length - 1];
  let off = 0; // 격자 칸에서 어긋난 점 수
  for (let i = 0; i < count; i++) {
    const fx = (key(pts.x[i]) - minX) / sx;
    const fy = (maxY - key(pts.y[i])) / sy;
    const ix = Math.round(fx);
    const iy = Math.round(fy);
    if (Math.abs(fx - ix) > 0.1 || Math.abs(fy - iy) > 0.1) off++;
    data[iy * width + ix] = pts.z[i];
  }
  if (off > count * 0.01) throw new Error(`점이 일정한 간격의 격자에 놓여 있지 않습니다 (${off.toLocaleString('ko-KR')}개가 칸에서 어긋남). XYZ 점 목록이 격자형인지 확인하세요.`);
  const x0 = minX / q;
  const y1 = maxY / q;
  return {
    width,
    height,
    data,
    bbox: [x0 - resX / 2, y1 - (height - 1) * resY - resY / 2, x0 + (width - 1) * resX + resX / 2, y1 + resY / 2],
    resolution: [resX, resY],
  };
}

/** Arc ASCII Grid 한 개를 읽는다 */
export function parseAsciiGrid(text, { maxPixels = MAX_PIXELS, hint = '' } = {}) {
  const header = {};
  let pos = 0;
  for (let k = 0; k < 8 && pos < text.length; k++) {
    let end = text.indexOf('\n', pos);
    if (end < 0) end = text.length;
    const m = /^\s*([A-Za-z_]+)\s+(\S+)\s*$/.exec(text.slice(pos, end));
    if (!m || !/^(ncols|nrows|xllcorner|yllcorner|xllcenter|yllcenter|cellsize|dx|dy|nodata_value)$/i.test(m[1])) break;
    header[m[1].toLowerCase()] = Number(m[2]);
    pos = end + 1;
  }
  const ncols = header.ncols;
  const nrows = header.nrows;
  if (!(ncols > 0) || !(nrows > 0)) throw new Error('ASCII 격자 설명 줄(ncols, nrows)을 읽을 수 없습니다.');
  if (ncols * nrows > maxPixels) throw new Error(`격자가 너무 큽니다 (${ncols.toLocaleString('ko-KR')}×${nrows.toLocaleString('ko-KR')} 화소).${hint}`);
  const resX = header.cellsize ?? header.dx;
  const resY = header.cellsize ?? header.dy;
  if (!(resX > 0) || !(resY > 0)) throw new Error('ASCII 격자의 cellsize 를 읽을 수 없습니다.');
  const cornerX = header.xllcorner ?? (header.xllcenter != null ? header.xllcenter - resX / 2 : null);
  const cornerY = header.yllcorner ?? (header.yllcenter != null ? header.yllcenter - resY / 2 : null);
  if (cornerX == null || cornerY == null) throw new Error('ASCII 격자의 xllcorner / yllcorner 를 읽을 수 없습니다.');
  const nodata = header.nodata_value ?? null;
  const data = new Float32Array(ncols * nrows);
  let i = 0;
  // 값이 수천만 개일 수 있어서 문자열 배열로 쪼개지 않고 한 번 훑으며 읽는다
  const total = text.length;
  while (pos < total && i < data.length) {
    while (pos < total && isSep(text.charCodeAt(pos))) pos++;
    if (pos >= total) break;
    let e = pos;
    while (e < total && !isSep(text.charCodeAt(e))) e++;
    data[i++] = tokenToNumber(text, pos, e);
    pos = e;
  }
  if (i < data.length) throw new Error(`값이 모자랍니다 (${i.toLocaleString('ko-KR')} / ${data.length.toLocaleString('ko-KR')}개). 파일이 잘렸을 수 있습니다.`);
  return { width: ncols, height: nrows, data, bbox: [cornerX, cornerY, cornerX + ncols * resX, cornerY + nrows * resY], resolution: [resX, resY], nodata };
}

/**
 * 글자 DEM 파일들(XYZ 여러 개 또는 ASCII 격자 한 개)을 읽어 하나의 DEM으로.
 * @param {Blob[]} files
 */
export async function readDemText(files, parseFile = parseDemTextFile) {
  if (!files.length) throw new Error('파일이 없습니다.');
  // 파일마다 따로 읽는다 (parseFile을 워커로 바꿔 끼우면 파일들이 여러 워커에서 동시에 읽힌다)
  const parsed = await Promise.all(files.map((f) => parseFile(f)));
  return assembleDemText(parsed);
}

/**
 * 글자 DEM 파일 한 개를 읽는다 (ASCII 격자면 격자 하나, 아니면 XYZ 점을 격자로).
 * 파일 하나를 통째로 처리하므로 워커에서 파일별로 따로 돌려도 된다.
 * @param {Blob & {name?:string}} file
 * @returns {Promise<{name:string, ascii:boolean, grid:{width:number,height:number,data:Float32Array,bbox:number[],resolution:number[],nodata:number|null}, stats:object}>}
 */
export async function parseDemTextFile(file, limits = {}) {
  const { maxPixels = MAX_PIXELS, hint = '' } = limits;
  const name = file.name ?? 'dem.txt';
  // 글자 파일은 통째로 메모리에 올려 읽으므로, 격자 상한에 맞는 크기(값 하나가 글자 4바이트쯤은 넘는다고 보고)를 넘으면 미리 거절한다
  if (file.size > maxPixels * 4) {
    throw new Error(`${name}: 파일이 너무 큽니다 (${(file.size / 1e6).toFixed(0)}MB). 쓸 지역의 파일만 고르세요.${hint}`);
  }
  const text = await file.text();
  if (isAsciiGrid(text)) {
    const grid = parseAsciiGrid(text, limits);
    return { name, ascii: true, grid, stats: heightStats(grid.data, grid.nodata) };
  }
  const pts = parseXyz(text);
  if (pts.x.length === 0) throw new Error(`${name}: "X Y 높이" 숫자 세 개가 든 줄이 없습니다. XYZ 점 목록이나 ASCII 격자(ncols …)가 아닙니다.`);
  let grid;
  try {
    grid = { ...gridFromXyz(pts, limits), nodata: null };
  } catch (e) {
    throw new Error(`${name}: ${e.message}`);
  }
  return { name, ascii: false, grid, stats: heightStats(grid.data, grid.nodata) };
}

/** 파일별로 읽은 결과를 하나의 DEM으로 모은다 */
export function assembleDemText(parsed) {
  
  let core;
  let kind;
  let stats;
  if (parsed.some((p) => p.ascii)) {
    if (parsed.length > 1) throw new Error('ASCII 격자(ncols …)는 파일 하나씩 여세요 (여러 파일을 한꺼번에 합치는 것은 XYZ 점 목록만 됩니다).');
    core = parsed[0].grid;
    stats = parsed[0].stats;
    kind = 'ASCII 격자';
  } else {
    // 도엽(파일)마다 따로 격자로 만든다. 도엽마다 점 격자의 시작 위치·간격이 달라도 되고, 겹쳐 읽는 것은 demCore.createMosaicSampler가 한다.
    const grids = parsed.map((p) => p.grid);
    stats = grids.length === 1 ? parsed[0].stats : combineStats(parsed.map((p) => p.stats));
    if (grids.length === 1) core = grids[0];
    else {
      const bbox = [Math.min(...grids.map((g) => g.bbox[0])), Math.min(...grids.map((g) => g.bbox[1])), Math.max(...grids.map((g) => g.bbox[2])), Math.max(...grids.map((g) => g.bbox[3]))];
      const resolution = [Math.min(...grids.map((g) => g.resolution[0])), Math.min(...grids.map((g) => g.resolution[1]))];
      core = {
        tiles: grids,
        bbox,
        resolution,
        // 전체를 감싸는 격자 크기 (표시용)
        width: Math.round((bbox[2] - bbox[0]) / resolution[0]),
        height: Math.round((bbox[3] - bbox[1]) / resolution[1]),
        data: null,
        nodata: null,
      };
    }
    kind = parsed.length > 1 ? `XYZ 점 목록 ${parsed.length}개 도엽` : 'XYZ 점 목록';
  }
  const name = parsed.length === 1 ? parsed[0].name : `${parsed[0].name} 외 ${parsed.length - 1}개`;
  return {
    name,
    width: core.width,
    height: core.height,
    data: core.data,
    tiles: core.tiles ?? null,
    bbox: core.bbox,
    nodata: core.nodata,
    crs: null,
    crsHint: '',
    pixelIsPoint: false,
    bands: 1,
    resolution: core.resolution,
    stats,
    extent: null,
    source: kind,
  };
}

/** 여러 도엽의 통계를 하나로 */
function combineStats(list) {
  const valid = list.reduce((a, s) => a + s.valid, 0);
  const invalid = list.reduce((a, s) => a + s.invalid, 0);
  const mins = list.map((s) => s.min).filter((v) => v != null);
  const maxs = list.map((s) => s.max).filter((v) => v != null);
  return {
    min: mins.length ? Math.min(...mins) : null,
    max: maxs.length ? Math.max(...maxs) : null,
    mean: valid ? list.reduce((a, s) => a + (s.mean ?? 0) * s.valid, 0) / valid : null,
    valid,
    invalid,
  };
}
