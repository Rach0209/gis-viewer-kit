/**
 * 열어 본 자료를 파일로 내려받거나 좌표를 복사하는 데 쓰는 순수 함수 (DOM·Cesium 비의존).
 *  - 벡터 레이어(WGS84 FeatureCollection) -> GeoJSON 글자, CSV 글자 (좌표계를 골라 그 좌표로)
 *  - glb 모델 위치 -> 고른 좌표계의 X/Y, 높이, 방향 (복사·내려받기용)
 */
import { fromLonLat, getCrs, toLonLat } from '../../viewer/src/kit/crsList.js';

const round = (v, digits) => (Number.isFinite(v) ? Number(v.toFixed(digits)) : v);

/** 좌표 하나를 고른 좌표계로. 경위도(4326)면 그대로. 높이 같은 세 번째 값은 유지 */
function convertPosition(code) {
  if (code === 'EPSG:4326') return (c) => c;
  return (c) => {
    const { x, y } = fromLonLat(code, c[0], c[1]);
    return c.length > 2 ? [x, y, ...c.slice(2)] : [x, y];
  };
}

function mapCoords(coords, fn) {
  return typeof coords[0] === 'number' ? fn(coords) : coords.map((c) => mapCoords(c, fn));
}

export function convertGeometry(g, fn) {
  if (!g) return g;
  if (g.type === 'GeometryCollection') return { ...g, geometries: g.geometries.map((x) => convertGeometry(x, fn)) };
  return { ...g, coordinates: mapCoords(g.coordinates, fn) };
}

/** 좌표계 코드 -> GeoJSON(옛 규격) crs 이름. EPSG 번호가 아니면 null */
function crsMember(code) {
  const m = /^EPSG:(\d+)$/.exec(code);
  return m ? { type: 'name', properties: { name: `urn:ogc:def:crs:EPSG::${m[1]}` } } : null;
}

/**
 * GeoJSON 글자. 기본은 WGS84(표준). 다른 좌표계를 고르면 좌표를 바꾸고 옛 규격의 crs 항목을 붙인다 (QGIS·ArcGIS가 읽는다).
 * @param {{type:'FeatureCollection', features:object[]}} collection WGS84
 * @param {{crs?:string, pretty?:boolean}} [o]
 */
export function toGeoJsonText(collection, { crs = 'EPSG:4326', pretty = false } = {}) {
  getCrs(crs); // 모르는 좌표계면 여기서 오류
  const fn = convertPosition(crs);
  const features = crs === 'EPSG:4326' ? collection.features : collection.features.map((f) => ({ ...f, geometry: convertGeometry(f.geometry, fn) }));
  const out = { type: 'FeatureCollection' };
  const member = crs === 'EPSG:4326' ? null : crsMember(crs);
  if (member) out.crs = member;
  out.features = features;
  return JSON.stringify(out, null, pretty ? 2 : undefined);
}

const num = (v) => String(round(v, 9));

/** WKT: 좌표는 "x y" (높이는 뺀다) */
export function geometryToWkt(g) {
  if (!g) return '';
  const pt = (c) => `${num(c[0])} ${num(c[1])}`;
  const ring = (r) => `(${r.map(pt).join(', ')})`;
  switch (g.type) {
    case 'Point':
      return `POINT (${pt(g.coordinates)})`;
    case 'MultiPoint':
      return `MULTIPOINT (${g.coordinates.map((c) => `(${pt(c)})`).join(', ')})`;
    case 'LineString':
      return `LINESTRING ${ring(g.coordinates)}`;
    case 'MultiLineString':
      return `MULTILINESTRING (${g.coordinates.map(ring).join(', ')})`;
    case 'Polygon':
      return `POLYGON (${g.coordinates.map(ring).join(', ')})`;
    case 'MultiPolygon':
      return `MULTIPOLYGON (${g.coordinates.map((p) => `(${p.map(ring).join(', ')})`).join(', ')})`;
    case 'GeometryCollection':
      return `GEOMETRYCOLLECTION (${g.geometries.map(geometryToWkt).join(', ')})`;
    default:
      return '';
  }
}

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * CSV 글자 (엑셀에서 한글이 깨지지 않도록 UTF-8 BOM 을 앞에 붙인다).
 *  - 점만 있으면: 경도, 위도 (+ 다른 좌표계면 X, Y) + 속성
 *  - 선·면이 섞여 있으면: WKT 열 + 속성 (WKT 좌표는 고른 좌표계)
 * @param {{features:object[]}} collection WGS84
 * @param {{crs?:string, bom?:boolean}} [o]
 */
