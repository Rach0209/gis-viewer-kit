import proj4 from 'proj4';

/**
 * 좌표계. 목록에 있는 대표 좌표계(CRS_LIST) + 직접 추가한 좌표계(registerCrs) + UTM 존(EPSG:326xx / 327xx, 어디서든)을
 * getCrs() 하나로 같은 모양으로 꺼내 쓴다. GLB 좌표 입력, GeoJSON/SHP/CSV, 지형(DEM), 마우스 좌표가 모두 이 모듈을 쓴다.
 *
 * 목록에 없는 EPSG 번호, PROJ 문자열, WKT(.prj 내용)는 crsLookup.js 가 정의를 구해 registerCrs 로 넣는다.
 *
 * 한국 좌표계의 정의는 EPSG 공식 값(횡메르카토르)을 proj4 문자열로 옮긴 것이다.
 * 옛 좌표계(EPSG:5174 등 베셀 타원체)는 자료마다 변환 매개변수가 달라 위치가 수십 m 어긋날 수 있다 (목록 이름에 적어 둔다).
 *
 * 좌표 순서는 항상 (X=동쪽/경도, Y=북쪽/위도) 이다.
 *
 * @typedef {{
 *   code: string, label: string, geographic: boolean,
 *   xLabel: string, yLabel: string, unit: 'deg'|'m'|'ft', def?: string, custom?: boolean,
 * }} CrsInfo
 */

const M_LABELS = { xLabel: 'X (동쪽, m)', yLabel: 'Y (북쪽, m)', unit: 'm' };

/** 한국 횡메르카토르 (GRS80): 위도 38도, 중앙자오선·축척·거짓 원점은 좌표계마다 다르다 */
const GRS80_TM = (lon0, k, x0, y0) =>
  `+proj=tmerc +lat_0=38 +lon_0=${lon0} +k=${k} +x_0=${x0} +y_0=${y0} +ellps=GRS80 +units=m +no_defs`;

/** 옛 한국 좌표계(베셀 1841, 한국 측지계 1985)를 WGS84로 옮기는 흔한 3-매개변수/7-매개변수 값 */
const BESSEL_TM = (lon0, y0) =>
  `+proj=tmerc +lat_0=38 +lon_0=${lon0} +k=1 +x_0=200000 +y_0=${y0} +ellps=bessel +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43 +units=m +no_defs`;

const proj = (code, label, def) => ({ code, label, geographic: false, ...M_LABELS, def });

/**
 * 목록에 먼저 보이는 대표 좌표계.
 * @type {CrsInfo[]}
 */
export const CRS_LIST = [
  { code: 'EPSG:4326', label: 'WGS84 경위도 (EPSG:4326, GPS)', geographic: true, xLabel: '경도', yLabel: '위도', unit: 'deg' },
  proj('EPSG:5179', 'UTM-K / Korea 2000 통합 (EPSG:5179)', GRS80_TM(127.5, 0.9996, 1000000, 2000000)),
  proj('EPSG:5186', 'Korea 2000 중부원점 (EPSG:5186)', GRS80_TM(127, 1, 200000, 600000)),
  proj('EPSG:5185', 'Korea 2000 서부원점 (EPSG:5185)', GRS80_TM(125, 1, 200000, 600000)),
  proj('EPSG:5187', 'Korea 2000 동부원점 (EPSG:5187)', GRS80_TM(129, 1, 200000, 600000)),
  proj('EPSG:5188', 'Korea 2000 동해원점 (EPSG:5188)', GRS80_TM(131, 1, 200000, 600000)),
  proj('EPSG:5181', 'Korea 2000 중부원점 (구, EPSG:5181)', GRS80_TM(127, 1, 200000, 500000)),
  proj('EPSG:5180', 'Korea 2000 서부원점 (구, EPSG:5180)', GRS80_TM(125, 1, 200000, 500000)),
  proj('EPSG:5183', 'Korea 2000 동부원점 (구, EPSG:5183)', GRS80_TM(129, 1, 200000, 500000)),
  proj('EPSG:5174', '옛 중부원점 베셀 (EPSG:5174, 수십 m 오차 가능)', BESSEL_TM(127.0028902777778, 500000)),
  proj('EPSG:3857', '웹 메르카토르 (EPSG:3857, 웹 지도)', '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs'),
  proj('EPSG:32652', 'WGS84 / UTM 52N (EPSG:32652, 한국 동쪽·GPS 장비)', '+proj=utm +zone=52 +datum=WGS84 +units=m +no_defs'),
  proj('EPSG:32651', 'WGS84 / UTM 51N (EPSG:32651, 한국 서쪽)', '+proj=utm +zone=51 +datum=WGS84 +units=m +no_defs'),
];

export const DEFAULT_CRS = 'EPSG:5179';

/** 직접 추가한 좌표계: 코드 -> CrsInfo (이 페이지를 닫으면 사라진다. crsLookup.js 가 최근 것을 저장해 둔다) */
const custom = new Map();

