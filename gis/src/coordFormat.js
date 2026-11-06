/**
 * 화면에 보여 줄 좌표·거리 글자 만들기 (Cesium을 모르는 순수 함수).
 * 좌표계 목록과 변환은 three.js 뷰어와 같은 viewer/src/kit/crsList.js 를 쓴다.
 */
import { CRS_LIST, fromLonLat, getCrs } from '../../viewer/src/kit/crsList.js';

export { CRS_LIST };
export const DEFAULT_DISPLAY_CRS = 'EPSG:4326';

/**
 * 경위도를 고른 좌표계의 값으로 바꿔 글자로 만든다.
 * @returns {{xLabel:string, yLabel:string, x:string, y:string, unit:string}}
 */
export function describeCoord(crsCode, lon, lat) {
  const c = getCrs(crsCode);
  if (c.geographic) return { xLabel: '경도', yLabel: '위도', x: lon.toFixed(6), y: lat.toFixed(6), unit: '°' };
  const { x, y } = fromLonLat(crsCode, lon, lat);
  return { xLabel: 'X(동)', yLabel: 'Y(북)', x: x.toFixed(2), y: y.toFixed(2), unit: 'm' };
}

/** "경도 126.978000° 위도 37.566500°" 처럼 한 줄 */
export function coordLine(crsCode, lon, lat) {
  const d = describeCoord(crsCode, lon, lat);
  return `${d.xLabel} ${d.x}${d.unit === '°' ? '°' : ' m'}  ${d.yLabel} ${d.y}${d.unit === '°' ? '°' : ' m'}`;
}

/** 거리(m)를 읽기 좋게: 1 km 미만은 m, 이상은 km */
export function formatDistance(m) {
  if (!Number.isFinite(m)) return '–';
  const a = Math.abs(m);
  if (a < 1000) return `${m.toFixed(a < 10 ? 2 : 1)} m`;
  return `${(m / 1000).toFixed(a < 100000 ? 3 : 2)} km`;
}

/** 높이(m). 없으면 '–' */
export function formatHeight(h) {
  if (!Number.isFinite(h)) return '–';
  const v = Number(h.toFixed(2));
  return `${(v === 0 ? 0 : v).toFixed(2)} m`; // -0.00 으로 보이지 않게
}

/** 면적(㎡)을 ㎡ / ha / ㎢ 로, 그리고 평(1평 = 약 3.3058 ㎡)도 함께 */
export function formatArea(m2) {
  if (!Number.isFinite(m2)) return '–';
  const py = m2 / 3.305785;
  const ko = (n, d) => n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pyText = py >= 1e6 ? `${(py / 1e6).toFixed(2)}백만평` : `${ko(py, m2 < 1e4 ? 1 : 0)}평`;
  if (m2 < 1e4) return `${ko(m2, 1)} ㎡ (${pyText})`;
  if (m2 < 1e6) return `${(m2 / 1e4).toFixed(2)} ha (${pyText})`;
  return `${(m2 / 1e6).toFixed(3)} ㎢ (${pyText})`;
}