export function toCsvText(collection, { crs = 'EPSG:4326', bom = true } = {}) {
  getCrs(crs);
  const fs = collection.features;
  const keys = [];
  const seen = new Set();
  for (const f of fs) for (const k of Object.keys(f.properties ?? {})) if (!seen.has(k)) (seen.add(k), keys.push(k));
  const pointsOnly = fs.length > 0 && fs.every((f) => f.geometry?.type === 'Point');
  const info = getCrs(crs);
  const head = pointsOnly ? ['경도', '위도', ...(crs === 'EPSG:4326' ? [] : [`X(${crs})`, `Y(${crs})`])] : [`WKT${crs === 'EPSG:4326' ? '' : `(${crs})`}`];
  const lines = [[...head, ...keys].map(csvCell).join(',')];
  const fn = convertPosition(crs);
  for (const f of fs) {
    const cells = [];
    if (pointsOnly) {
      const [lon, lat] = f.geometry.coordinates;
      cells.push(round(lon, 9), round(lat, 9));
      if (crs !== 'EPSG:4326') {
        const [x, y] = fn([lon, lat]);
        cells.push(round(x, info.geographic ? 9 : 3), round(y, info.geographic ? 9 : 3));
      }
    } else {
      cells.push(geometryToWkt(crs === 'EPSG:4326' ? f.geometry : convertGeometry(f.geometry, fn)));
    }
    for (const k of keys) cells.push(f.properties?.[k]);
    lines.push(cells.map(csvCell).join(','));
  }
  return (bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}

/** 파일 이름으로 쓸 수 없는 글자를 바꾼다 */
export function safeFileName(name, ext) {
  const stem = String(name ?? 'data')
    .replace(/\.[A-Za-z0-9]{1,6}$/, '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .trim();
  return `${stem || 'data'}.${ext}`;
}

/**
 * glb 모델 위치를 고른 좌표계로 풀어 쓴다 (복사·저장용).
 * @param {{lon:number, lat:number, height?:number, headingDeg?:number, pitchDeg?:number, rollDeg?:number, scale?:number, upAxis?:string}} meta
 * @param {string} crs
 */
export function describePlacement(meta, crs = 'EPSG:4326') {
  const info = getCrs(crs);
  const { x, y } = fromLonLat(crs, meta.lon, meta.lat);
  const digits = info.geographic ? 9 : 3;
  const place = {
    crs,
    x: round(x, digits),
    y: round(y, digits),
    height: round(meta.height ?? 0, 3),
    headingDeg: meta.headingDeg ?? 0,
    pitchDeg: meta.pitchDeg ?? 0,
    rollDeg: meta.rollDeg ?? 0,
    scale: meta.scale ?? 1,
    upAxis: meta.upAxis ?? 'Y',
    lon: round(meta.lon, 9),
    lat: round(meta.lat, 9),
  };
  const text = `${info.xLabel}: ${place.x}\n${info.yLabel}: ${place.y}\n높이(타원체, m): ${place.height}\n방향(°): ${place.headingDeg}  앞뒤(°): ${place.pitchDeg}  좌우(°): ${place.rollDeg}\n크기 배율: ${place.scale}  위쪽 축: ${place.upAxis}\n경도, 위도: ${place.lon}, ${place.lat}`;
  return { place, text, json: JSON.stringify(place, null, 2), xyText: `${place.x}, ${place.y}` };
}

/** 위치 JSON(내려받은 것)에서 경위도를 되읽는다 (다른 좌표계로 저장했어도) */
export function lonLatOfPlacement(place) {
  if (Number.isFinite(place.lon) && Number.isFinite(place.lat)) return { lon: place.lon, lat: place.lat };
  return toLonLat(place.crs, place.x, place.y);
}
