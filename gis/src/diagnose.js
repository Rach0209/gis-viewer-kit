/**
 * "왜 안 열리나 / 왜 이상하게 보이나"를 알려 주는 순수 함수 모음. DOM·Cesium을 모른다.
 *
 * 모든 안내는 문자열 하나이고, 원인과 해결 방법을 "\n→ " 로 나눈다: `problem('원인', '이렇게 해 보세요')`.
 * 화면(diagnoseUi.js)이 그 줄바꿈을 보고 원인 줄과 해결 줄을 다르게 보여 준다.
 *
 * 세 곳에서 쓴다.
 *  1) 열지 못한 파일의 이유 (explainSkipped, explainNoItems)
 *  2) 읽다가 난 오류에 덧붙일 해결 방법 (problem 으로 직접 만든다 — vectorParse.js)
 *  3) 읽은 자료가 이상할 때: 글자 깨짐, 경도·위도 뒤바뀜, 도형이 비었거나 깨진 피처 (dataDiagnostics, sanitizeFeatures)
 */

const SEP = '\n→ ';

/** 원인(text)과 해결(hint)을 한 문자열로 */
export const problem = (text, hint) => (hint ? `${text}${SEP}${hint}` : text);

/** @returns {{text:string, hint:string}} */
export function splitProblem(s) {
  const i = String(s).indexOf(SEP);
  return i < 0 ? { text: String(s), hint: '' } : { text: s.slice(0, i), hint: s.slice(i + SEP.length) };
}

// ---------------------------------------------------------------- 열지 못한 파일
const baseOf = (p) => String(p).split('/').pop();
const extOf = (p) => (baseOf(p).includes('.') ? baseOf(p).split('.').pop().toLowerCase() : '');

const EXPORT_HINT = 'QGIS에서 레이어를 우클릭 → 내보내기 → 새 파일로 저장 → 형식을 GeoJSON 또는 ESRI Shapefile로 골라 저장한 뒤 여세요.';

/** 확장자별 설명: [확장자들, 원인, 해결] */
const KNOWN = [
  [['gpkg'], 'GeoPackage(.gpkg)는 아직 읽지 못합니다.', EXPORT_HINT],
  [['dxf', 'dwg'], 'CAD 도면(DXF/DWG)은 아직 읽지 못합니다.', 'CAD나 QGIS에서 SHP 또는 GeoJSON으로 내보내세요. 도면 좌표는 좌표계 정보가 없는 경우가 많으니 내보낼 때 좌표계도 확인하세요.'],
  [['xlsx', 'xls', 'xlsm'], '엑셀 파일은 아직 직접 열지 못합니다.', "엑셀에서 '다른 이름으로 저장 → CSV UTF-8(쉼표로 분리)'로 저장한 뒤 그 CSV를 여세요. 경도·위도 열이 있으면 지도에 표시됩니다."],
  [['gdb', 'gdbtable', 'gdbtablx', 'gdbindexes', 'atx', 'spx', 'freelist', 'horizon', 'mdb', 'accdb'], 'Esri 지오데이터베이스(.gdb, .mdb)는 읽지 못합니다.', EXPORT_HINT],
  [['tab', 'mif', 'mid', 'map', 'id'], 'MapInfo 파일(.tab/.mif)은 읽지 못합니다.', EXPORT_HINT],
  [['qgz', 'qgs', 'mxd', 'aprx', 'lyr', 'lyrx'], 'QGIS/ArcGIS 프로젝트·레이어 파일은 열 수 없습니다.', '프로젝트가 연결해 둔 데이터 파일(.shp, .geojson 등)을 직접 선택하세요.'],
  [['rar', '7z', 'tar', 'gz', 'tgz', 'bz2'], '이 압축 형식은 풀지 못합니다.', 'ZIP으로 다시 압축하거나, 압축을 풀어 안의 파일을 직접 선택하세요.'],
  [['tif', 'tiff'], 'GeoTIFF는 벡터가 아니라 지형 또는 이미지입니다.', "위쪽의 '지형(DEM) 열기'(높이 값 격자) 또는 '이미지 열기'(항공·위성 사진)를 쓰세요."],
  [['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'], '그림 파일입니다. 위치를 알 수 있는 월드파일이 같이 필요합니다.', "'이미지 열기'에서 그림과 같은 이름의 월드파일(.pgw/.jgw/.wld)을 함께 고르세요."],
  [['ecw', 'sid', 'jp2', 'img'], '이 영상 형식은 브라우저에서 읽지 못합니다.', 'QGIS나 GDAL로 GeoTIFF(.tif)로 변환한 뒤 여세요.'],
  [['glb', 'gltf'], '3D 모델(glb)입니다.', "위쪽의 'glb 열기'를 쓰세요."],
  [['txt', 'xyz', 'asc'], '글자 파일입니다. 벡터가 아니라면 지형(DEM) 격자일 수 있습니다.', "점 좌표 표라면 .csv로 저장해 '벡터 열기'로, 지형 격자(XYZ/ASCII)라면 '지형(DEM) 열기'로 여세요."],
  [['sbn', 'sbx', 'qpj', 'xml', 'aux', 'ovr', 'lock', 'bak', 'tmp', 'cpx', 'fix'], '지도에 쓰이지 않는 보조 파일이라 건너뜁니다.', ''],
];

