// Cesium 지형 타일(quantized-mesh-1.0) 시험용 폴더를 만든다. 서울 시청 부근 가상 언덕(make-sample-dem.mjs 와 같은 지형).
// 실행: node gis/tools/make-sample-terrain-tiles.mjs [--no-gzip]   ->   samples/terrain-tiles/ (layer.json + {z}/{x}/{y}.terrain)
//
//  - 레벨 0~13, 언덕 주변 타일만 만든다 (약 70개). 타일 한 장은 33x33 정점.
//  - 타일 파일은 기본적으로 gzip으로 저장한다 (서버로 서비스하는 Cesium 지형 타일이 보통 그렇다). --no-gzip 이면 그대로.
//  - 법선(octvertexnormals) 확장을 넣어서 `음영`(태양 조명)을 시험할 수 있다.
// 이 인코더는 시험용이다 (실제 지형 제작 도구가 아니다). 높이는 타원체고로 취급한다.
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const OUT = path.join(import.meta.dirname, '..', '..', 'samples', 'terrain-tiles');
const GZIP = !process.argv.includes('--no-gzip');
const N = 33;
const MAX_LEVEL = 13;
const EXTENT = [126.945, 37.535, 127.01, 37.595]; // 서, 남, 동, 북 (도)

const CENTER = { lon: 126.978, lat: 37.5665 };
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = 111_320 * Math.cos((CENTER.lat * Math.PI) / 180);
function terrainHeight(lon, lat) {
  const dx = (lon - CENTER.lon) * M_PER_DEG_LON;
  const dy = (lat - CENTER.lat) * M_PER_DEG_LAT;
  const hill = (cx, cy, h, r) => h * Math.exp(-(((dx - cx) ** 2 + (dy - cy) ** 2) / (r * r)));
  return 20 + 0.01 * dx + hill(0, 0, 120, 600) + hill(-1000, 800, 80, 400);
}

// ---------------------------------------------------------------- 좌표 계산 (WGS84)
const A = 6378137;
const E2 = 0.00669437999014;
const D2R = Math.PI / 180;
function ecef(lonDeg, latDeg, h) {
  const l = lonDeg * D2R;
  const p = latDeg * D2R;
  const n = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
  return [(n + h) * Math.cos(p) * Math.cos(l), (n + h) * Math.cos(p) * Math.sin(l), (n * (1 - E2) + h) * Math.sin(p)];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const B = A * Math.sqrt(1 - E2);
const toScaled = (p) => [p[0] / A, p[1] / A, p[2] / B]; // 타원체 크기로 나눈 공간 (Cesium의 "scaled space")

/** Cesium EllipsoidalOccluder.computeHorizonCullingPoint 와 같은 계산 (타일 전체가 보이는 한 점) */
function horizonOcclusionPoint(centerEcef, vertsEcef) {
  const d = scale(toScaled(centerEcef), 1 / len(toScaled(centerEcef)));
  let best = 0;
  for (const p of vertsEcef) {
    const s = toScaled(p);
    let m2 = dot(s, s);
    let m = Math.sqrt(m2);
    const dir = scale(s, 1 / m);
    m2 = Math.max(1, m2);
    m = Math.max(1, m);
    const cosA = dot(dir, d);
    const sinA = len(cross(dir, d));
    const cosB = 1 / m;
    const sinB = Math.sqrt(m2 - 1) * cosB;
    best = Math.max(best, 1 / (cosA * cosB - sinA * sinB));
  }
  return scale(d, best);
}

// ---------------------------------------------------------------- quantized-mesh 인코딩
const zigzag = (v) => (v << 1) ^ (v >> 31);

function octEncode(n) {
  const l1 = Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]);
  let x = n[0] / l1;
  let y = n[1] / l1;
  if (n[2] < 0) {
    const nx = (1 - Math.abs(y)) * (x >= 0 ? 1 : -1);
    const ny = (1 - Math.abs(x)) * (y >= 0 ? 1 : -1);
    x = nx;
    y = ny;
  }
  return [Math.round((x * 0.5 + 0.5) * 255), Math.round((y * 0.5 + 0.5) * 255)];
}

