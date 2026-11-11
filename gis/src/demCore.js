/**
 * 지형(DEM) 계산: 격자(래스터)에서 높이 읽기, 타일(Cesium heightmap) 높이 만들기, 좌표계 판별.
 * Cesium·DOM을 모르는 순수 함수라 단독으로 시험한다. GeoTIFF 읽기는 demLoad.js, Cesium 연결은 demTerrain.js.
 *
 * 격자는 "화소(pixel)가 땅의 작은 정사각형"이고 bbox가 격자 전체의 바깥 경계(왼쪽·아래·오른쪽·위)라고 본다.
 * 행 0이 북쪽(위), 열 0이 서쪽(왼쪽).
 */
import proj4 from 'proj4';
import { CRS_LIST, fromLonLat, isKnownCrs, isNearKorea, toLonLat } from '../../viewer/src/kit/crsList.js';

/** 이보다 큰 격자는 브라우저 메모리가 부족해질 수 있어 거절한다 (1.2억 화소 = Float32 약 480 MB) */
export const MAX_PIXELS = 120_000_000;

/** 이 값이면 "값 없음" (nodata 선언값, NaN, 비정상적으로 작은 값) */
export function isNoData(v, nodata) {
  return !Number.isFinite(v) || v < -1e10 || (nodata != null && v === nodata);
}

/**
 * 격자 안의 한 점(화소 중심을 0으로 한 소수 좌표 fx, fy)의 높이를 이웃 4개 화소로 보간한다.
 * 이웃 중 값 없는 것이 있으면 값 있는 것만으로 가중 평균하고, 전부 없으면 null.
 */
export function bilinear(data, width, height, fx, fy, nodata) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  let sum = 0;
  let wsum = 0;
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const x = Math.min(width - 1, Math.max(0, x0 + i)); // 가장자리 반 화소는 가장자리 값으로
      const y = Math.min(height - 1, Math.max(0, y0 + j));
      const v = data[y * width + x];
      if (isNoData(v, nodata)) continue;
      const w = (i ? tx : 1 - tx) * (j ? ty : 1 - ty);
      sum += v * w;
      wsum += w;
    }
  }
  return wsum > 1e-9 ? sum / wsum : null;
}

/**
 * 격자와 그 좌표계 변환으로 "경위도 -> 높이" 함수를 만든다. 격자 범위 밖은 null.
 * @param {{data:ArrayLike<number>, width:number, height:number, bbox:number[], nodata?:number|null}} raster bbox: [minX, minY, maxX, maxY] (격자 좌표계)
 * @param {(lonDeg:number, latDeg:number) => [number, number]} toXY 경위도 -> 격자 좌표계
 * @param {{margin?:number}} [o] margin: 범위 밖으로 이 칸 수만큼은 가장자리 값으로 채운다 (도엽 사이 틈 메우기용, 기본 0)
 */
export function createSampler(raster, toXY, { margin = 0 } = {}) {
  const { data, width, height, bbox, nodata = null } = raster;
  const [minX, minY, maxX, maxY] = bbox;
  const resX = (maxX - minX) / width;
  const resY = (maxY - minY) / height;
  const mx = margin * resX;
  const my = margin * resY;
  return {
    /** 격자 좌표계의 (x, y)에서 높이. 범위 밖이면 null */
    sampleXY(x, y) {
      if (x < minX - mx || x > maxX + mx || y < minY - my || y > maxY + my) return null;
      const fx = (x - minX) / resX - 0.5;
      const fy = (maxY - y) / resY - 0.5;
      return bilinear(data, width, height, fx, fy, nodata);
    },
    sampleLonLat(lonDeg, latDeg) {
      const [x, y] = toXY(lonDeg, latDeg);
      return this.sampleXY(x, y);
    },
  };
}

