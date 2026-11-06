/**
 * tileset.json 한 개를 읽어 "이 타일셋이 어떤 종류인지"를 판별하는 순수 함수 모음.
 * three.js/DOM에 의존하지 않아서 단위 테스트가 쉽고, 로컬 파일/URL/백엔드 어느
 * 소스에서 읽었든 똑같이 쓸 수 있다.
 *
 * 판별 규칙 (docs/03-viewer-api.md 4절):
 *  - boundingVolume.region               -> geo (경위도 라디안)
 *  - box/sphere 중심의 크기가 지구 반경(약 6.0e6~6.5e6 m) 근처 -> geo (ECEF 좌표)
 *  - 그 외                                -> model (로컬 좌표)
 */

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

/** 지구 중심에서 이 범위 안에 있으면 ECEF로 authored된 데이터로 본다. */
const ECEF_RADIUS_MIN = 6.0e6;
const ECEF_RADIUS_MAX = 6.5e6;

/**
 * ECEF(x,y,z, m) -> 측지좌표(lon/lat 도, 타원체고 m). 반복법(수렴이 매우 빠름).
 * @param {number} x @param {number} y @param {number} z
 * @returns {{lon:number, lat:number, alt:number}}
 */
export function ecefToGeodetic(x, y, z) {
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - WGS84_E2));
  let alt = 0;
  for (let i = 0; i < 8; i++) {
    const sinLat = Math.sin(lat);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    // 극점 근처에서는 p가 0에 가까워 p/cos(lat)이 불안정하므로 z 기반 식으로 바꾼다.
    alt = Math.abs(lat) < Math.PI / 4 ? p / Math.cos(lat) - n : Math.abs(z) / Math.abs(sinLat) - n * (1 - WGS84_E2);
    lat = Math.atan2(z, p * (1 - (WGS84_E2 * n) / (n + alt)));
  }
  return { lon: (lon * 180) / Math.PI, lat: (lat * 180) / Math.PI, alt };
}

/** 3D Tiles의 column-major 4x4 transform을 점에 적용한다. */
function applyTransform(m, [x, y, z]) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** @param {number[]} v */
const len3 = (v) => Math.hypot(v[0], v[1], v[2]);

/**
 * @typedef {Object} TilesetInfo
 * @property {string|null} assetVersion         asset.version (3D Tiles 규격 버전)
 * @property {string|null} tilesetVersion       asset.tilesetVersion (데이터 제작자 버전 문자열)
 * @property {number|null} geometricError       최상위 geometricError
 * @property {string|null} refine               root.refine (ADD/REPLACE)
 * @property {'box'|'sphere'|'region'|'unknown'} volumeType
 * @property {number[]|null} center             root 중심 (box/sphere: 좌표계 그대로, region: [lon,lat,alt] 도/m)
 * @property {number[]|null} size               root 대략 크기 [x,y,z] (m, region은 null)
 * @property {boolean} hasRootTransform
 * @property {'geo'|'model'} detectedMode
 * @property {string} modeReason                판별 근거 (사용자에게 그대로 보여준다)
 * @property {{lon:number, lat:number, alt:number}|null} origin   geo일 때 자동 기준 원점 (alt는 0)
 * @property {number|null} centerAltitude       geo일 때 root 중심의 타원체고
 * @property {string[]} extensionsRequired
 * @property {string[]} extensionsUsed
 * @property {number} rootChildCount
 * @property {string[]} warnings
 */

/**
 * @param {any} json 파싱된 tileset.json
 * @returns {TilesetInfo}
 */
export function analyzeTileset(json) {
  const warnings = [];
  const root = json?.root;
  if (!json || typeof json !== 'object' || !root) {
    throw new Error('tileset.json 형식이 아닙니다 ("root"가 없음)');
  }

  const info = {
    assetVersion: json.asset?.version ?? null,
    tilesetVersion: json.asset?.tilesetVersion ?? null,
    geometricError: typeof json.geometricError === 'number' ? json.geometricError : null,
    refine: root.refine ?? null,
    volumeType: 'unknown',
    center: null,
    size: null,
    hasRootTransform: Array.isArray(root.transform),
    detectedMode: 'model',
    modeReason: '',
    origin: null,
    centerAltitude: null,
    extensionsRequired: json.extensionsRequired ?? [],
    extensionsUsed: json.extensionsUsed ?? [],
    rootChildCount: Array.isArray(root.children) ? root.children.length : 0,
    warnings,
  };

  const bv = root.boundingVolume ?? {};
  if (Array.isArray(bv.region) && bv.region.length === 6) {
    const [w, s, e, n, minH, maxH] = bv.region;
    const rad = 180 / Math.PI;
    info.volumeType = 'region';
    info.center = [((w + e) / 2) * rad, ((s + n) / 2) * rad, (minH + maxH) / 2];
    info.detectedMode = 'geo';
    info.modeReason = 'boundingVolume이 region(경위도) 형식';
    info.origin = { lon: info.center[0], lat: info.center[1], alt: 0 };
    info.centerAltitude = info.center[2];
  } else if (Array.isArray(bv.box) && bv.box.length === 12) {
    info.volumeType = 'box';
    let c = bv.box.slice(0, 3);
    if (info.hasRootTransform) c = applyTransform(root.transform, c);
    info.center = c;
    info.size = [
      2 * len3(bv.box.slice(3, 6)),
      2 * len3(bv.box.slice(6, 9)),
      2 * len3(bv.box.slice(9, 12)),
    ];
  } else if (Array.isArray(bv.sphere) && bv.sphere.length === 4) {
    info.volumeType = 'sphere';
    let c = bv.sphere.slice(0, 3);
    if (info.hasRootTransform) c = applyTransform(root.transform, c);
    info.center = c;
    const d = 2 * bv.sphere[3];
    info.size = [d, d, d];
  } else {
    warnings.push('root.boundingVolume을 해석할 수 없습니다 (box/sphere/region 아님)');
    info.modeReason = '판별 근거 없음 -> 기본값 model';
    return info;
  }

  if (info.volumeType !== 'region') {
    const dist = len3(info.center);
    if (dist >= ECEF_RADIUS_MIN && dist <= ECEF_RADIUS_MAX) {
      const g = ecefToGeodetic(info.center[0], info.center[1], info.center[2]);
      info.detectedMode = 'geo';
      info.modeReason = `중심이 지구 중심에서 ${(dist / 1000).toFixed(0)} km (ECEF 좌표로 판단)`;
      info.origin = { lon: g.lon, lat: g.lat, alt: 0 };
      info.centerAltitude = g.alt;
    } else {
      info.detectedMode = 'model';
      info.modeReason = `중심이 지구 중심에서 ${(dist / 1000).toFixed(1)} km (로컬 좌표로 판단)`;
    }
  }

  if (info.extensionsRequired.length > 0) {
    warnings.push(`필수 확장 사용: ${info.extensionsRequired.join(', ')}`);
  }
  return info;
}
