/**
 * 끌어놓은 파일 경로들을 "열 수 있는 것"으로 분류한다 (3D Tiles 폴더, glb, 벡터 묶음). DOM·Cesium을 모르는 순수 함수.
 *
 * 경로는 '/'로 구분한 상대 경로. 3D Tiles 폴더 하나만 놓았으면 그 폴더 기준이라 'tileset.json'이 맨 위에 있다.
 *
 *  - 3D Tiles: 이름이 tileset.json 인 파일이 있는 폴더. 다른 tileset.json 안쪽(외부 tileset)은 따로 세지 않는다.
 *    그 폴더 안의 모든 파일(glb, b3dm, json...)은 타일 내용이라 다른 것으로 분류하지 않는다.
 *  - 지형 타일: layer.json 이 있는 폴더 (Cesium quantized-mesh / heightmap 지형 타일). 그 안의 .terrain 등은 모두 이 지형 것이다
 *  - glb: 위 폴더 밖의 .glb
 *  - 벡터: .geojson/.json·.kml·.gpx·.csv·.gpkg (파일 하나가 한 묶음), .shp (같은 폴더·같은 이름의 .dbf/.prj/.cpg/.shx 와 한 묶음), .zip·.kmz (한 묶음)
 *  - 지형(DEM): .tif/.tiff (GeoTIFF), 글자 DEM(.txt/.xyz/.asc: XYZ 점 목록, ASCII 격자). .txt 는 읽어 보기 전에는 DEM인지 모르므로 후보로 올리고 체크 목록에서 뺄 수 있다
 *  - 이미지: .png/.jpg 등 + 같은 이름의 월드파일(.pgw/.jgw/.wld). 위치 정보 파일이 없는 그림은 올릴 곳을 알 수 없어 건너뛴다 (GeoTIFF는 위 지형에서 색 이미지인지 읽어 보고 가른다)
 *  - 스타일: .sld (고른 벡터에 같이 쓴다)
 *  - 나머지(.sbn, .xml, 짝 없는 .dbf 등)는 건너뛴다.
 */

import { worldFileExtensions } from './rasterCore.js';

const baseOf = (p) => p.split('/').pop();
const dirOf = (p) => p.slice(0, p.length - baseOf(p).length); // 끝의 '/' 포함, 맨 위면 ''
const extOf = (p) => {
  const b = baseOf(p);
  return b.includes('.') ? b.split('.').pop().toLowerCase() : '';
};
const stemOf = (p) => {
  const b = baseOf(p);
  const dot = b.lastIndexOf('.');
  return dirOf(p) + (dot < 0 ? b : b.slice(0, dot));
};
const SHP_PARTS = ['shp', 'dbf', 'prj', 'cpg', 'shx'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'bmp'];
const WORLD_EXT = ['pgw', 'pngw', 'jgw', 'jpgw', 'jpegw', 'gfw', 'bpw', 'wld'];

/**
 * @param {string[]} paths
 * @returns {{
 *   tilesets: {root:string, name:string, count:number}[],
 *   terrains: {root:string, name:string, count:number}[],
 *   models: {path:string, label:string}[],
 *   dems: {path:string, label:string}[],
 *   rasters: {label:string, paths:string[]}[],  // [이미지, 월드파일, (있으면) .prj]
 *   vectors: {label:string, kind:'GeoJSON'|'SHP'|'ZIP'|'KML'|'KMZ'|'GPX'|'CSV'|'GPKG', paths:string[]}[],
 *   styles: string[],
 *   ignored: string[],
 * }}
 */
