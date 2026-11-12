/**
 * GeoJSON / Shapefile(SHP+DBF+PRJ+CPG, ZIP 포함)을 읽어 WGS84(경위도) GeoJSON으로 바꾼다. Cesium에 의존하지 않는다.
 *
 * 한국 데이터에서 문제가 되는 두 가지를 직접 다룬다.
 *  1) 한글 속성 인코딩: .cpg가 CP949/949/EUC-KR이면 한국어 완성형(WHATWG 이름 'euc-kr')으로, 없으면 UTF-8로 엄격하게
 *     읽어 보고 깨지면 EUC-KR로 읽는다. 사용자가 고를 수도 있다. (shpjs는 `.cpg`가 CP949이거나 없으면 한글이 깨진다)
 *  2) 좌표계: .prj가 있으면 그걸 쓰고, 없으면 좌표 범위로 추정(5179 / 5186 / 4326 …)하며, 사용자가 고를 수도 있다.
 *
 * 흐름: collectGroups(파일들) -> readRaw(그룹) (파일을 한 번만 읽음) -> buildCollection(raw, 설정) (설정을 바꿔도 다시 읽지 않음)
 */
import { parseShp, parseDbf } from 'shpjs';
import proj4 from 'proj4';
import { iter } from 'but-unzip';
import { DOMParser } from '@xmldom/xmldom';
import { gpx as gpxToGeoJson, kml as kmlToGeoJson } from '@tmcw/togeojson';
import { CRS_LIST, getCrs, isKnownCrs, isNearKorea, isValidLonLat } from '../../viewer/src/kit/crsList.js';
import { csvToPoints } from './csvParse.js';
import { dataDiagnostics, emptyReason, looksSwapped, problem, sanitizeFeatures } from './diagnose.js';
import { hasHeights } from './geomHeights.js';
import { baseOf, extOf, isVectorFileName, stemOf } from './vectorNames.js';

// ---------------------------------------------------------------- 인코딩
/** .cpg 내용 → 'utf-8' | 'euc-kr' | 'windows-1252' | null(모름) */
export function normalizeEncoding(label) {
  const t = String(label ?? '').trim().toLowerCase().split('_').join('-').split(' ').join('-');
  if (!t) return null;
  if (['utf-8', 'utf8', '65001'].includes(t)) return 'utf-8';
  if (['949', 'cp949', 'ms949', 'mscp949', 'windows-949', 'euc-kr', 'euckr', 'ks-c-5601', 'ks-c-5601-1987', 'ksc5601', 'ansi-949', 'uhc'].includes(t)) return 'euc-kr';
  if (['1252', 'cp1252', 'windows-1252', 'latin1', 'iso-8859-1'].includes(t)) return 'windows-1252';
  return null;
}

/**
 * @param {ArrayBuffer} dbfBuf
 * @param {string} [cpgText]
 * @returns {{encoding:string, source:'cpg'|'ascii'|'utf8'|'euc-kr-guess'}}
 */
export function detectEncoding(dbfBuf, cpgText) {
  const fromCpg = normalizeEncoding(cpgText);
  if (fromCpg) return { encoding: fromCpg, source: 'cpg' };
  const bytes = new Uint8Array(dbfBuf);
  if (!bytes.some((b) => b >= 0x80)) return { encoding: 'utf-8', source: 'ascii' };
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { encoding: 'utf-8', source: 'utf8' };
  } catch {
    return { encoding: 'euc-kr', source: 'euc-kr-guess' };
  }
}

// ---------------------------------------------------------------- 파일 모으기
export { isVectorFileName };

const toArrayBuffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

/** 파일들(File 또는 같은 모양의 객체)과 ZIP 안의 파일을 한 목록으로 편다. */
async function expandEntries(files) {
  /** @type {{path:string, read:()=>Promise<ArrayBuffer>}[]} */
  const out = [];
  for (const f of files) {
    if (/\.(zip|kmz)$/i.test(f.name)) {
      const isKmz = /\.kmz$/i.test(f.name);
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (!bytes.length) throw new Error(problem(`${f.name}: 비어 있는 파일(0바이트)입니다.`, '내려받기나 복사가 중간에 끊겼을 수 있습니다. 원본을 다시 받아 보세요.'));
      try {
        for (const e of iter(bytes)) {
          const name = String(e.filename).split(String.fromCharCode(92)).join('/');
          if (name.endsWith('/') || name.startsWith('__MACOSX/') || baseOf(name).startsWith('.')) continue;
          if (isKmz && extOf(name) !== 'kml') continue; // KMZ 안의 그림·아이콘은 건너뛴 목록에도 올리지 않는다
          out.push({ path: name, origin: f.name, read: async () => toArrayBuffer(await e.read()) });
        }
      } catch (e) {
        throw new Error(problem(`${f.name}: ${isKmz ? 'KMZ' : 'ZIP'}을 풀 수 없습니다 (${e.message}).`, '파일이 중간에 끊겼거나 ZIP이 아닐 수 있습니다. 암호가 걸린 ZIP도 열 수 없으니 풀어서 안의 파일을 직접 선택하세요.'));
      }
    } else {
      out.push({ path: f.name, read: () => f.arrayBuffer() });
    }
  }
  return out;
}

