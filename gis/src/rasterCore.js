/**
 * 색이 있는 래스터(항공·위성 사진, 스캔한 지도, 월드파일이 딸린 PNG/JPG)를 지도에 올리기 위한 순수 계산.
 * DOM·Cesium·geotiff 를 모른다 (읽기는 rasterJobs.js, 화면 연결은 main.js).
 *
 * 흐름: 읽기(원본 좌표 bbox + 줄인 RGBA) -> 좌표계 정하기 -> 경위도 격자로 다시 그리기(reprojectRgba) -> Cesium 이미지 한 장
 * 다시 그리기는 "경위도 격자(등장방형)"로 한다. Cesium의 단일 이미지 공급자가 사각형 안에 이미지를 경위도에 비례해 펼치기 때문이다.
 */

/** 월드파일 확장자 후보: 이미지 확장자 -> 월드파일 확장자들 (관례: 첫·마지막 글자 + w, 또는 .wld) */
export function worldFileExtensions(imageName) {
  const ext = (/\.([A-Za-z0-9]+)$/.exec(imageName)?.[1] ?? '').toLowerCase();
  const table = {
    png: ['pgw', 'pngw', 'wld'],
    jpg: ['jgw', 'jpgw', 'wld'],
    jpeg: ['jgw', 'jpegw', 'wld'],
    tif: ['tfw', 'tifw', 'wld'],
    tiff: ['tfw', 'tiffw', 'wld'],
    gif: ['gfw', 'wld'],
    bmp: ['bpw', 'wld'],
  };
  return table[ext] ?? ['wld'];
}

/** 월드파일 6줄: A(가로 화소 크기), D, B, E(세로 화소 크기, 보통 음수), C(왼쪽 위 화소 중심 X), F(왼쪽 위 화소 중심 Y) */
export function parseWorldFile(text) {
  const nums = String(text)
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .slice(0, 6)
    .map(Number);
  if (nums.length < 6 || nums.some((n) => !Number.isFinite(n))) throw new Error('월드파일(.pgw/.jgw/.wld)은 숫자 6줄이어야 합니다.');
  const [A, D, B, E, C, F] = nums;
  if (A === 0 || E === 0) throw new Error('월드파일의 화소 크기가 0입니다.');
  return { A, D, B, E, C, F };
}