export function classifyDrop(paths) {
  // 3D Tiles 폴더: 얕은 tileset.json부터, 이미 찾은 폴더 안쪽의 것은 건너뛴다
  const dirs = paths
    .filter((p) => baseOf(p).toLowerCase() === 'tileset.json')
    .map(dirOf)
    .sort((a, b) => a.length - b.length);
  const roots = [];
  for (const d of dirs) if (!roots.some((r) => d.startsWith(r))) roots.push(d);

  // Cesium 지형 타일 폴더: layer.json 이 있는 폴더 (3D Tiles 폴더 안쪽은 제외, 중첩된 것은 가장 바깥 하나만)
  const tilesetRoots = [...roots];
  const terrainDirs = paths
    .filter((p) => baseOf(p).toLowerCase() === 'layer.json' && !tilesetRoots.some((r) => p.startsWith(r)))
    .map(dirOf)
    .sort((a, b) => a.length - b.length);
  const terrainRoots = [];
  for (const d of terrainDirs) if (!terrainRoots.some((r) => d.startsWith(r))) terrainRoots.push(d);
  const allRoots = [...tilesetRoots, ...terrainRoots];

  const owner = (p) => allRoots.find((r) => p.startsWith(r));
  const nameOf = (root) => (root ? root.slice(0, -1).split('/').pop() : '');
  const tilesets = tilesetRoots.map((root) => ({ root, name: nameOf(root), count: paths.filter((p) => owner(p) === root).length }));
  const terrains = terrainRoots.map((root) => ({ root, name: nameOf(root), count: paths.filter((p) => owner(p) === root).length }));

  const rest = paths.filter((p) => owner(p) === undefined);
  const used = new Set();
  const models = [];
  const dems = [];
  const vectors = [];
  const rasters = [];
  const styles = [];

  const shpGroups = new Map();
  for (const p of rest) {
    const ext = extOf(p);
    if (ext === 'glb') {
      models.push({ path: p, label: baseOf(p) });
      used.add(p);
    } else if (ext === 'tif' || ext === 'tiff' || ext === 'xyz' || ext === 'asc' || ext === 'txt') {
      dems.push({ path: p, label: baseOf(p) });
      used.add(p);
    } else if (ext === 'geojson' || ext === 'json') {
      vectors.push({ label: baseOf(p), kind: 'GeoJSON', paths: [p] });
      used.add(p);
    } else if (ext === 'zip' || ext === 'kmz' || ext === 'kml' || ext === 'gpx' || ext === 'csv' || ext === 'gpkg') {
      vectors.push({ label: baseOf(p), kind: ext.toUpperCase(), paths: [p] });
      used.add(p);
    } else if (ext === 'sld') {
      styles.push(p);
      used.add(p);
    } else if (IMAGE_EXT.includes(ext) || WORLD_EXT.includes(ext)) {
      // 짝이 맞는지는 아래에서 본다
    } else if (SHP_PARTS.includes(ext)) {
      const key = stemOf(p).toLowerCase();
      if (!shpGroups.has(key)) shpGroups.set(key, { label: baseOf(stemOf(p)), kind: 'SHP', paths: [] });
      shpGroups.get(key).paths.push(p);
    }
  }
  for (const g of shpGroups.values()) {
    if (g.paths.some((p) => extOf(p) === 'shp')) {
      vectors.push(g);
      for (const p of g.paths) used.add(p);
    }
  }
  // 이미지 + 월드파일 (+ 같은 이름의 .prj)
  const lower = new Map(rest.map((p) => [p.toLowerCase(), p]));
  for (const p of rest) {
    if (!IMAGE_EXT.includes(extOf(p))) continue;
    const world = worldFileExtensions(p).map((e) => lower.get(`${stemOf(p)}.${e}`.toLowerCase())).find(Boolean);
    if (!world) continue;
    const prj = lower.get(`${stemOf(p)}.prj`.toLowerCase());
    const paths = [p, world, ...(prj ? [prj] : [])];
    rasters.push({ label: baseOf(p), paths });
    for (const q of paths) used.add(q);
  }
  const ignored = rest.filter((p) => !used.has(p));
  return { tilesets, terrains, models, dems, rasters, vectors, styles, ignored };
}

/** 열 것이 몇 가지 종류인지 (3D Tiles / glb / 벡터 중) */
export function kindCount(plan) {
  return Number(plan.tilesets.length > 0) + Number(plan.terrains.length > 0) + Number(plan.models.length > 0) + Number(plan.dems.length > 0) + Number(plan.rasters.length > 0) + Number(plan.vectors.length > 0);
}

/** 열 수 있는 항목 수 */
export function itemCount(plan) {
  return plan.tilesets.length + plan.terrains.length + plan.models.length + plan.dems.length + plan.rasters.length + plan.vectors.length;
}