/**
 * @param {Array<{name:string, arrayBuffer:()=>Promise<ArrayBuffer>}>} files
 * @returns {Promise<{groups: Array<{name:string, kind:'shp'|'geojson', parts:Record<string,{path:string, read:()=>Promise<ArrayBuffer>}>}>, skipped: string[]}>}
 */
export async function collectGroups(files) {
  const entries = await expandEntries(files);
  const byStem = new Map();
  const groups = [];
  const used = new Set();
  const styles = []; // 같이 선택한 SLD 스타일 파일 (데이터 묶음과 이름이 같을 필요는 없다)
  for (const e of entries) {
    const ext = extOf(e.path);
    if (ext === 'sld') {
      styles.push({ name: baseOf(e.path), read: e.read });
      used.add(e.path);
    } else if (ext === 'geojson' || ext === 'json') {
      groups.push({ name: baseOf(e.path), kind: 'geojson', parts: { geojson: e } });
      used.add(e.path);
    } else if (ext === 'kml' || ext === 'gpx' || ext === 'csv' || ext === 'gpkg') {
      // KMZ 안의 doc.kml 은 이름이 늘 같아서 KMZ 파일 이름으로 보여 준다
      const name = e.origin ? baseOf(e.origin) : baseOf(e.path);
      groups.push({ name, kind: ext, parts: { file: e } });
      used.add(e.path);
    } else if (['shp', 'dbf', 'prj', 'cpg', 'shx'].includes(ext)) {
      const key = stemOf(e.path).toLowerCase();
      if (!byStem.has(key)) byStem.set(key, { name: baseOf(stemOf(e.path)), kind: 'shp', parts: {} });
      byStem.get(key).parts[ext] = e;
    }
  }
  for (const g of byStem.values()) {
    if (g.parts.shp) {
      groups.push(g);
      for (const p of Object.values(g.parts)) used.add(p.path);
    }
  }
  const skipped = entries.filter((e) => !used.has(e.path)).map((e) => e.path);
  return { groups, skipped, styles };
}

// ---------------------------------------------------------------- 읽기
const decodeText = (buf) => new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '');

/**
 * 파일 내용을 한 번만 읽는다 (좌표 변환·인코딩은 하지 않은 원본).
 * @returns {Promise<{kind:'shp'|'geojson', name:string, geoms?:object[], geojson?:object, dbfBuf?:ArrayBuffer|null, prjText:string|null, cpgText:string|null}>}
 */
const GEOJSON_TYPES = new Set(['FeatureCollection', 'Feature', 'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection']);

/** 비어 있는 파일은 읽기 전에 알려 준다 (내려받기가 끊겼을 때 흔하다) */
function assertNotEmpty(buf, name) {
  if (!buf || buf.byteLength === 0) throw new Error(problem(`${name}: 비어 있는 파일(0바이트)입니다.`, '내려받기나 복사가 중간에 끊겼을 수 있습니다. 원본을 다시 받아 보세요.'));
}

/**
 * 묶음 하나를 읽어 원본(raw)들로 돌려준다. 거의 모든 형식은 원본 하나지만, GeoPackage 는 한 파일에 지형지물 표가 여러 개 들어 있어
 * 표마다 원본이 하나씩 나온다. (표를 훑는 라이브러리(sql.js, wasm)는 GeoPackage를 열 때만 불러온다)
 * @returns {Promise<{raws: object[], skippedTables?: string[]}>}
 */
export async function readRaws(group) {
  if (group.kind === 'gpkg') {
    const buf = await group.parts.file.read();
    assertNotEmpty(buf, group.name);
    const { readGpkg } = await import('./gpkgRead.js');
    return readGpkg(buf, group.name);
  }
  return { raws: [await readRaw(group)] };
}

