/**
 * GeoPackage 도형 열(GP 머리글 + 표준 이진 도형 WKB)을 GeoJSON 도형으로 바꾼다. DOM·SQLite를 모르는 순수 함수.
 *
 * 형식 (OGC GeoPackage 규격 2.1):
 *   'G' 'P' | 버전 | 플래그 | srs_id(int32) | 범위(0~64바이트, 플래그가 알려 줌) | WKB
 *   플래그: 0비트=머리글 바이트 순서(1이면 little), 1~3비트=범위 종류, 4비트=빈 도형
 * WKB: 바이트 순서 1개 | 종류(uint32) | 내용. 종류는 1 점, 2 선, 3 면, 4~6 멀티, 7 묶음.
 *   Z/M 는 ISO 방식(+1000 Z, +2000 M, +3000 ZM)과 확장 방식(상위 비트 0x80000000 Z, 0x40000000 M) 둘 다 읽는다.
 *   M 값은 지도에 쓸 곳이 없어 버리고, Z(높이)는 세 번째 좌표로 남긴다.
 * 곡선 종류(원호 등)는 읽지 못하고 UnsupportedGeometry 로 알려 준다.
 */

/** 이 형식은 못 읽는 도형 종류 */
export class UnsupportedGeometry extends Error {
  constructor(typeName) {
    super(`지원하지 않는 도형 종류: ${typeName}`);
    this.typeName = typeName;
  }
}

const CURVE_NAMES = { 8: 'CircularString', 9: 'CompoundCurve', 10: 'CurvePolygon', 11: 'MultiCurve', 12: 'MultiSurface', 13: 'Curve', 14: 'Surface', 15: 'PolyhedralSurface', 16: 'TIN', 17: 'Triangle' };
const ENVELOPE_BYTES = [0, 32, 48, 48, 64];

/** 머리글만 읽는다 */
export function readGpkgHeader(bytes) {
  if (!bytes || bytes.length < 8 || bytes[0] !== 0x47 || bytes[1] !== 0x50) throw new Error('GeoPackage 도형 머리글(GP)이 아닙니다');
  const flags = bytes[3];
  const little = (flags & 1) === 1;
  const envelope = (flags >> 1) & 7;
  if (envelope > 4) throw new Error('알 수 없는 범위 종류입니다');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    srsId: view.getInt32(4, little),
    empty: ((flags >> 4) & 1) === 1,
    wkbOffset: 8 + ENVELOPE_BYTES[envelope],
  };
}

/**
 * @param {Uint8Array} bytes 도형 열의 값
 * @returns {{srsId:number, geometry:object|null}} 빈 도형이면 geometry 는 null
 * @throws {UnsupportedGeometry|Error}
 */
export function parseGpkgGeometry(bytes) {
  const h = readGpkgHeader(bytes);
  if (h.empty || h.wkbOffset >= bytes.length) return { srsId: h.srsId, geometry: null };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const r = { view, pos: h.wkbOffset };
  return { srsId: h.srsId, geometry: readWkb(r) };
}

/** WKB 만 (머리글 없이) 읽는다. 시험과 다른 곳에서 쓰기 좋게 따로 둔다 */
export function parseWkb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return readWkb({ view, pos: 0 });
}

function readWkb(r) {
  const { view } = r;
  if (r.pos + 5 > view.byteLength) throw new Error('도형 데이터가 잘렸습니다');
  const little = view.getUint8(r.pos) === 1;
  let type = view.getUint32(r.pos + 1, little);
  r.pos += 5;
  let hasZ = false;
  if (type & 0x80000000) hasZ = true;
  const hasM = Boolean(type & 0x40000000);
  const hasSrid = Boolean(type & 0x20000000);
  type &= 0x0fffffff;
  if (hasSrid) r.pos += 4;
  const iso = Math.floor(type / 1000);
  if (iso === 1 || iso === 3) hasZ = true;
  const isoM = iso === 2 || iso === 3;
  const base = type % 1000;
  const dims = 2 + Number(hasZ) + Number(hasM || isoM);
  const u32 = () => {
    if (r.pos + 4 > view.byteLength) throw new Error('도형 데이터가 잘렸습니다');
    const v = view.getUint32(r.pos, little);
    r.pos += 4;
    return v;
  };
  const point = () => {
    if (r.pos + 8 * dims > view.byteLength) throw new Error('도형 데이터가 잘렸습니다');
    const x = view.getFloat64(r.pos, little);
    const y = view.getFloat64(r.pos + 8, little);
    const z = hasZ ? view.getFloat64(r.pos + 16, little) : null;
    r.pos += 8 * dims;
    return z === null ? [x, y] : [x, y, z];
  };
  const points = () => {
    const n = u32();
    if (r.pos + n * 8 * dims > view.byteLength) throw new Error('도형 데이터가 잘렸습니다');
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = point();
    return out;
  };

  if (base === 1) {
    const c = point();
    // 빈 점(POINT EMPTY)은 좌표가 NaN 으로 저장된다
    return Number.isNaN(c[0]) && Number.isNaN(c[1]) ? null : { type: 'Point', coordinates: c };
  }
  if (base === 2) return { type: 'LineString', coordinates: points() };
  if (base === 3) {
    const n = u32();
    const rings = [];
    for (let i = 0; i < n; i++) rings.push(points());
    return { type: 'Polygon', coordinates: rings };
  }
  if (base >= 4 && base <= 7) {
    const n = u32();
    const parts = [];
    for (let i = 0; i < n; i++) parts.push(readWkb(r));
    if (base === 7) return { type: 'GeometryCollection', geometries: parts.filter(Boolean) };
    const name = base === 4 ? 'MultiPoint' : base === 5 ? 'MultiLineString' : 'MultiPolygon';
    return { type: name, coordinates: parts.filter(Boolean).map((p) => p.coordinates) };
  }
  throw new UnsupportedGeometry(CURVE_NAMES[base] ?? `종류 ${base}`);
}