function encodeTile(z, tx, ty) {
  const deg = 180 / 2 ** z;
  const west = -180 + tx * deg;
  const south = -90 + ty * deg;
  const lon = (i) => west + (i / (N - 1)) * deg;
  const lat = (j) => south + (j / (N - 1)) * deg;
  const heights = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) heights.push(terrainHeight(lon(i), lat(j)));
  const minH = Math.min(...heights);
  const maxH = Math.max(...heights);
  const q = (h) => (maxH > minH ? Math.round(((h - minH) / (maxH - minH)) * 32767) : 0);

  const verts = [];
  const normals = [];
  const eps = deg / (N - 1) / 2;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const h = heights[j * N + i];
      verts.push({ u: Math.round((i / (N - 1)) * 32767), v: Math.round((j / (N - 1)) * 32767), h: q(h), pos: ecef(lon(i), lat(j), h) });
      // 법선: 높이 기울기로 지역(동북위) 법선을 구해 지구 중심 좌표계로
      const dzdx = (terrainHeight(lon(i) + eps, lat(j)) - terrainHeight(lon(i) - eps, lat(j))) / (2 * eps * M_PER_DEG_LON);
      const dzdy = (terrainHeight(lon(i), lat(j) + eps) - terrainHeight(lon(i), lat(j) - eps)) / (2 * eps * M_PER_DEG_LAT);
      const nl = Math.hypot(dzdx, dzdy, 1);
      const [lx, ly, lz] = [-dzdx / nl, -dzdy / nl, 1 / nl];
      const l = lon(i) * D2R;
      const p = lat(j) * D2R;
      const east = [-Math.sin(l), Math.cos(l), 0];
      const north = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)];
      const up = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
      normals.push(octEncode([0, 1, 2].map((k) => east[k] * lx + north[k] * ly + up[k] * lz)));
    }
  }

  // 정점 -> 삼각형 (남서, 남동, 북서) (남동, 북동, 북서)
  const tri = [];
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const v00 = j * N + i;
      const v10 = v00 + 1;
      const v01 = v00 + N;
      const v11 = v01 + 1;
      tri.push(v00, v10, v01, v10, v11, v01);
    }
  }
  // 최고점(high water mark) 인코딩
  let highest = 0;
  const encodedIdx = tri.map((idx) => {
    const code = highest - idx;
    if (code === 0) highest++;
    return code;
  });
  const sortBy = (arr, key) => arr.sort((a, b) => verts[a][key] - verts[b][key]);
  const all = verts.map((_, i) => i);
  const west_ = sortBy(all.filter((i) => verts[i].u === 0), 'v');
  const south_ = sortBy(all.filter((i) => verts[i].v === 0), 'u');
  const east_ = sortBy(all.filter((i) => verts[i].u === 32767), 'v');
  const north_ = sortBy(all.filter((i) => verts[i].v === 32767), 'u');

  const centerLon = west + deg / 2;
  const centerLat = south + deg / 2;
  const center = ecef(centerLon, centerLat, (minH + maxH) / 2);
  const radius = Math.max(...verts.map((v) => len(sub(v.pos, center))));
  const horizon = horizonOcclusionPoint(center, verts.map((v) => v.pos));

  const vc = verts.length;
  const size = 88 + 4 + vc * 6 + 4 + encodedIdx.length * 2 + 4 * 4 + (west_.length + south_.length + east_.length + north_.length) * 2 + 1 + 4 + vc * 2;
  const buf = Buffer.alloc(size);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 0;
  const f64 = (v) => { dv.setFloat64(o, v, true); o += 8; };
  const f32 = (v) => { dv.setFloat32(o, v, true); o += 4; };
  const u32 = (v) => { dv.setUint32(o, v, true); o += 4; };
  const u16 = (v) => { dv.setUint16(o, v, true); o += 2; };
  center.forEach(f64);
  f32(minH);
  f32(maxH);
  center.forEach(f64);
  f64(radius);
  horizon.forEach(f64);
  u32(vc);
  for (const key of ['u', 'v', 'h']) {
    let prev = 0;
    for (const vtx of verts) {
      u16(zigzag(vtx[key] - prev));
      prev = vtx[key];
    }
  }
  u32(tri.length / 3);
  encodedIdx.forEach(u16);
  for (const edge of [west_, south_, east_, north_]) {
    u32(edge.length);
    edge.forEach(u16);
  }
  dv.setUint8(o, 1); // 확장 1 = octvertexnormals
  o += 1;
  u32(vc * 2);
  for (const nrm of normals) {
    dv.setUint8(o++, nrm[0]);
    dv.setUint8(o++, nrm[1]);
  }
  if (o !== size) throw new Error(`크기 계산 오류: ${o} != ${size}`);
  return buf;
}

// ---------------------------------------------------------------- 폴더 쓰기
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const available = [];
let count = 0;
for (let z = 0; z <= MAX_LEVEL; z++) {
  const deg = 180 / 2 ** z;
  const x0 = Math.floor((EXTENT[0] + 180) / deg);
  const x1 = Math.floor((EXTENT[2] + 180) / deg);
  const y0 = Math.floor((EXTENT[1] + 90) / deg);
  const y1 = Math.floor((EXTENT[3] + 90) / deg);
  available.push([{ startX: x0, endX: x1, startY: y0, endY: y1 }]);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const dir = path.join(OUT, String(z), String(x));
      fs.mkdirSync(dir, { recursive: true });
      const bytes = encodeTile(z, x, y);
      fs.writeFileSync(path.join(dir, `${y}.terrain`), GZIP ? gzipSync(bytes) : bytes);
      count++;
    }
  }
}
fs.writeFileSync(
  path.join(OUT, 'layer.json'),
  JSON.stringify(
    {
      tilejson: '2.1.0',
      name: 'sample-hill',
      description: '시험용 가상 언덕 지형 (서울 시청 부근)',
      version: '1.0.0',
      format: 'quantized-mesh-1.0',
      attribution: '',
      scheme: 'tms',
      tiles: ['{z}/{x}/{y}.terrain?v={version}'],
      projection: 'EPSG:4326',
      bounds: EXTENT,
      minzoom: 0,
      maxzoom: MAX_LEVEL,
      extensions: ['octvertexnormals'],
      available,
    },
    null,
    2,
  ),
);
console.log(`만들었습니다: ${OUT} (타일 ${count}개, ${GZIP ? 'gzip' : '압축 없음'})`);