export async function readRaw(group) {
  if (group.kind === 'gpkg') throw new Error('GeoPackage는 readRaws 로 읽습니다 (표가 여러 개일 수 있습니다)');
  if (group.kind === 'geojson') {
    const buf = await group.parts.geojson.read();
    assertNotEmpty(buf, group.name);
    let geojson;
    try {
      geojson = JSON.parse(decodeText(buf));
    } catch (e) {
      throw new Error(problem(`${group.name}: GeoJSON을 읽을 수 없습니다 (${e.message}).`, '파일이 중간에 잘렸거나 JSON이 아닙니다. 내용이 { 로 시작하고 "type": "FeatureCollection" 이 있는지 확인하세요.'));
    }
    if (geojson?.type === 'Topology') {
      throw new Error(problem(`${group.name}: TopoJSON입니다. GeoJSON이 아니라 열 수 없습니다.`, 'QGIS나 mapshaper에서 GeoJSON으로 내보낸 뒤 여세요.'));
    }
    if (!geojson || !GEOJSON_TYPES.has(geojson.type)) {
      throw new Error(problem(`${group.name}: GeoJSON이 아닙니다 ("type" 값이 ${geojson?.type ? `"${geojson.type}"` : '없음'}).`, 'GeoJSON은 type이 FeatureCollection·Feature 또는 도형 이름(Point, Polygon 등)이어야 합니다. 3D Tiles의 tileset.json 같은 다른 JSON은 열 수 없습니다.'));
    }
    return { kind: 'geojson', source: 'GeoJSON', name: group.name, geojson, dbfBuf: null, prjText: null, cpgText: null };
  }
  if (group.kind === 'kml' || group.kind === 'gpx') {
    // KML/GPX 는 늘 경위도(WGS84)라서 좌표계를 묻지 않는다. 변환은 togeojson 이 한다.
    const label = group.kind.toUpperCase();
    const buf = await group.parts.file.read();
    assertNotEmpty(buf, group.name);
    let geojson;
    let networkLinks = false;
    try {
      const doc = new DOMParser({ onError: () => {} }).parseFromString(decodeText(buf), 'text/xml');
      if (!doc?.documentElement) throw new Error('XML이 아닙니다');
      geojson = group.kind === 'kml' ? kmlToGeoJson(doc) : gpxToGeoJson(doc);
      networkLinks = group.kind === 'kml' && doc.getElementsByTagName('NetworkLink').length > 0;
    } catch (e) {
      throw new Error(problem(`${group.name}: ${label}을 읽을 수 없습니다 (${e.message}).`, `파일이 중간에 끊겼거나 확장자만 ${label}로 바뀐 다른 파일일 수 있습니다. 텍스트로 열어 <?xml 로 시작하고 <${group.kind === 'kml' ? 'kml' : 'gpx'} 가 있는지 확인하세요.`));
    }
    return { kind: 'geojson', source: label, crsFixed: true, networkLinks, name: group.name, geojson, dbfBuf: null, prjText: null, cpgText: null };
  }
  if (group.kind === 'csv') {
    // 글자 해석(인코딩·구분자·좌표 열)은 설정을 바꿀 때마다 다시 해야 하므로 원본 바이트만 들고 있는다
    const buf = await group.parts.file.read();
    assertNotEmpty(buf, group.name);
    return { kind: 'csv', source: 'CSV', name: group.name, buf, dbfBuf: null, prjText: null, cpgText: null };
  }
  let geoms;
  try {
    const shpBuf = await group.parts.shp.read();
    assertNotEmpty(shpBuf, `${group.name}.shp`);
    geoms = parseShp(shpBuf);
  } catch (e) {
    if (/비어 있는 파일/.test(e.message)) throw e;
    throw new Error(problem(`${group.name}: SHP를 읽을 수 없습니다 (${e.message}).`, '파일이 깨졌거나 SHP가 아닐 수 있습니다. QGIS에서 열어 보고, 열리지 않으면 원본을 다시 받으세요. 지원하지 않는 도형 종류(멀티패치 등)일 수도 있습니다.'));
  }
  return {
    kind: 'shp',
    source: 'SHP',
    name: group.name,
    geoms,
    dbfBuf: group.parts.dbf ? await group.parts.dbf.read() : null,
    prjText: group.parts.prj ? decodeText(await group.parts.prj.read()).trim() : null,
    cpgText: group.parts.cpg ? decodeText(await group.parts.cpg.read()).trim() : null,
  };
}