/** 월드파일 + 이미지 크기 -> 원본 좌표계의 bbox [minX, minY, maxX, maxY] (가장자리 기준). 회전·기울임이 있으면 오류 */
export function worldFileBbox(w, width, height) {
  if (Math.abs(w.D) > 1e-12 || Math.abs(w.B) > 1e-12) throw new Error('회전·기울임이 있는 월드파일은 지원하지 않습니다 (정북 기준 이미지만).');
  const x0 = w.C - w.A / 2; // 왼쪽 위 화소의 "가장자리" (월드파일은 화소 중심 기준)
  const y0 = w.F - w.E / 2;
  const x1 = x0 + w.A * width;
  const y1 = y0 + w.E * height;
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

/** 경위도 범위와 가로·세로 최대 크기로 출력 이미지 크기를 정한다 (경위도 한 도의 길이가 위도에 따라 달라 가로를 cos(위도)로 줄여 비율을 맞춘다) */
export function outputSize(extent, maxDim = 4096) {
  const [w, s, e, n] = extent;
  const midLat = ((s + n) / 2) * (Math.PI / 180);
  const spanX = Math.max((e - w) * Math.cos(midLat), 1e-9);
  const spanY = Math.max(n - s, 1e-9);
  const k = maxDim / Math.max(spanX, spanY);
  return { outW: Math.max(1, Math.round(spanX * k)), outH: Math.max(1, Math.round(spanY * k)) };
}

/**
 * 원본(원래 좌표계)의 RGBA 를 경위도 격자로 다시 그린다. 가장 가까운 화소를 쓰고, 원본 밖은 투명.
 * @param {{
 *   rgba: Uint8ClampedArray, width: number, height: number, bbox: number[],
 *   toSource: (lon:number, lat:number)=>number[],  // 경위도 -> 원본 좌표계 (x, y)
 *   extent: number[], outW: number, outH: number,
 *   transparentBlack?: boolean,
 *   gridStep?: number,   // 좌표 변환은 이 간격(출력 화소)의 격자점에서만 계산하고 그 사이는 선형 보간한다 (1이면 화소마다 정확히)
 * }} o
 */
export function reprojectRgba({ rgba, width, height, bbox, toSource, extent, outW, outH, transparentBlack = false, gridStep = 16 }) {
  const [minX, minY, maxX, maxY] = bbox;
  const [w, s, e, n] = extent;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const resX = (maxX - minX) / width;
  const resY = (maxY - minY) / height;

  // 좌표 변환(proj4)은 한 번에 수 µs 라서 화소마다 하면 큰 이미지에서 몇 분이 걸린다. 지도 변환은 완만하므로
  // 격자점에서만 변환해 두고 사이는 보간한다 (한국 크기 범위에서 오차는 화소의 몇 분의 일 이하).
  const step = Math.max(1, Math.min(gridStep, Math.floor(Math.min(outW, outH) / 2)));
  const gw = Math.ceil(outW / step) + 1;
  const gh = Math.ceil(outH / step) + 1;
  const nodeX = new Float64Array(gw * gh);
  const nodeY = new Float64Array(gw * gh);
  for (let gj = 0; gj < gh; gj++) {
    const lat = n - ((gj * step + 0.5) / outH) * (n - s);
    for (let gi = 0; gi < gw; gi++) {
      const lon = w + ((gi * step + 0.5) / outW) * (e - w);
      let p;
      try {
        p = toSource(lon, lat);
      } catch {
        p = [Number.NaN, Number.NaN];
      }
      nodeX[gj * gw + gi] = p[0];
      nodeY[gj * gw + gi] = p[1];
    }
  }
  for (let j = 0; j < outH; j++) {
    const gj = Math.floor(j / step);
    const fy = (j - gj * step) / step;
    for (let i = 0; i < outW; i++) {
      const gi = Math.floor(i / step);
      const fx = (i - gi * step) / step;
      const i00 = gj * gw + gi;
      const i10 = i00 + 1;
      const i01 = i00 + gw;
      const i11 = i01 + 1;
      const sx = (nodeX[i00] * (1 - fx) + nodeX[i10] * fx) * (1 - fy) + (nodeX[i01] * (1 - fx) + nodeX[i11] * fx) * fy;
      const sy = (nodeY[i00] * (1 - fx) + nodeY[i10] * fx) * (1 - fy) + (nodeY[i01] * (1 - fx) + nodeY[i11] * fx) * fy;
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue; // 변환할 수 없는 곳은 투명
      const col = Math.floor((sx - minX) / resX);
      const row = Math.floor((maxY - sy) / resY);
      if (col < 0 || col >= width || row < 0 || row >= height) continue;
      const p = (row * width + col) * 4;
      const o = (j * outW + i) * 4;
      const a = rgba[p + 3];
      if (a === 0) continue;
      if (transparentBlack && rgba[p] === 0 && rgba[p + 1] === 0 && rgba[p + 2] === 0) continue;
      out[o] = rgba[p];
      out[o + 1] = rgba[p + 1];
      out[o + 2] = rgba[p + 2];
      out[o + 3] = a;
    }
  }
  return out;
}

/** 네 모서리 화소가 모두 검은색이면 "검은 테두리가 있는 사진"으로 보고 투명 처리를 기본으로 켠다 */
export function cornersAreBlack(rgba, width, height) {
  const at = (x, y) => {
    const p = (y * width + x) * 4;
    return rgba[p] === 0 && rgba[p + 1] === 0 && rgba[p + 2] === 0;
  };
  return at(0, 0) && at(width - 1, 0) && at(0, height - 1) && at(width - 1, height - 1);
}

/**
 * GeoTIFF 가 "색 이미지"(사진)인지, 지형 같은 "값 격자"인지 가린다.
 *  - 밴드 3개 이상이고 실수(float)가 아니면 사진: 8비트 RGB 사진, 16비트 정사영상·위성 영상 (실수 3밴드는 지형 값 묶음일 수 있어 사진으로 보지 않는다)
 *  - 밴드 1개 8비트 정수는 흑백 사진·색표(팔레트) 이미지
 *  - 그 밖(밴드 1개의 16비트/실수 등)은 지형 값 격자
 * @param {{bands:number, bits:number, format?:number}} o format: TIFF SampleFormat (1 부호 없는 정수, 2 정수, 3 실수)
 */
export function isColorImage({ bands, bits, format = 1 }) {
  if (bands >= 3) return format !== 3;
  return bands === 1 && bits === 8 && format === 1;
}

/**
 * 8비트가 아닌 밴드 값을 0~255 로 늘린다 (위성 영상은 값이 일부 구간에만 몰려 있어 그대로는 어둡다).
 * 세 밴드 값을 함께 모아 상하위 일부(기본 2%)를 잘라낸 범위로 선형으로 늘려 색의 균형을 지킨다.
 * 값이 없는 화소(모든 밴드가 nodata·0·NaN)는 투명으로 둔다.
 * @param {ArrayLike<number>[]} bands 같은 크기의 밴드 3개 (r, g, b)
 * @param {{nodata?:number|null, low?:number, high?:number, sample?:number}} [o]
 * @returns {{rgba:Uint8ClampedArray, min:number, max:number, valid:number}}
 */
export function stretchToRgba(bands, { nodata = null, low = 0.02, high = 0.98, sample = 200000 } = {}) {
  const n = bands[0].length;
  const isEmpty = (i) => {
    for (let b = 0; b < 3; b++) {
      const v = bands[b][i];
      if (!(Number.isFinite(v) && v !== 0 && v !== nodata)) continue;
      return false;
    }
    return true;
  };
  // 값 범위: 유효한 화소에서 띄엄띄엄 뽑아 정렬한 뒤 백분위를 쓴다
  const stride = Math.max(1, Math.floor(n / sample));
  const picked = [];
  let valid = 0;
  for (let i = 0; i < n; i++) {
    if (isEmpty(i)) continue;
    valid++;
    if (i % stride === 0) for (let b = 0; b < 3; b++) {
      const v = bands[b][i];
      if (Number.isFinite(v) && v !== nodata) picked.push(v);
    }
  }
  const rgba = new Uint8ClampedArray(n * 4);
  if (!picked.length) return { rgba, min: 0, max: 0, valid: 0 };
  picked.sort((a, b) => a - b);
  const at = (q) => picked[Math.min(picked.length - 1, Math.max(0, Math.floor(q * (picked.length - 1))))];
  let min = at(low);
  let max = at(high);
  if (!(max > min)) {
    min = picked[0];
    max = picked[picked.length - 1];
  }
  const span = max > min ? max - min : 1;
  for (let i = 0; i < n; i++) {
    if (isEmpty(i)) continue; // 투명(0,0,0,0)
    const o = i * 4;
    for (let b = 0; b < 3; b++) {
      const v = bands[b][i];
      rgba[o + b] = Number.isFinite(v) ? Math.round(((v - min) / span) * 255) : 0;
    }
    rgba[o + 3] = 255;
  }
  return { rgba, min, max, valid };
}

/** 가로·세로 줄임 크기 (긴 쪽이 maxDim 이하가 되도록, 커지지는 않는다) */
export function fitSize(width, height, maxDim) {
  const k = Math.min(1, maxDim / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}
