import { computeTileRange } from '../layers/tileMath.js';

/**
 * 배경 지도(래스터 타일) 공급자. 전부 Web Mercator(EPSG:3857) XYZ 타일 규격이다.
 *
 *  - osm: 키 없이 바로 쓸 수 있다. 공개 서버라 이용 정책이 있다 (많은 타일을 계속 받는 용도는 금지, 출처 표시 필수).
 *  - vworld-*: 국토교통부 브이월드. 발급받은 API 키가 필요하고, 키는 허용 도메인이 등록된 곳에서만 동작한다.
 *    WMTS 주소의 순서가 z/y/x 라는 점이 XYZ({z}/{x}/{y})와 다르다.
 *
 * 국토지리정보원(NGII) 바로e맵은 EPSG:5179 전용 타일 격자라 이 구조에 맞지 않아 지원하지 않는다.
 *
 * @typedef {{ urlTemplate: string, maxZoom: number, attribution: string }} ResolvedProvider
 */
export const PROVIDERS = {
  osm: {
    label: 'OpenStreetMap',
    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors',
    needsKey: false,
  },
  'vworld-base': {
    label: 'VWorld 일반지도',
    urlTemplate: 'https://api.vworld.kr/req/wmts/1.0.0/{key}/Base/{z}/{y}/{x}.png',
    maxZoom: 19,
    attribution: '© VWorld (국토교통부)',
    needsKey: true,
  },
  'vworld-satellite': {
    label: 'VWorld 위성영상',
    urlTemplate: 'https://api.vworld.kr/req/wmts/1.0.0/{key}/Satellite/{z}/{y}/{x}.jpeg',
    maxZoom: 19,
    attribution: '© VWorld (국토교통부)',
    needsKey: true,
  },
};

/**
 * @param {string|{urlTemplate:string, maxZoom?:number, attribution?:string}} spec 공급자 이름 또는 직접 만든 정의
 * @param {string} [apiKey] {key} 자리에 들어간다
 * @returns {ResolvedProvider}
 */
export function resolveProvider(spec, apiKey = '') {
  const def = typeof spec === 'string' ? PROVIDERS[spec] : spec;
  if (!def || !def.urlTemplate) throw new Error(`알 수 없는 배경 지도 공급자: ${typeof spec === 'string' ? spec : '(urlTemplate 없음)'}`);
  if (def.urlTemplate.includes('{key}') && !apiKey) {
    throw new Error(`${def.label ?? '이 배경 지도'}는 API 키가 필요합니다.`);
  }
  return {
    urlTemplate: def.urlTemplate.replace('{key}', encodeURIComponent(apiKey)),
    maxZoom: def.maxZoom ?? 19,
    attribution: def.attribution ?? '',
  };
}

/** @param {string} template @param {{z:number,x:number,y:number}} tile */
export function tileUrl(template, tile) {
  return template.replace('{z}', String(tile.z)).replace('{x}', String(tile.x)).replace('{y}', String(tile.y));
}

/**
 * 영역을 덮는 타일 수가 maxTiles 이하인 범위에서 가장 높은(선명한) 줌을 고른다.
 * 너무 넓은 영역은 최소 줌으로 내려가 타일 수가 maxTiles를 넘을 수 있다.
 * @param {{west:number,south:number,east:number,north:number}} bbox
 * @param {{maxTiles?:number, minZoom?:number, maxZoom?:number}} [opts]
 * @returns {{zoom:number, count:number}}
 */
export function chooseZoom(bbox, { maxTiles = 256, minZoom = 1, maxZoom = 19 } = {}) {
  let last = { zoom: minZoom, count: Infinity };
  for (let z = maxZoom; z >= minZoom; z--) {
    const r = computeTileRange(bbox, z);
    const count = (r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1);
    last = { zoom: z, count };
    if (count <= maxTiles) return last;
  }
  return last;
}

/**
 * 위경도 점들을 감싸는 bbox. 가장자리에 여유(padRatio)를 더해, 타일셋 가장자리 밖에도 지도가 조금 보이게 한다.
 * @param {Array<{lon:number, lat:number}>} points
 * @param {number} [padRatio=0.1]
 */
export function bboxFromPoints(points, padRatio = 0.1) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const p of points) {
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
  }
  const padLon = Math.max((east - west) * padRatio, 1e-4);
  const padLat = Math.max((north - south) * padRatio, 1e-4);
  return {
    west: Math.max(west - padLon, -180),
    east: Math.min(east + padLon, 180),
    south: Math.max(south - padLat, -85),
    north: Math.min(north + padLat, 85),
  };
}