const ORPHAN = {
  dbf: '속성 파일(.dbf)만 있고 도형 파일(.shp)이 없습니다.',
  shx: '색인 파일(.shx)만 있고 도형 파일(.shp)이 없습니다.',
  prj: '좌표계 파일(.prj)만 있고 도형 파일(.shp)이 없습니다.',
  cpg: '인코딩 파일(.cpg)만 있고 도형 파일(.shp)이 없습니다.',
};
const ORPHAN_HINT = '같은 이름의 .shp 파일도 함께 선택하세요 (.shp, .dbf, .prj를 한꺼번에 고르거나 ZIP으로 묶어도 됩니다).';

const listNames = (names) => `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` 외 ${names.length - 3}개` : ''}`;

/**
 * 열지 못하고 건너뛴 파일들을 종류별로 묶어 이유와 해결 방법을 만든다.
 * @param {string[]} paths 건너뛴 파일 경로
 * @returns {string[]} problem() 형식의 안내들 (보조 파일만 있으면 해결 방법이 비어 있다)
 */
export function explainSkipped(paths) {
  const groups = new Map(); // 안내 키 -> {text, hint, names}
  const add = (key, text, hint, name) => {
    if (!groups.has(key)) groups.set(key, { text, hint, names: [] });
    groups.get(key).names.push(name);
  };
  for (const p of paths) {
    const name = baseOf(p);
    const ext = extOf(p);
    if (/(^|\/)[^/]+\.gdb\//i.test(p)) {
      const known = KNOWN.find((k) => k[0].includes('gdb'));
      add('gdb', known[1], known[2], p.split('/').find((s) => /\.gdb$/i.test(s)) ?? name);
    } else if (ORPHAN[ext]) {
      add(`orphan-${ext}`, ORPHAN[ext], ORPHAN_HINT, name);
    } else {
      const known = KNOWN.find((k) => k[0].includes(ext));
      if (known) add(known[0][0], known[1], known[2], name);
      else if (!ext) add('noext', '확장자가 없는 파일입니다.', '파일 이름 끝에 형식(.shp, .geojson, .kml, .gpx, .csv 등)이 있어야 합니다. 확장자가 숨겨져 있지 않은지 확인하세요.', name);
      else add(`ext-${ext}`, `이 형식(.${ext})은 지원하지 않습니다.`, '지원하는 벡터 형식: SHP(+.dbf/.prj), GeoJSON, KML/KMZ, GPX, CSV, ZIP.', name);
    }
  }
  return [...groups.values()].map((g) => problem(`${listNames(g.names)}: ${g.text}`, g.hint));
}

/**
 * 열 수 있는 벡터가 하나도 없을 때 보여 줄 안내 (읽다가 난 오류 + 건너뛴 파일의 이유).
 * @param {{errors?:string[], skipped?:string[]}} o
 */
export function explainNoItems({ errors = [], skipped = [] } = {}) {
  const out = [...errors, ...explainSkipped(skipped)];
  if (!out.length) {
    out.push(problem('열 수 있는 벡터 자료를 찾지 못했습니다.', 'SHP(.shp와 함께 .dbf/.prj), GeoJSON, KML/KMZ, GPX, CSV(경도·위도 열) 또는 이들을 담은 ZIP을 선택하세요.'));
  }
  return out;
}

// ---------------------------------------------------------------- 읽은 자료 점검
/** 글자가 깨졌을 때 나타나는 흔한 모양: 대체 문자(U+FFFD), 한글이 깨질 때의 '占', 라틴 글자 이어붙임(Ã…) */
const GARBLED = /�|占|[ÃÂ][\u0080-¿]/;

/**
 * 속성 값 중 깨진 글자가 있는가.
 * @param {Array<Record<string,any>|null|undefined>} propsList 앞쪽 피처들의 속성
 */
export function looksGarbled(propsList) {
  let seen = 0;
  for (const p of propsList) {
    if (!p) continue;
    for (const [k, v] of Object.entries(p)) {
      if (GARBLED.test(k) || (typeof v === 'string' && GARBLED.test(v))) return true;
    }
    if (++seen >= 200) break;
  }
  return false;
}

/**
 * 원본 좌표 범위가 "X=위도, Y=경도"로 뒤바뀐 것처럼 보이는가.
 * 한국을 포함해 경도가 90을 넘는 지역에서는 Y 가 90을 넘고 X 는 90 이하일 때 확실하다.
 */
