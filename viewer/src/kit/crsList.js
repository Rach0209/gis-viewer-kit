import proj4 from 'proj4';

/**
 * 사용자가 고를 수 있는 대표 좌표계. GLB 좌표 입력에 쓰고, 이후 GeoJSON/SHP에서도 같은 목록을 쓴다.
 *
 * 한국에서 흔한 좌표계만 담았다. 정의는 EPSG 공식 값(횡메르카토르, GRS80)을 proj4 문자열로 옮긴 것이다.
 * 옛 좌표계(EPSG:5174 등 베셀 타원체)는 데이터마다 변환 매개변수가 달라 위치가 수백 m 어긋날 수 있어서
 * 일부러 넣지 않았다. 필요하면 검증한 뒤 추가한다.
 *
 * 좌표 순서는 항상 (X=동쪽/경도, Y=북쪽/위도) 이다.
 *
 * @typedef {{
 *   code: string, label: string, geographic: boolean,
 *   xLabel: string, yLabel: string, unit: 'deg'|'m', def?: string,
 * }} CrsInfo
 */

const GRS80_TM = (lon0, k, x0, y0) =>
  `+proj=tmerc +lat_0=38 +lon_0=${lon0} +k=${k} +x_0=${x0} +y_0=${y0} +ellps=GRS80 +units=m +no_defs`;

/** @type {CrsInfo[]} */
export const CRS_LIST = [
  { code: 'EPSG:4326', label: 'WGS84 경위도 (EPSG:4326)', geographic: true, xLabel: '경도', yLabel: '위도', unit: 'deg' },
  {
    code: 'EPSG:5179',
    label: 'UTM-K / Korea 2000 통합 (EPSG:5179)',
    geographic: false, xLabel: 'X (동쪽, m)', yLabel: 'Y (북쪽, m)', unit: 'm',
    def: GRS80_TM(127.5, 0.9996, 1000000, 2000000),
  },
  {
    code: 'EPSG:5186',
    label: 'Korea 2000 중부원점 (EPSG:5186)',
    geographic: false, xLabel: 'X (동쪽, m)', yLabel: 'Y (북쪽, m)', unit: 'm',
    def: GRS80_TM(127, 1, 200000, 600000),
  },
  {
    code: 'EPSG:5185',
    label: 'Korea 2000 서부원점 (EPSG:5185)',
    geographic: false, xLabel: 'X (동쪽, m)', yLabel: 'Y (북쪽, m)', unit: 'm',
    def: GRS80_TM(125, 1, 200000, 600000),
  },
  {
    code: 'EPSG:5187',
    label: 'Korea 2000 동부원점 (EPSG:5187)',
    geographic: false, xLabel: 'X (동쪽, m)', yLabel: 'Y (북쪽, m)', unit: 'm',
    def: GRS80_TM(129, 1, 200000, 600000),
  },
  {
    code: 'EPSG:3857',
    label: '웹 메르카토르 (EPSG:3857, 웹 지도)',
    geographic: false, xLabel: 'X (m)', yLabel: 'Y (m)', unit: 'm',
    def: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs',
  },
];

export const DEFAULT_CRS = 'EPSG:5179';

let registered = false;
function ensureRegistered() {
  if (registered) return;
  for (const c of CRS_LIST) if (c.def) proj4.defs(c.code, c.def);
  registered = true;
}

/** @param {string} code @returns {CrsInfo} */
export function getCrs(code) {
  const c = CRS_LIST.find((x) => x.code === code);
  if (!c) throw new Error(`지원하지 않는 좌표계: ${code}`);
  return c;
}

/**
 * 해당 좌표계의 (x, y)를 경위도로 바꾼다. 4326이면 그대로.
 * @returns {{lon:number, lat:number}}
 */
export function toLonLat(code, x, y) {
  const c = getCrs(code);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('좌표가 숫자가 아닙니다');
  if (c.geographic) return { lon: x, lat: y };
  ensureRegistered();
  const [lon, lat] = proj4(c.code, 'EPSG:4326', [x, y]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error('이 좌표를 경위도로 바꿀 수 없습니다');
  return { lon, lat };
}

/** 경위도를 해당 좌표계의 (x, y)로. */
export function fromLonLat(code, lon, lat) {
  const c = getCrs(code);
  if (c.geographic) return { x: lon, y: lat };
  ensureRegistered();
  const [x, y] = proj4('EPSG:4326', c.code, [lon, lat]);
  return { x, y };
}

/** 경위도가 유효한 범위인가 (좌표계를 잘못 골랐을 때 대부분 여기서 걸린다) */
export function isValidLonLat({ lon, lat }) {
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
}

/** 한국 주변(대략 124~132E, 33~39N)인가. 아니면 좌표계를 잘못 골랐을 가능성을 알려 주는 용도다. */
export function isNearKorea({ lon, lat }) {
  return lon >= 124 && lon <= 132 && lat >= 33 && lat <= 39;
}