/**
 * 도엽(격자) 여러 장을 각자의 격자 그대로 겹쳐 읽는 샘플러. 도엽마다 점 격자의 시작 위치·간격이 달라도 된다
 * (한 격자로 합치면 어긋나는 자료를 위해). 점이 어느 도엽 안이면 그 도엽 값, 도엽 사이 한 칸 안의 틈은 가까운 도엽의 가장자리 값,
 * 어느 도엽에도 없으면 null.
 * @param {Array<{data:ArrayLike<number>, width:number, height:number, bbox:number[], nodata?:number|null}>} tiles
 * @param {(lonDeg:number, latDeg:number) => [number, number]} toXY
 */
export function createMosaicSampler(tiles, toXY) {
  if (!tiles.length) throw new Error('도엽이 없습니다.');
  const strict = tiles.map((t) => createSampler(t, toXY));
  const loose = tiles.map((t) => createSampler(t, toXY, { margin: 1 }));
  // 빠르게 찾으려고 상자 칸(bucket)에 도엽 번호를 담아 둔다. 칸 크기는 도엽 크기의 중앙값.
  const sizes = tiles.map((t) => Math.max(t.bbox[2] - t.bbox[0], t.bbox[3] - t.bbox[1])).sort((a, b) => a - b);
  const cell = sizes[Math.floor(sizes.length / 2)] || 1;
  const originX = Math.min(...tiles.map((t) => t.bbox[0]));
  const originY = Math.min(...tiles.map((t) => t.bbox[1]));
  const buckets = new Map();
  const keyOf = (ix, iy) => `${ix},${iy}`;
  tiles.forEach((t, idx) => {
    const resX = (t.bbox[2] - t.bbox[0]) / t.width;
    const resY = (t.bbox[3] - t.bbox[1]) / t.height;
    const x0 = Math.floor((t.bbox[0] - resX - originX) / cell);
    const x1 = Math.floor((t.bbox[2] + resX - originX) / cell);
    const y0 = Math.floor((t.bbox[1] - resY - originY) / cell);
    const y1 = Math.floor((t.bbox[3] + resY - originY) / cell);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const k = keyOf(ix, iy);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(idx);
      }
    }
  });
  return {
    sampleXY(x, y) {
      const list = buckets.get(keyOf(Math.floor((x - originX) / cell), Math.floor((y - originY) / cell)));
      if (!list) return null;
      for (const i of list) {
        const v = strict[i].sampleXY(x, y);
        if (v != null) return v;
      }
      for (const i of list) {
        const v = loose[i].sampleXY(x, y); // 도엽 사이의 한 칸 안 틈
        if (v != null) return v;
      }
      return null;
    },
    sampleLonLat(lonDeg, latDeg) {
      const [x, y] = toXY(lonDeg, latDeg);
      return this.sampleXY(x, y);
    },
  };
}

/**
 * Cesium heightmap 타일 하나의 높이 배열. 행 0이 북쪽, 열 0이 서쪽, 가장자리 샘플이 타일 경계에 정확히 놓인다
 * (이웃 타일과 경계 높이가 같아야 틈이 안 생긴다).
 * @param {{west:number, south:number, east:number, north:number}} rect 라디안
 * @param {number} size 한 변 샘플 수 (보통 65)
 * @param {(lonDeg:number, latDeg:number) => number|null} sampleLonLat
 * @param {{offset?:number, outside?:number}} [o] offset: 높이에 더할 값(m), outside: 격자 밖(값 없음) 높이
 * @returns {Float32Array}
 */
export function tileHeights(rect, size, sampleLonLat, { offset = 0, outside = 0 } = {}) {
  const out = new Float32Array(size * size);
  const R2D = 180 / Math.PI;
  for (let row = 0; row < size; row++) {
    const lat = (rect.north - ((rect.north - rect.south) * row) / (size - 1)) * R2D;
    for (let col = 0; col < size; col++) {
      const lon = (rect.west + ((rect.east - rect.west) * col) / (size - 1)) * R2D;
      const h = sampleLonLat(lon, lat);
      out[row * size + col] = h == null ? outside : h + offset;
    }
  }
  return out;
}

/** 값이 있는 화소의 최소·최대·평균과 값 없는 화소 수 */
export function heightStats(data, nodata) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (isNoData(v, nodata)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    n++;
  }
  return { min: n ? min : null, max: n ? max : null, mean: n ? sum / n : null, valid: n, invalid: data.length - n };
}