export function looksSwapped(rawBbox) {
  if (!rawBbox) return false;
  const [minx, miny, maxx, maxy] = rawBbox;
  return minx >= -90 && maxx <= 90 && (maxy > 90 || miny < -90) && miny >= -180 && maxy <= 180;
}

const finite = (c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]);

/**
 * 좌표가 숫자가 아니거나(NaN) 점이 모자라 그릴 수 없는 도형을 뺀다. 도형이 아예 없는 피처는 그대로 둔다 (속성 표에서는 볼 수 있다).
 * 문제가 없으면 같은 객체를 그대로 돌려준다 (복사 비용 없음).
 * @returns {{features:object[], empty:number, broken:number}}
 *   empty: 도형이 없는 피처 수, broken: 좌표가 깨졌거나 점이 모자라 도형을 뺀 피처 수
 */
export function sanitizeFeatures(features) {
  let empty = 0;
  let broken = 0;
  let changed = false;
  const out = features.map((f) => {
    const g = f.geometry;
    if (!g) {
      empty++;
      return f;
    }
    const r = cleanGeometry(g);
    if (r.state === 'ok') return f;
    changed = true;
    if (r.state === 'empty') empty++;
    else broken++;
    return { ...f, geometry: r.geometry };
  });
  return { features: changed ? out : features, empty, broken };
}

/** @returns {{geometry:object|null, state:'ok'|'empty'|'broken'}} 일부 조각만 깨졌으면 그 조각만 빼고 'ok' 가 아닌 'fixed' 로 취급하지 않고 broken 으로 센다 */
function cleanGeometry(g) {
  const isEmptyCoords = (c) => !Array.isArray(c) || c.length === 0;
  switch (g.type) {
    case 'Point':
      if (isEmptyCoords(g.coordinates)) return { geometry: null, state: 'empty' };
      return finite(g.coordinates) ? { geometry: g, state: 'ok' } : { geometry: null, state: 'broken' };
    case 'LineString':
      if (isEmptyCoords(g.coordinates)) return { geometry: null, state: 'empty' };
      return g.coordinates.length >= 2 && g.coordinates.every(finite) ? { geometry: g, state: 'ok' } : { geometry: null, state: 'broken' };
    case 'Polygon': {
      if (isEmptyCoords(g.coordinates)) return { geometry: null, state: 'empty' };
      const rings = polygonRings(g.coordinates);
      if (!rings) return { geometry: null, state: 'broken' };
      return rings.length === g.coordinates.length ? { geometry: g, state: 'ok' } : { geometry: { ...g, coordinates: rings }, state: 'broken' };
    }
    case 'MultiPoint':
    case 'MultiLineString':
    case 'MultiPolygon': {
      if (isEmptyCoords(g.coordinates)) return { geometry: null, state: 'empty' };
      const one = g.type === 'MultiPoint' ? { type: 'Point' } : g.type === 'MultiLineString' ? { type: 'LineString' } : { type: 'Polygon' };
      const parts = [];
      let lost = false;
      for (const c of g.coordinates) {
        const r = cleanGeometry({ ...one, coordinates: c });
        if (r.geometry) parts.push(r.geometry.coordinates);
        if (r.state !== 'ok') lost = true;
      }
      if (!parts.length) return { geometry: null, state: 'broken' };
      return lost ? { geometry: { ...g, coordinates: parts }, state: 'broken' } : { geometry: g, state: 'ok' };
    }
    case 'GeometryCollection': {
      const kept = [];
      let lost = false;
      for (const x of g.geometries ?? []) {
        const r = cleanGeometry(x);
        if (r.geometry) kept.push(r.geometry);
        if (r.state !== 'ok') lost = true;
      }
      if (!kept.length) return { geometry: null, state: (g.geometries ?? []).length ? 'broken' : 'empty' };
      return lost ? { geometry: { ...g, geometries: kept }, state: 'broken' } : { geometry: g, state: 'ok' };
    }
    default:
      return { geometry: g, state: 'ok' }; // 모르는 종류는 그대로 둔다 (Cesium이 판단)
  }
}

/** 고리(바깥 + 구멍) 중 쓸 수 있는 것만. 바깥 고리가 못 쓰면 null (면 전체를 못 씀) */
function polygonRings(rings) {
  const valid = (r) => Array.isArray(r) && r.length >= 4 && r.every(finite);
  if (!valid(rings[0])) return null;
  return [rings[0], ...rings.slice(1).filter(valid)];
}

const fmt = (n) => n.toLocaleString('ko-KR');

