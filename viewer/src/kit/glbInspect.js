import * as THREE from 'three';
import { EXT, readGlbHeader } from './inspectContent.js';

/**
 * 단독 glb 파일을 "화면에 올리기 전에" 훑어서 알려 줄 수 있는 것을 구한다 (메시를 실제로 만들지 않는다).
 * glb의 JSON 청크만 읽으므로 파일이 커도 빠르다.
 *
 *  - 압축 확장(Draco/KTX2/Meshopt), 메시/재질/텍스처 개수, 삼각형 수
 *  - 범위(bounds): 장면의 노드 변환을 적용한 POSITION 접근자의 min/max (glTF 규격상 POSITION의 min/max는 필수)
 *  - 좌표 자동 판별 후보:
 *      'rtc'  : CESIUM_RTC 확장의 center(ECEF 좌표)가 있다 -> 모델의 원점이 그 위치
 *      'ecef' : 정점 좌표 자체가 지구 반경 규모(6.0e6~6.5e6 m)다 -> 정점이 ECEF 좌표로 구워져 있음
 *    판별은 "최선 노력"이다. 실제 샘플이 적어서 틀릴 수 있으므로 화면에서 사용자가 확인하게 한다.
 *
 * @typedef {{
 *   version: string|null, generator: string|null,
 *   extensionsUsed: string[], extensionsRequired: string[],
 *   needs: {draco:boolean, ktx2:boolean, meshopt:boolean},
 *   counts: {nodes:number, meshes:number, materials:number, textures:number, images:number, animations:number},
 *   triangles: number,
 *   bounds: {min:number[], max:number[]}|null, size: number[]|null, center: number[]|null,
 *   detected: ({kind:'rtc', center:number[]}|{kind:'ecef'})|null,
 *   warnings: string[],
 * }} GlbInfo
 */

const ECEF_MIN = 6.0e6;
const ECEF_MAX = 6.5e6;
const textDecoder = new TextDecoder();

/** glb 전체 버퍼에서 JSON 청크를 꺼낸다. 형식이 맞지 않으면 null. */
export function readGlbJson(buf) {
  const head = readGlbHeader(buf);
  if (!head || buf.byteLength < 20 + head.jsonLength) return null;
  try {
    return JSON.parse(textDecoder.decode(new Uint8Array(buf, 20, head.jsonLength)));
  } catch {
    return null;
  }
}

function nodeMatrix(node) {
  const m = new THREE.Matrix4();
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return m.fromArray(node.matrix);
  const t = node.translation ?? [0, 0, 0];
  const r = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  return m.compose(new THREE.Vector3(...t), new THREE.Quaternion(...r), new THREE.Vector3(...s));
}

/** 접근자 min/max 상자를 행렬로 변환해 box에 합친다. */
function unionAccessorBox(box, acc, matrix) {
  if (!Array.isArray(acc?.min) || !Array.isArray(acc?.max) || acc.min.length < 3 || acc.max.length < 3) return false;
  const tmp = new THREE.Box3(new THREE.Vector3(...acc.min.slice(0, 3)), new THREE.Vector3(...acc.max.slice(0, 3)));
  tmp.applyMatrix4(matrix);
  box.union(tmp);
  return true;
}

/**
 * @param {ArrayBuffer} buf glb 전체
 * @returns {GlbInfo|null} glb가 아니면 null
 */