// ---------------------------------------------------------------- 좌표계
const GEOGRAPHIC = new Set([4326, 4737, 4619, 4258, 4269, 4612]); // 경위도로 보고 그대로 쓴다 (측지계 차이는 1 m 안팎이라 지형 높이에는 무시)
const numberOf = (code) => Number(String(code).replace('EPSG:', ''));
const isGeographic = (code) => code === 'EPSG:4326' || GEOGRAPHIC.has(numberOf(code));

/** 'EPSG:4326'처럼 쓸 수 있는 코드인가 (격자 좌표계로 지원하는지) */
export function isSupportedCrs(code) {
  if (typeof code !== 'string') return false;
  if (isKnownCrs(code)) return true; // 목록, UTM 존, 직접 추가한 좌표계
  return GEOGRAPHIC.has(numberOf(code));
}

/** GeoTIFF GeoKeys에서 좌표계 코드('EPSG:n')를 찾는다. 없거나 지원하지 않으면 null */
export function crsFromGeoKeys(keys) {
  if (!keys) return null;
  for (const n of [keys.ProjectedCSTypeGeoKey, keys.GeographicTypeGeoKey]) {
    if (!Number.isFinite(n) || n === 0 || n === 32767) continue; // 0=없음, 32767=사용자 정의
    const code = `EPSG:${n}`;
    return isSupportedCrs(code) ? code : null; // 알 수 없는 코드는 사용자가 고르게 한다
  }
  return null;
}

/** 경위도 -> 격자 좌표계 (x, y). 지원하지 않으면 오류 */
export function projectorFor(code) {
  if (!isSupportedCrs(code)) throw new Error(`지원하지 않는 좌표계: ${code}`);
  if (isGeographic(code)) return (lon, lat) => [lon, lat];
  return (lon, lat) => {
    const { x, y } = fromLonLat(code, lon, lat);
    return [x, y];
  };
}

/** 격자 좌표계 (x, y) -> 경위도 */
export function inverseFor(code) {
  if (!isSupportedCrs(code)) throw new Error(`지원하지 않는 좌표계: ${code}`);
  if (isGeographic(code)) return (x, y) => [x, y];
  return (x, y) => {
    const { lon, lat } = toLonLat(code, x, y);
    return [lon, lat];
  };
}

/** 격자 bbox의 경위도 범위 [west, south, east, north] (도). 가장자리를 따라 점을 찍어 구한다. */
export function lonLatExtent(bbox, code) {
  const [minX, minY, maxX, maxY] = bbox;
  if (isGeographic(code)) return [minX, minY, maxX, maxY];
  const inverse = inverseFor(code);
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push([minX + (maxX - minX) * t, minY], [minX + (maxX - minX) * t, maxY], [minX, minY + (maxY - minY) * t], [maxX, minY + (maxY - minY) * t]);
  }
  const ll = pts.map(([x, y]) => inverse(x, y));
  return [Math.min(...ll.map((p) => p[0])), Math.min(...ll.map((p) => p[1])), Math.max(...ll.map((p) => p[0])), Math.max(...ll.map((p) => p[1]))];
}

/**
 * 파일에 좌표계 정보가 없거나 지원하지 않을 때, 격자 범위 값으로 좌표계를 추정한다.
 * 한국 좌표계끼리(5185/5186/5187)는 값만으로 구분이 안 되어 5179, 5186, 5187, 5185, 4326 순으로 첫 번째 후보를 준다 (사용자가 바꿀 수 있다).
 * @returns {string|null}
 */
export function guessDemCrs(bbox) {
  for (const code of ['EPSG:5179', 'EPSG:5186', 'EPSG:5187', 'EPSG:5185', 'EPSG:4326']) {
    try {
      const [w, s0, e, n] = lonLatExtent(bbox, code);
      if (![w, s0, e, n].every(Number.isFinite)) continue;
      if (isNearKorea({ lon: (w + e) / 2, lat: (s0 + n) / 2 }) && e - w < 10 && n - s0 < 10) return code;
    } catch {
      // 다음 후보로
    }
  }
  return null;
}