let registered = false;
function ensureRegistered() {
  if (registered) return;
  for (const c of CRS_LIST) if (c.def) proj4.defs(c.code, c.def);
  registered = true;
}

/** UTM 존이면 정의를 만든다: EPSG:326xx(북반구), 327xx(남반구), xx = 1..60 */
function utmInfo(code) {
  const m = /^EPSG:(326|327)(\d\d)$/.exec(code);
  if (!m) return null;
  const zone = Number(m[2]);
  if (zone < 1 || zone > 60) return null;
  const south = m[1] === '327';
  return proj(code, `WGS84 / UTM ${zone}${south ? 'S' : 'N'} (${code})`, `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`);
}

const UNIT_LABEL = { m: 'm', ft: 'ft', 'us-ft': 'ft(미국 측량)', km: 'km' };

/**
 * proj4 정의(PROJ 문자열 또는 WKT)에서 CrsInfo 를 만든다. 해석할 수 없으면 오류.
 * @param {string} code 예: 'EPSG:2154', 'CUSTOM:1'
 * @param {string} def
 * @param {string} [label]
 * @returns {CrsInfo}
 */
export function crsInfoFromDef(code, def, label) {
  let p;
  try {
    p = new proj4.Proj(def);
  } catch (e) {
    throw new Error(`좌표계 정의를 해석할 수 없습니다 (${e?.message ?? e})`);
  }
  if (!p || (!p.projName && !p.title)) throw new Error('좌표계 정의를 해석할 수 없습니다');
  const geographic = p.projName === 'longlat';
  if (geographic) {
    return { code, label: label ?? `${code} (경위도)`, geographic: true, xLabel: '경도', yLabel: '위도', unit: 'deg', def, custom: true };
  }
  const unitKey = p.units && UNIT_LABEL[p.units] ? p.units : 'm';
  const u = UNIT_LABEL[unitKey];
  return {
    code,
    label: label ?? code,
    geographic: false,
    xLabel: `X (동쪽, ${u})`,
    yLabel: `Y (북쪽, ${u})`,
    unit: unitKey === 'm' || unitKey === 'km' ? 'm' : 'ft',
    def,
    custom: true,
  };
}

/** 직접 추가: 이후 getCrs/toLonLat/fromLonLat 에서 코드로 쓸 수 있다. 같은 코드는 새 정의로 바뀐다. */
export function registerCrs({ code, def, label }) {
  const info = crsInfoFromDef(code, def, label);
  proj4.defs(code, def);
  custom.set(code, info);
  return info;
}

/** 직접 추가한 좌표계 목록 (선택 목록에 붙일 때) */
export const customCrsList = () => [...custom.values()];

export const isKnownCrs = (code) => {
  try {
    getCrs(code);
    return true;
  } catch {
    return false;
  }
};

/** @param {string} code @returns {CrsInfo} */
export function getCrs(code) {
  const c = CRS_LIST.find((x) => x.code === code) ?? custom.get(code);
  if (c) return c;
  const utm = utmInfo(code);
  if (utm) {
    ensureRegistered();
    proj4.defs(code, utm.def);
    custom.set(code, { ...utm, custom: true });
    return custom.get(code);
  }
  throw new Error(`지원하지 않는 좌표계: ${code}`);
}

/** 정의로 변환해야 하는가: 4326 은 그대로, 그 밖에는 (경위도라도 측지계가 다를 수 있어) proj4 로 바꾼다 */
const needsProj = (c) => c.code !== 'EPSG:4326';

/**
 * 해당 좌표계의 (x, y)를 경위도(WGS84)로 바꾼다. 4326이면 그대로.
 * @returns {{lon:number, lat:number}}
 */
export function toLonLat(code, x, y) {
  const c = getCrs(code);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('좌표가 숫자가 아닙니다');
  if (!needsProj(c)) return { lon: x, lat: y };
  ensureRegistered();
  const [lon, lat] = proj4(c.code, 'EPSG:4326', [x, y]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error('이 좌표를 경위도로 바꿀 수 없습니다');
  return { lon, lat };
}

/** 경위도(WGS84)를 해당 좌표계의 (x, y)로. */
export function fromLonLat(code, lon, lat) {
  const c = getCrs(code);
  if (!needsProj(c)) return { x: lon, y: lat };
  ensureRegistered();
  const [x, y] = proj4('EPSG:4326', c.code, [lon, lat]);
  return { x, y };
}

/** 경위도가 유효한 범위인가 (좌표계를 잘못 골랐을 때 대부분 여기서 걸린다) */
export function isValidLonLat({ lon, lat }) {
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
}

/** 한국 주변(대략 124~132E, 33~39N)인가. 아니면 좌표계를 잘못 골랐을 가능성을 알려 주는 용도다 (해외 자료면 정상). */
export function isNearKorea({ lon, lat }) {
  return lon >= 124 && lon <= 132 && lat >= 33 && lat <= 39;
}
