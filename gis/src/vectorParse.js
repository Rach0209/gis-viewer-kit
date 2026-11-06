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
import { CRS_LIST, getCrs, isNearKorea, isValidLonLat } from '../../viewer/src/kit/crsList.js';

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
const VECTOR_EXT = /\.(shp|dbf|prj|cpg|shx|geojson|json|zip|sld)$/i;
export const isVectorFileName = (name) => VECTOR_EXT.test(name);

const baseOf = (path) => path.split('/').pop();
const extOf = (path) => (baseOf(path).includes('.') ? baseOf(path).split('.').pop().toLowerCase() : '');
const stemOf = (path) => {
  const b = baseOf(path);
  const dot = b.lastIndexOf('.');
  const dir = path.slice(0, path.length - b.length);
  return dir + (dot < 0 ? b : b.slice(0, dot));
};

const toArrayBuffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

/** 파일들(File 또는 같은 모양의 객체)과 ZIP 안의 파일을 한 목록으로 편다. */
async function expandEntries(files) {
  /** @type {{path:string, read:()=>Promise<ArrayBuffer>}[]} */
  const out = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      for (const e of iter(bytes)) {
        const name = String(e.filename).split(String.fromCharCode(92)).join('/');
        if (name.endsWith('/') || name.startsWith('__MACOSX/') || baseOf(name).startsWith('.')) continue;
        out.push({ path: name, read: async () => toArrayBuffer(await e.read()) });
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
export async function readRaw(group) {
  if (group.kind === 'geojson') {
    let geojson;
    try {
      geojson = JSON.parse(decodeText(await group.parts.geojson.read()));
    } catch (e) {
      throw new Error(`${group.name}: GeoJSON을 읽을 수 없습니다 (${e.message})`);
    }
    return { kind: 'geojson', name: group.name, geojson, dbfBuf: null, prjText: null, cpgText: null };
  }
  let geoms;
  try {
    geoms = parseShp(await group.parts.shp.read());
  } catch (e) {
    throw new Error(`${group.name}: SHP를 읽을 수 없습니다 (${e.message})`);
  }
  return {
    kind: 'shp',
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
    return { convert: (c) => [...t.forward([c[0], c[1]]), ...c.slice(2)], code, label, source };
  };
  const fromCode = (code, source) => {
    if (code === 'EPSG:4326') return identity(code, getCrs(code).label, source);
    const info = CRS_LIST.find((c) => c.code === code);
    if (!info?.def) throw new Error(`지원하지 않는 좌표계입니다: ${code}`);
    return fromDef(info.def, code, info.label, source);
  };

  if (choice && choice !== 'auto') return fromCode(choice, 'user');

  if (raw.kind === 'shp' && raw.prjText) {
    try {
      return fromDef(raw.prjText, null, `.prj: ${projName(raw.prjText) ?? '정의 있음'}`, 'prj');
    } catch {
      /* .prj를 해석할 수 없으면 추정으로 넘어간다 */
    }
  }
  if (raw.kind === 'geojson') {
    const code = epsgFromGeoJsonCrs(raw.geojson);
    if (code && (code === 'EPSG:4326' || CRS_LIST.some((c) => c.code === code))) return fromCode(code, 'geojson-crs');
  }
  const g = guessCrs(bbox);
  if (g) return fromCode(g, g === 'EPSG:4326' && raw.kind === 'geojson' ? 'default' : 'guess');
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
 * @param {{encoding?:string, crs?:string}} [opts] encoding: 'auto' | 'utf-8' | 'euc-kr' | ..., crs: 'auto' | 'EPSG:xxxx'
 * @returns {{collection:object, info:object}}
 */
export function buildCollection(raw, { encoding = 'auto', crs = 'auto' } = {}) {
  const warnings = [];

  // 속성 (SHP만 DBF가 따로 있다)
  let enc = null;
  let props = null;
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

  const features = rawFeatures(raw, props);
  const rawBbox = bboxOf(features.map((f) => f.geometry));
  const c = resolveCrs(raw, rawBbox, crs);
  if (c.source === 'guess') warnings.push(`좌표계 정보(.prj)가 없어 좌표 범위로 ${c.label}(으)로 추정했습니다. 위치가 어긋나 보이면 좌표계를 직접 고르세요.`);
  if (c.source === 'default' && rawBbox && !(rawBbox[0] >= -180 && rawBbox[2] <= 180 && rawBbox[1] >= -90 && rawBbox[3] <= 90)) {
    warnings.push('좌표계를 알 수 없고 경위도 범위도 아닙니다. 좌표계를 직접 고르세요.');
  }
  if (c.code === 'EPSG:5186' || c.code === 'EPSG:5185' || c.code === 'EPSG:5187') {
    if (c.source === 'guess') warnings.push('서부·중부·동부원점(5185/5186/5187)은 같은 숫자라도 위치가 다릅니다. 위치를 확인하세요.');
  }

  const converted = features.map((f) => ({ ...f, geometry: mapGeometry(f.geometry, c.convert) }));
  const bbox = bboxOf(converted.map((f) => f.geometry));
  const types = [...new Set(converted.map((f) => f.geometry?.type).filter(Boolean))];
  let center = null;
  if (bbox) {
    center = { lon: (bbox[0] + bbox[2]) / 2, lat: (bbox[1] + bbox[3]) / 2 };
    if (!isValidLonLat(center)) warnings.push('변환한 좌표가 경위도 범위를 벗어났습니다. 좌표계를 확인하세요.');
    else if (!isNearKorea(center)) warnings.push(`변환한 위치(경도 ${center.lon.toFixed(3)}, 위도 ${center.lat.toFixed(3)})가 한국 주변이 아닙니다. 좌표계가 맞는지 확인하세요.`);
  }
  if (features.length === 0) warnings.push('피처가 없습니다.');

  return {
    collection: { type: 'FeatureCollection', features: converted },
    info: {
      name: raw.name,
      kind: raw.kind,
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