// ---------------------------------------------------------------- 좌표 순회
function mapCoords(coords, fn) {
  return typeof coords[0] === 'number' ? fn(coords) : coords.map((c) => mapCoords(c, fn));
}
function mapGeometry(g, fn) {
  if (!g) return g;
  if (g.type === 'GeometryCollection') return { ...g, geometries: g.geometries.map((x) => mapGeometry(x, fn)) };
  return { ...g, coordinates: mapCoords(g.coordinates, fn) };
}
function eachCoord(g, fn) {
  if (!g) return;
  if (g.type === 'GeometryCollection') return g.geometries.forEach((x) => eachCoord(x, fn));
  const walk = (c) => (typeof c[0] === 'number' ? fn(c) : c.forEach(walk));
  return walk(g.coordinates);
}
function bboxOf(geometries) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const g of geometries) {
    eachCoord(g, (c) => {
      if (c[0] < minx) minx = c[0];
      if (c[0] > maxx) maxx = c[0];
      if (c[1] < miny) miny = c[1];
      if (c[1] > maxy) maxy = c[1];
    });
  }
  return Number.isFinite(minx) ? [minx, miny, maxx, maxy] : null;
}

// ---------------------------------------------------------------- 좌표계
export const CRS_CHOICES = CRS_LIST.map((c) => ({ code: c.code, label: c.label }));
const GUESS_ORDER = ['EPSG:5179', 'EPSG:5186', 'EPSG:5187', 'EPSG:5185', 'EPSG:3857'];

const projName = (wkt) => /^(?:PROJCS|GEOGCS|PROJCRS|GEOGCRS)\["([^"]+)"/.exec(wkt)?.[1] ?? null;

/** 원본 좌표 범위로 좌표계를 추정한다. 도 단위면 4326, 아니면 한국 안에 놓이는 좌표계 중 첫 번째. */
export function guessCrs(bbox) {
  if (!bbox) return null;
  const [minx, miny, maxx, maxy] = bbox;
  if (minx >= -180 && maxx <= 180 && miny >= -90 && maxy <= 90) return 'EPSG:4326';
  const cx = (minx + maxx) / 2;
  const cy = (miny + maxy) / 2;
  for (const code of GUESS_ORDER) {
    const def = getCrs(code).def;
    if (!def) continue;
    let ll;
    try {
      const [lon, lat] = proj4(def, 'WGS84').forward([cx, cy]);
      ll = { lon, lat };
    } catch {
      continue;
    }
    if (isValidLonLat(ll) && isNearKorea(ll)) return code;
  }
  return null;
}

const epsgFromGeoJsonCrs = (geojson) => {
  const name = geojson?.crs?.properties?.name;
  const m = typeof name === 'string' ? /EPSG:{1,2}(\d+)/i.exec(name) : null;
  return m ? `EPSG:${m[1]}` : null;
};

/** @returns {{convert:(c:number[])=>number[], code:string|null, label:string, source:string}} */
function resolveCrs(raw, bbox, choice) {
  const identity = (code, label, source) => ({ convert: (c) => c, code, label, source });
  const fromDef = (def, code, label, source) => {
    const t = proj4(def, 'WGS84');
    // 좌표마다 불리는 함수라 배열을 덜 만든다 (높이 같은 세 번째 값이 있을 때만 이어 붙인다)
    return {
      convert: (c) => {
        const p = t.forward([c[0], c[1]]);
        return c.length > 2 ? [p[0], p[1], ...c.slice(2)] : p;
      },
      code,
      label,
      source,
    };
  };
  const fromCode = (code, source) => {
    if (code === 'EPSG:4326') return identity(code, getCrs(code).label, source);
    const info = isKnownCrs(code) ? getCrs(code) : null;
    if (!info?.def) throw new Error(`지원하지 않는 좌표계입니다: ${code}`);
    return fromDef(info.def, code, info.label, source);
  };

  if (choice && choice !== 'auto') return fromCode(choice, 'user');
  // KML·GPX 는 규격상 늘 경위도(WGS84)다
  if (raw.crsFixed) return identity('EPSG:4326', 'WGS84 (KML·GPX는 항상 경위도)', 'format');

  // GeoPackage 는 좌표계가 파일 안에 있다: EPSG 번호를 알면 그것으로, 아니면 파일에 든 정의(WKT)로
  if (raw.srs) {
    if (raw.srs.code && (raw.srs.code === 'EPSG:4326' || isKnownCrs(raw.srs.code))) return fromCode(raw.srs.code, 'gpkg');
    if (raw.srs.wkt && /^\s*(PROJCS|GEOGCS|PROJCRS|GEOGCRS|GEODCRS|COMPD_CS|COMPOUNDCRS|\+proj)/i.test(raw.srs.wkt)) {
      try {
        return fromDef(raw.srs.wkt, raw.srs.code, `GeoPackage: ${projName(raw.srs.wkt) ?? '정의 있음'}`, 'gpkg');
      } catch {
        /* 해석할 수 없으면 추정으로 넘어간다 */
      }
    }
  }
  if (raw.kind === 'shp' && raw.prjText) {
    try {
      return fromDef(raw.prjText, null, `.prj: ${projName(raw.prjText) ?? '정의 있음'}`, 'prj');
    } catch {
      /* .prj를 해석할 수 없으면 추정으로 넘어간다 */
    }
  }
  if (raw.kind === 'geojson') {
    const code = epsgFromGeoJsonCrs(raw.geojson);
    if (code && (code === 'EPSG:4326' || isKnownCrs(code))) return fromCode(code, 'geojson-crs');
  }
  const g = guessCrs(bbox);
  if (g) return fromCode(g, g === 'EPSG:4326' && (raw.kind === 'geojson' || raw.kind === 'csv') ? 'default' : 'guess');
  return identity('EPSG:4326', 'WGS84 (좌표계를 알 수 없어 경위도로 가정)', 'default');
}

