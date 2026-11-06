// 지형(DEM) 시험용 GeoTIFF를 만든다. 서울 시청 부근 약 4 km x 4 km, 모두 가상의 지형이다.
// 실행: node gis/tools/make-sample-dem.mjs   ->   samples/dem/hill_5186.tif, hill_4326.tif (git에는 올리지 않는다)
//
//  - hill_5186.tif : 중부원점(EPSG:5186) 격자, 10 m 해상도 400x400. 좌표 변환(투영)이 맞는지 보기 좋다.
//  - hill_4326.tif : 경위도(EPSG:4326) 격자, 0.0001도 해상도. 값 없음(-9999) 구멍이 하나 있다.
// 지형: 완만한 경사 위에 높은 언덕(중심, 120 m)과 작은 언덕(서북쪽, 80 m). 높이는 "표고"처럼 0 m 이상의 값이다.
import fs from 'node:fs';
import path from 'node:path';
import { writeArrayBuffer } from 'geotiff';
import { fromLonLat } from '../../viewer/src/kit/crsList.js';

const OUT = path.join(import.meta.dirname, '..', '..', 'samples', 'dem');
fs.mkdirSync(OUT, { recursive: true });

const CENTER = { lon: 126.978, lat: 37.5665 };
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = 111_320 * Math.cos((CENTER.lat * Math.PI) / 180);

/** 중심에서 동쪽 dx(m), 북쪽 dy(m) 떨어진 곳의 가상 지형 높이(m) */
export function terrainHeight(dx, dy) {
  const hill = (cx, cy, h, r) => h * Math.exp(-(((dx - cx) ** 2 + (dy - cy) ** 2) / (r * r)));
  return 20 + 0.01 * dx + hill(0, 0, 120, 600) + hill(-1000, 800, 80, 400);
}

function write(name, meta, values) {
  const buf = writeArrayBuffer(Float32Array.from(values), meta);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(buf));
  console.log(`만들었습니다: ${path.join(OUT, name)} (${(buf.byteLength / 1024).toFixed(0)} KB)`);
}

// 1) 5186 격자 (10 m, 400x400 = 4 km)
{
  const c = fromLonLat('EPSG:5186', CENTER.lon, CENTER.lat);
  const n = 400;
  const res = 10;
  const x0 = Math.round(c.x - (n * res) / 2);
  const y0 = Math.round(c.y + (n * res) / 2);
  const values = [];
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      const x = x0 + (col + 0.5) * res;
      const y = y0 - (r + 0.5) * res;
      // 격자는 5186 평면 좌표이므로 중심과의 평면 거리를 그대로 쓴다 (가상 지형이라 이 정도면 충분)
      values.push(terrainHeight(x - c.x, y - c.y));
    }
  }
  write('hill_5186.tif', { width: n, height: n, ModelPixelScale: [res, res, 0], ModelTiepoint: [0, 0, 0, x0, y0, 0], GTRasterTypeGeoKey: 1, GTModelTypeGeoKey: 1, ProjectedCSTypeGeoKey: 5186, GDAL_NODATA: '-9999' }, values);
}

// 2) 경위도 격자 (0.0001도, 400x400) + 값 없음 구멍
{
  const n = 400;
  const res = 0.0001;
  const x0 = CENTER.lon - (n * res) / 2;
  const y0 = CENTER.lat + (n * res) / 2;
  const values = [];
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      const lon = x0 + (col + 0.5) * res;
      const lat = y0 - (r + 0.5) * res;
      const hole = col >= 300 && col < 340 && r >= 40 && r < 80; // 북동쪽 값 없음 구멍
      values.push(hole ? -9999 : terrainHeight((lon - CENTER.lon) * M_PER_DEG_LON, (lat - CENTER.lat) * M_PER_DEG_LAT));
    }
  }
  write('hill_4326.tif', { width: n, height: n, ModelPixelScale: [res, res, 0], ModelTiepoint: [0, 0, 0, x0, y0, 0], GTRasterTypeGeoKey: 1, GTModelTypeGeoKey: 2, GeographicTypeGeoKey: 4326, GDAL_NODATA: '-9999' }, values);
}
