/**
 * Cesium 지형 타일 폴더(layer.json + {z}/{x}/{y}.terrain)를 다루는 순수 함수 (Cesium·DOM을 모른다).
 * 형식은 Cesium의 quantized-mesh-1.0 / heightmap-1.0 이고, 옛 Cesium으로 만든 타일도 같은 형식이다.
 */

/** 폴더 안에서 layer.json 을 찾는다. 여러 개면 가장 얕은 것. @param {Iterable<string>} keys */
export function findLayerJson(keys) {
  return [...keys]
    .filter((k) => /(^|\/)layer\.json$/i.test(k))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
}

/** layer.json 의 폴더 경로 ('a/b/layer.json' -> 'a/b', 맨 위면 '') */
export function dirOfEntry(entry) {
  const i = entry.lastIndexOf('/');
  return i < 0 ? '' : entry.slice(0, i);
}

const validBounds = (b) =>
  Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && Math.abs(b[0]) <= 180 && Math.abs(b[2]) <= 180 && Math.abs(b[1]) <= 90 && Math.abs(b[3]) <= 90 && b[0] < b[2] && b[1] < b[3];

/**
 * layer.json 의 `available`(레벨마다 있는 타일의 x/y 범위)에서 실제 타일이 있는 지역을 구한다 (도, [서, 남, 동, 북]).
 * `bounds` 를 대충 적어 둔 자료(예: 동반구 전체 [0,-90,180,90])가 있어서, 이동할 곳은 실제 타일이 있는 지역을 쓴다.
 * EPSG:4326 지형(레벨 0 타일이 경도 180도 두 장)만 지원하고, 아니면 null.
 * @param {any} json
 */
export function extentFromAvailable(json) {
  const avail = json?.available;
  if (!Array.isArray(avail) || (json.projection && json.projection !== 'EPSG:4326')) return null;
  const flip = json.scheme === 'slippyMap'; // y가 북쪽부터 (기본 tms는 남쪽부터)
  for (let level = avail.length - 1; level >= 0; level--) {
    const ranges = Array.isArray(avail[level]) ? avail[level].filter((r) => [r?.startX, r?.endX, r?.startY, r?.endY].every(Number.isFinite)) : [];
    if (!ranges.length) continue;
    const deg = 180 / 2 ** level;
    const x0 = Math.min(...ranges.map((r) => r.startX));
    const x1 = Math.max(...ranges.map((r) => r.endX));
    const y0 = Math.min(...ranges.map((r) => r.startY));
    const y1 = Math.max(...ranges.map((r) => r.endY));
    const west = -180 + x0 * deg;
    const east = -180 + (x1 + 1) * deg;
    const south = flip ? 90 - (y1 + 1) * deg : -90 + y0 * deg;
    const north = flip ? 90 - y0 * deg : -90 + (y1 + 1) * deg;
    const ext = [west, south, east, north];
    return validBounds(ext) ? ext : null;
  }
  return null;
}

/**
 * layer.json 내용을 화면에 보여 줄 요약으로.
 * @param {any} json
 */
export function summarizeLayerJson(json) {
  const j = json && typeof json === 'object' ? json : {};
  const available = Array.isArray(j.available) ? j.available : null;
  return {
    name: typeof j.name === 'string' ? j.name : '',
    description: typeof j.description === 'string' ? j.description : '',
    format: typeof j.format === 'string' ? j.format : '',
    version: typeof j.version === 'string' ? j.version : '',
    scheme: typeof j.scheme === 'string' ? j.scheme : 'tms',
    projection: typeof j.projection === 'string' ? j.projection : 'EPSG:4326',
    attribution: typeof j.attribution === 'string' ? j.attribution : '',
    minzoom: Number.isFinite(j.minzoom) ? j.minzoom : null,
    maxzoom: Number.isFinite(j.maxzoom) ? j.maxzoom : available ? Math.max(0, available.length - 1) : null,
    bounds: validBounds(j.bounds) ? j.bounds : null, // layer.json 에 적힌 범위 [west, south, east, north] 도 (대충 적힌 경우가 있다)
    extent: extentFromAvailable(j) ?? (validBounds(j.bounds) ? j.bounds : null), // 이동·표시에 쓰는 범위: 실제 타일이 있는 지역, 없으면 bounds
    extensions: Array.isArray(j.extensions) ? j.extensions.map(String) : [],
    tiles: Array.isArray(j.tiles) ? j.tiles.map(String) : [],
  };
}

/** 지형 타일 레이어 정보 [이름, 값] */
export function terrainTilesInfoRows({ summary, fileCount, hasNormals, hasWaterMask }) {
  const s = summary;
  const rows = [];
  if (s.name) rows.push(['이름', s.name]);
  rows.push(['형식', `${s.format || '(알 수 없음)'}${s.version ? ` · 버전 ${s.version}` : ''}`]);
  if (s.minzoom != null || s.maxzoom != null) rows.push(['레벨', `${s.minzoom ?? 0} ~ ${s.maxzoom ?? '?'}`]);
  rows.push(['투영·방식', `${s.projection} · ${s.scheme}`]);
  const fmt = (b) => `경도 ${b[0].toFixed(4)} ~ ${b[2].toFixed(4)}, 위도 ${b[1].toFixed(4)} ~ ${b[3].toFixed(4)}`;
  if (s.extent) rows.push(['범위(타일이 있는 곳)', fmt(s.extent)]);
  else rows.push(['범위', 'layer.json에 bounds/available가 없어 알 수 없습니다 (이동 버튼이 동작하지 않을 수 있음)']);
  if (s.bounds && s.extent && s.extent !== s.bounds) {
    const w = (b) => (b[2] - b[0]) * (b[3] - b[1]);
    if (w(s.bounds) > w(s.extent) * 4) rows.push(['layer.json bounds', `${fmt(s.bounds)} — 실제 타일 범위보다 훨씬 넓게 적혀 있어 쓰지 않았습니다`]);
  }
  if (fileCount != null) rows.push(['폴더 안 파일', `${fileCount.toLocaleString('ko-KR')}개`]);
  rows.push(['확장', s.extensions.length ? s.extensions.join(', ') : '없음']);
  rows.push(['법선(음영용)', hasNormals ? '있음' : '없음']);
  if (hasWaterMask) rows.push(['물 마스크', '있음']);
  if (s.attribution) rows.push(['출처', s.attribution]);
  if (s.description) rows.push(['설명', s.description]);
  return rows;
}
