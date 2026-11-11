/**
 * 지도에 올릴 때 좌표의 높이(세 번째 값)를 떼어 낸 FeatureCollection 사본을 만든다. DOM·Cesium을 모르는 순수 함수.
 *
 * 이 앱은 벡터를 늘 지면에 붙여 그린다. 그런데 Cesium(GeoJsonDataSource)은 좌표에 높이가 있으면 "그 높이를 쓰라"는 뜻으로 보고,
 * 핀을 땅에 붙이지 않고 면을 지면에 붙이지 않는다 (KML·GPX·3차원 SHP/GeoJSON 이 흔히 높이를 담는다).
 * 그러면 높이 0 인 핀이 지구 표면에 절반쯤 파묻히고, 높이 0 인 면은 표면과 겹쳐 깜빡인다. 높이를 떼어 내면 모두 지면에 붙는다.
 * 저장(내려받기)에는 원본 collection 을 그대로 쓰므로 높이(GPS 고도 등)는 잃지 않는다.
 */

function flatCoords(coords) {
  if (typeof coords[0] === 'number') return coords.length > 2 ? [coords[0], coords[1]] : coords;
  return coords.map(flatCoords);
}

function flatGeometry(g) {
  if (!g) return g;
  if (g.type === 'GeometryCollection') return { ...g, geometries: g.geometries.map(flatGeometry) };
  return { ...g, coordinates: flatCoords(g.coordinates) };
}

/** 어떤 좌표든 높이가 있는가 (없으면 사본을 만들 필요가 없다) */
export function hasHeights(collection) {
  const check = (c) => (typeof c[0] === 'number' ? c.length > 2 : c.some(check));
  const geom = (g) => (!g ? false : g.type === 'GeometryCollection' ? g.geometries.some(geom) : check(g.coordinates));
  return collection.features.some((f) => geom(f.geometry));
}

/**
 * 높이가 있는 좌표에 offset(m)을 더한 사본. 높이가 없는 좌표는 그대로 둔다 (높이를 새로 만들지 않는다).
 * 구글어스·GPS 의 높이는 보통 해수면 기준 표고인데 지도(Cesium)는 타원체고라서, 한국에서는 약 25~30 m 더해 주면 맞는다.
 */
export function shiftHeights(collection, offset) {
  if (!offset || !hasHeights(collection)) return collection;
  const shift = (coords) => (typeof coords[0] === 'number' ? (coords.length > 2 ? [coords[0], coords[1], coords[2] + offset, ...coords.slice(3)] : coords) : coords.map(shift));
  const geom = (g) => (!g ? g : g.type === 'GeometryCollection' ? { ...g, geometries: g.geometries.map(geom) } : { ...g, coordinates: shift(g.coordinates) });
  return { ...collection, features: collection.features.map((f) => ({ ...f, geometry: geom(f.geometry) })) };
}

/** @returns {object} 높이가 없으면 같은 객체를, 있으면 높이를 뗀 사본을 돌려준다 (원본은 바꾸지 않는다) */
export function stripHeights(collection) {
  if (!hasHeights(collection)) return collection;
  return { ...collection, features: collection.features.map((f) => ({ ...f, geometry: flatGeometry(f.geometry) })) };
}