// ---------------------------------------------------------------- 조립
const rawFeatures = (raw, props) => {
  if (raw.kind === 'shp') return raw.geoms.map((geometry, i) => ({ type: 'Feature', geometry, properties: props?.[i] ?? {} }));
  const g = raw.geojson;
  if (g.type === 'FeatureCollection') return g.features ?? [];
  if (g.type === 'Feature') return [g];
  return [{ type: 'Feature', geometry: g, properties: {} }];
};

/**
 * @param {Awaited<ReturnType<typeof readRaw>>} raw
 * @param {{encoding?:string, crs?:string, delimiter?:string, xCol?:number, yCol?:number, swapXY?:boolean}} [opts]
 *   encoding: 'auto' | 'utf-8' | 'euc-kr' | ..., crs: 'auto' | 'EPSG:xxxx',
 *   delimiter·xCol·yCol: CSV 만 (구분자 'auto' | ',' | '\t' | ';' | '|', 경도·위도 열 번호)
 *   swapXY: 원본 좌표의 X·Y 순서를 바꿔 읽는다 (위도, 경도 순으로 저장된 자료)
 * @returns {{collection:object, info:object}}
 */
export function buildCollection(raw, { encoding = 'auto', crs = 'auto', delimiter = 'auto', xCol, yCol, swapXY = false } = {}) {
  const warnings = [...(raw.readWarnings ?? [])]; // 읽는 중에 알게 된 것(GeoPackage의 지원하지 않는 도형 등)

  // 속성 (SHP만 DBF가 따로 있다)
  let enc = null;
  let props = null;
  let csv = null; // CSV 일 때만: 열 이름, 고른 열, 구분자 (화면이 열 선택칸을 채우는 데 쓴다)
  let csvFeatures = null;
  if (raw.kind === 'csv') {
    enc = encoding === 'auto' ? detectEncoding(raw.buf, null) : { encoding, source: 'user' };
    const r = csvToPoints(new TextDecoder(enc.encoding).decode(raw.buf), { delimiter, xCol, yCol });
    csvFeatures = r.features;
    warnings.push(...r.warnings);
    csv = { columns: r.columns, xCol: r.xCol, yCol: r.yCol, delimiter: r.delimiter, header: r.header, rows: r.rows, skipped: r.skipped };
  }
  if (raw.kind === 'shp') {
    if (raw.dbfBuf) {
      enc = encoding === 'auto' ? detectEncoding(raw.dbfBuf, raw.cpgText) : { encoding, source: 'user' };
      try {
        props = parseDbf(raw.dbfBuf, enc.encoding);
      } catch (e) {
        warnings.push(`속성(.dbf)을 읽지 못했습니다: ${e.message}`);
      }
    } else {
      warnings.push('.dbf 파일이 없어 속성이 없습니다.');
    }
  }

  let features = csvFeatures ?? rawFeatures(raw, props);
  if (swapXY) features = features.map((f) => ({ ...f, geometry: mapGeometry(f.geometry, (p) => [p[1], p[0], ...p.slice(2)]) }));
  const rawBbox = bboxOf(features.map((f) => f.geometry));
  const swapped = looksSwapped(rawBbox); // swapXY 를 켠 뒤에는 정상으로 보이므로 false 가 된다
  const c = resolveCrs(raw, rawBbox, crs);
  if (c.source === 'guess') warnings.push(`좌표계 정보가 없어 좌표 범위로 ${c.label}(으)로 추정했습니다. 위치가 어긋나 보이면 좌표계를 직접 고르세요.`);
  // X·Y 가 뒤바뀐 자료는 아래 진단이 더 정확히 말하므로 같은 원인의 안내를 겹쳐 내지 않는다
  if (!swapped && c.source === 'default' && rawBbox && !(rawBbox[0] >= -180 && rawBbox[2] <= 180 && rawBbox[1] >= -90 && rawBbox[3] <= 90)) {
    warnings.push('좌표계를 알 수 없고 경위도 범위도 아닙니다. 좌표계를 직접 고르세요.');
  }
  if (c.code === 'EPSG:5186' || c.code === 'EPSG:5185' || c.code === 'EPSG:5187') {
    if (c.source === 'guess') warnings.push('서부·중부·동부원점(5185/5186/5187)은 같은 숫자라도 위치가 다릅니다. 위치를 확인하세요.');
  }

  const sanitized = sanitizeFeatures(features.map((f) => ({ ...f, geometry: mapGeometry(f.geometry, c.convert) })));
  const converted = sanitized.features;
  const { broken } = sanitized;
  // 링크(NetworkLink)만 있는 KML 은 도형 없는 피처가 남을 뿐이다: "도형이 없다"가 아니라 링크를 설명한다
  const linkOnly = raw.networkLinks && converted.length > 0 && converted.every((f) => !f.geometry);
  const empty = linkOnly ? 0 : sanitized.empty;
  if (linkOnly) warnings.push(emptyReason(raw.kind, raw.source, { networkLinks: true }));
  const bbox = bboxOf(converted.map((f) => f.geometry));
  const types = [...new Set(converted.map((f) => f.geometry?.type).filter(Boolean))];
  let center = null;
  let nearKorea = null;
  if (bbox) {
    center = { lon: (bbox[0] + bbox[2]) / 2, lat: (bbox[1] + bbox[3]) / 2 };
    if (!isValidLonLat(center)) {
      if (!swapped) warnings.push(problem('변환한 좌표가 경위도 범위를 벗어났습니다.', '좌표계를 확인하세요. 좌표 숫자가 수십만 단위(미터)라면 한국 좌표계(예: EPSG:5186)를 골라 보세요.'));
    } else {
      nearKorea = isNearKorea(center);
      if (!nearKorea) warnings.push(`변환한 위치(경도 ${center.lon.toFixed(3)}, 위도 ${center.lat.toFixed(3)})가 한국 밖입니다. 해외 자료가 맞다면 그대로 두고, 아니라면 좌표계를 확인하세요.`);
    }
  }
  if (features.length === 0 && !(csv && csv.xCol < 0)) warnings.push(emptyReason(raw.kind, raw.source, { networkLinks: raw.networkLinks })); // CSV 는 좌표 열을 못 찾았다는 안내가 이미 있다
  warnings.push(
    ...dataDiagnostics({
      kind: raw.kind,
      count: converted.length,
      features: converted,
      rawBbox,
      bbox,
      center,
      crs: { code: c.code, source: c.source },
      nearKorea,
      canPickEncoding: raw.kind === 'csv' || Boolean(raw.dbfBuf),
      suggestCrs: !swapped && nearKorea === false && rawBbox ? guessCrs(rawBbox) : null,
      empty,
      broken,
      swapped,
    }),
  );

  return {
    collection: { type: 'FeatureCollection', features: converted },
    info: {
      name: raw.name,
      kind: raw.kind,
      source: raw.source ?? raw.kind,
      csv,
      swapSuspected: swapped || swapXY, // 화면이 "X·Y 순서 바꾸기" 칸을 보일지 정하는 데 쓴다
      emptyCount: empty,
      brokenCount: broken,
      hasHeights: hasHeights({ features: converted }), // 좌표에 높이(세 번째 값)가 있는가 (지도에서 높이를 쓸지 고를 수 있게)
      count: converted.length,
      geometryTypes: types,
      bbox,
      center,
      crs: { code: c.code, label: c.label, source: c.source },
      encoding: enc,
      sampleProperties: converted.find((f) => f.properties && Object.keys(f.properties).length)?.properties ?? null,
      warnings,
    },
  };
}