/**
 * 읽은 자료가 이상할 때의 안내 (결과 info.warnings 에 덧붙는다).
 * @param {{
 *   kind:string, count:number, features:object[], rawBbox:number[]|null, bbox:number[]|null,
 *   center:{lon:number,lat:number}|null, crs:{code:string|null, source:string}, nearKorea:boolean|null,
 *   canPickEncoding:boolean, suggestCrs:string|null, empty:number, broken:number, swapped:boolean, hasHeights?:boolean
 * }} o
 * @returns {string[]}
 */
export function dataDiagnostics(o) {
  const out = [];
  if (o.canPickEncoding && looksGarbled(o.features.slice(0, 300).map((f) => f.properties))) {
    out.push(problem('속성의 한글이 깨져 보입니다.', "'속성 인코딩'을 EUC-KR(한글 윈도우에서 만든 파일) 또는 UTF-8로 바꿔 보세요. 값이 제대로 읽히는 쪽이 맞는 인코딩입니다."));
  }
  if (o.swapped) {
    out.push(problem(`X와 Y가 서로 바뀐 것 같습니다 (X=${fmt(round(o.rawBbox[0]))}, Y=${fmt(round(o.rawBbox[1]))} 근처). 보통 X가 경도, Y가 위도입니다.`, o.kind === 'csv' ? "'경도(X) 열'과 '위도(Y) 열'을 서로 바꿔 고르거나, 아래 'X·Y 순서 바꾸기'를 켜세요." : "아래 'X·Y 순서 바꾸기'를 켜 보세요."));
  }
  const farOut = o.center && o.nearKorea === false;
  if (farOut && !o.swapped && o.suggestCrs && o.suggestCrs !== o.crs.code && o.crs.source !== 'guess') {
    out.push(problem(`지금 좌표계(${o.crs.code ?? '.prj 정의'})로는 한국 밖에 놓이는데, 같은 숫자를 ${o.suggestCrs}로 읽으면 한국 안에 놓입니다.`, `좌표계에서 ${o.suggestCrs} 계열을 골라 보세요. 해외 자료라면 그대로 두세요.`));
  }
  if (o.bbox && Math.abs(o.bbox[0]) < 1e-6 && Math.abs(o.bbox[1]) < 1e-6 && Math.abs(o.bbox[2]) < 1e-6 && Math.abs(o.bbox[3]) < 1e-6) {
    out.push(problem('모든 좌표가 0, 0 입니다. 위치 정보가 비어 있는 자료입니다.', o.kind === 'csv' ? '경도·위도 열을 제대로 골랐는지 확인하세요.' : '원본 파일에 좌표가 들어 있는지 확인하세요.'));
  }
  if (o.empty) out.push(problem(`${fmt(o.empty)}개 피처는 도형이 없어 지도에 나오지 않습니다 (속성만 있음).`, "레이어 줄의 '속성표' 버튼으로 열면 볼 수 있습니다."));
  if (o.broken) out.push(problem(`${fmt(o.broken)}개 피처는 좌표가 숫자가 아니거나 점이 모자라, 그릴 수 없는 부분을 뺐습니다.`, '원본 파일이 깨졌거나 편집 중 잘못 저장된 것일 수 있습니다. 원본을 QGIS에서 열어 확인해 보세요.'));
  if (o.count >= 100000) out.push(problem(`피처가 ${fmt(o.count)}개로 많아 지도가 느려질 수 있습니다.`, '필요한 지역만 잘라낸 파일을 쓰거나, 위쪽 성능 설정을 확인하세요.'));
  return out;
}

const round = (n) => Math.round(n * 1e4) / 1e4;

/** 피처가 0개일 때의 이유 (자료 종류별) */
export function emptyReason(kind, source, extra = {}) {
  if (source === 'KML') {
    return extra.networkLinks
      ? problem('이 KML에는 그릴 자료가 없고 다른 곳을 가리키는 링크(NetworkLink)만 있습니다.', '링크가 가리키는 주소의 KML/KMZ를 따로 내려받아 여세요.')
      : problem('KML에 Placemark(점·선·면)가 없습니다.', '구글어스에서 내보낸 파일이 맞는지 확인하세요. 이미지 오버레이(GroundOverlay)만 있는 KML은 열 수 없습니다.');
  }
  if (source === 'GPX') return problem('GPX에 경로(trk)·경유지(wpt)·루트(rte)가 없습니다.', 'GPS 기기에서 기록이 비어 있지 않은지 확인하세요.');
  if (kind === 'shp') return problem('SHP에 도형이 없습니다.', '다른 프로그램(QGIS)에서 열어 피처가 있는지 확인하세요. .shp 파일 크기가 0이거나 매우 작으면 내려받기가 덜 된 것입니다.');
  if (kind === 'geojson') return problem('GeoJSON에 피처가 없습니다 (features가 비어 있음).', '파일 내용을 확인하거나 원본에서 다시 내보내세요.');
  return problem('피처가 없습니다.', '');
}