export function inspectGlb(buf) {
  const json = readGlbJson(buf);
  if (!json) return null;
  const warnings = [];
  const used = new Set(json.extensionsUsed ?? []);
  const required = new Set(json.extensionsRequired ?? []);
  const has = (e) => used.has(e) || required.has(e);

  // ---- 범위와 삼각형 수: 기본 장면의 노드 트리를 따라간다 ----
  const accessors = json.accessors ?? [];
  const meshes = json.meshes ?? [];
  const nodes = json.nodes ?? [];
  const box = new THREE.Box3();
  let triangles = 0;
  let boundsMissing = false;
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
  const visiting = new Set();

  const visit = (index, parent) => {
    const node = nodes[index];
    if (!node || visiting.has(index)) return; // 잘못된/순환 참조는 건너뜀
    visiting.add(index);
    const world = parent.clone().multiply(nodeMatrix(node));
    if (node.mesh != null && meshes[node.mesh]) {
      for (const prim of meshes[node.mesh].primitives ?? []) {
        const pos = accessors[prim.attributes?.POSITION];
        if (!unionAccessorBox(box, pos, world)) boundsMissing = true;
        const mode = prim.mode ?? 4;
        if (mode === 4 || mode === 5 || mode === 6) {
          const count = prim.indices != null ? accessors[prim.indices]?.count : pos?.count;
          if (Number.isFinite(count)) triangles += mode === 4 ? Math.floor(count / 3) : Math.max(0, count - 2);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
    visiting.delete(index);
  };
  for (const r of roots) visit(r, new THREE.Matrix4());

  let bounds = null;
  let size = null;
  let center = null;
  if (!box.isEmpty() && [...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)) {
    bounds = { min: box.min.toArray(), max: box.max.toArray() };
    size = box.getSize(new THREE.Vector3()).toArray();
    center = box.getCenter(new THREE.Vector3()).toArray();
  } else {
    warnings.push('모델 범위를 파일에서 알 수 없습니다 (POSITION의 min/max가 없음). 화면에 올린 뒤 계산합니다.');
  }
  if (boundsMissing && bounds) warnings.push('일부 메시의 범위를 알 수 없어 실제보다 작게 계산됐을 수 있습니다.');

  // ---- 좌표 자동 판별 후보 ----
  let detected = null;
  const rtc = json.extensions?.CESIUM_RTC?.center;
  if (Array.isArray(rtc) && rtc.length === 3 && rtc.every(Number.isFinite)) {
    const r = Math.hypot(...rtc);
    if (r >= ECEF_MIN && r <= ECEF_MAX) detected = { kind: 'rtc', center: rtc };
    else warnings.push('CESIUM_RTC center가 지구 좌표(ECEF) 범위가 아니라서 위치로 쓰지 않았습니다.');
  } else if (center) {
    const r = Math.hypot(...center);
    if (r >= ECEF_MIN && r <= ECEF_MAX) detected = { kind: 'ecef' };
  }

  // ---- 단위 의심 ----
  if (size && !detected) {
    const max = Math.max(...size);
    if (max > 20000) warnings.push(`모델 크기가 ${Math.round(max).toLocaleString('ko-KR')} 단위로 매우 큽니다. 단위가 mm/cm라면 크기 배율을 줄여 보세요.`);
    else if (max > 0 && max < 0.05) warnings.push(`모델 크기가 ${max.toPrecision(2)} 단위로 매우 작습니다. 단위가 km 등이라면 크기 배율을 키워 보세요.`);
  }
  if (json.buffers?.some((b) => b.uri && !String(b.uri).startsWith('data:'))) {
    warnings.push('외부 파일(.bin 등)을 참조하는 glTF는 읽을 수 없습니다. 하나로 합친 .glb를 사용하세요.');
  }

  return {
    version: json.asset?.version ?? null,
    generator: json.asset?.generator ?? null,
    extensionsUsed: [...used],
    extensionsRequired: [...required],
    needs: { draco: has(EXT.DRACO), ktx2: has(EXT.KTX2), meshopt: has(EXT.MESHOPT) },
    counts: {
      nodes: nodes.length,
      meshes: meshes.length,
      materials: (json.materials ?? []).length,
      textures: (json.textures ?? []).length,
      images: (json.images ?? []).length,
      animations: (json.animations ?? []).length,
    },
    triangles,
    bounds,
    size,
    center,
    detected,
    warnings,
  };
}
