/**
 * 지형의 음영(hillshade): 배경 지도(OSM 등)는 평평하게 그려져서 위에서 보면 지형의 기복이 안 보이므로,
 * DEM에서 계산한 그림자(어두움)와 빛 받는 면(밝음)을 반투명하게 겹쳐 입체감을 준다.
 *
 * 앞쪽은 Cesium을 모르는 순수 함수(시험 있음), createHillshadeProvider 부터 Cesium을 쓴다.
 */

const R = 6378137;
const D2R = Math.PI / 180;

/**
 * 한 타일의 음영 그림(RGBA)을 만든다.
 * 중심 차분으로 경사를 구하려고 한 화소 바깥까지 높이를 읽는다.
 * @param {{west:number, south:number, east:number, north:number}} rect 라디안
 * @param {number} size 한 변 화소 수
 * @param {(lonDeg:number, latDeg:number) => number|null} sampleLonLat 높이(m), 값 없으면 null
 * @param {{azimuth?:number, altitude?:number, zFactor?:number}} [o] azimuth: 빛이 오는 방향(북에서 시계, 기본 315=북서), altitude: 빛 높이각(기본 45도), zFactor: 높이를 과장해서 음영만 진하게
 * @returns {Uint8ClampedArray} size*size*4
 */
export function hillshadeTile(rect, size, sampleLonLat, { azimuth = 315, altitude = 45, zFactor = 1.5 } = {}) {
  const n = size + 2;
  const heights = new Float32Array(n * n);
  const lonStep = (rect.east - rect.west) / size;
  const latStep = (rect.north - rect.south) / size;
  for (let j = 0; j < n; j++) {
    const lat = (rect.north - (j - 0.5) * latStep) / D2R;
    for (let i = 0; i < n; i++) {
      const lon = (rect.west + (i - 0.5) * lonStep) / D2R;
      const h = sampleLonLat(lon, lat);
      heights[j * n + i] = h == null ? Number.NaN : h;
    }
  }
  const midLat = (rect.north + rect.south) / 2;
  const dx = lonStep * R * Math.cos(midLat); // 화소 하나의 동서 길이(m)
  const dy = latStep * R; // 남북 길이(m)
  const az = azimuth * D2R;
  const alt = altitude * D2R;
  const lx = Math.cos(alt) * Math.sin(az);
  const ly = Math.cos(alt) * Math.cos(az);
  const lz = Math.sin(alt);
  const flat = lz;
  const out = new Uint8ClampedArray(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const c = heights[(j + 1) * n + (i + 1)];
      const o = (j * size + i) * 4;
      if (Number.isNaN(c)) continue; // 값 없는 곳은 투명
      const e = heights[(j + 1) * n + (i + 2)];
      const w = heights[(j + 1) * n + i];
      const no = heights[j * n + (i + 1)]; // 위(북)
      const so = heights[(j + 2) * n + (i + 1)]; // 아래(남)
      // 이웃이 값 없음이면 가운데 값으로 대신해 가장자리 경사를 0에 가깝게
      const dzdx = (((Number.isNaN(e) ? c : e) - (Number.isNaN(w) ? c : w)) / (2 * dx)) * zFactor;
      const dzdy = (((Number.isNaN(no) ? c : no) - (Number.isNaN(so) ? c : so)) / (2 * dy)) * zFactor;
      const inv = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const shade = Math.max(0, (-dzdx * lx - dzdy * ly + lz) * inv); // 법선 (-dzdx, -dzdy, 1)/|.| 와 빛 방향의 내적
      const delta = shade - flat;
      if (delta < 0) {
        out[o] = out[o + 1] = out[o + 2] = 0; // 그림자: 검정, 어두울수록 진하게
        out[o + 3] = Math.min(0.65, -delta * 1.6) * 255;
      } else {
        out[o] = out[o + 1] = out[o + 2] = 255; // 빛 받는 면: 흰색
        out[o + 3] = Math.min(0.45, delta) * 255;
      }
    }
  }
  return out;
}

/**
 * 음영 타일을 그려 주는 Cesium 이미지 제공자 (ImageryLayer에 넣어 쓴다).
 * @param {typeof Cesium} Cesium
 * @param {(lonDeg:number, latDeg:number) => number|null} sampleLonLat
 * @param {number[]} extent [west, south, east, north] 도: 이 밖의 타일은 그리지 않는다
 * @param {{maximumLevel?:number, size?:number, zFactor?:number}} [o]
 */
export function createHillshadeProvider(Cesium, sampleLonLat, extent, { maximumLevel = 18, size = 128, zFactor = 1.5 } = {}) {
  const tilingScheme = new Cesium.GeographicTilingScheme();
  const rectangle = Cesium.Rectangle.fromDegrees(extent[0], extent[1], extent[2], extent[3]);
  const blank = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    return c;
  };
  return {
    tilingScheme,
    rectangle,
    tileWidth: size,
    tileHeight: size,
    minimumLevel: 0,
    maximumLevel,
    tileDiscardPolicy: undefined,
    errorEvent: new Cesium.Event(),
    credit: undefined,
    proxy: undefined,
    hasAlphaChannel: true,
    getTileCredits: () => [],
    pickFeatures: () => undefined,
    requestImage(x, y, level) {
      const r = tilingScheme.tileXYToRectangle(x, y, level);
      if (r.east < rectangle.west || r.west > rectangle.east || r.north < rectangle.south || r.south > rectangle.north) return Promise.resolve(blank());
      const data = hillshadeTile(r, size, sampleLonLat, { zFactor });
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').putImageData(new ImageData(data, size, size), 0, 0);
      return Promise.resolve(canvas);
    },
  };
}
