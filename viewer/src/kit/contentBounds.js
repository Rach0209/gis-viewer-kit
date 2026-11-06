import * as THREE from 'three';

const _box = new THREE.Box3();

/**
 * 실제로 로드된 메시들의 범위와 "지면 높이"(메시 바닥 높이의 낮은 백분위수)를 구한다.
 *
 * 타일셋의 루트 bounding volume은 실제 데이터보다 훨씬 클 수 있다 (실데이터에서 높이가 약 7km로 잡혀
 * 있고 실제 메시는 -86~218m). 배경 지도의 위치/범위/높이는 선언된 값이 아니라 실제 메시로 정해야 맞는다.
 * 가장 낮은 점 대신 낮은 백분위수를 쓰는 이유: 점 하나(구덩이, 잡음)가 지도를 터무니없이 아래로 끌고 가지 않게.
 *
 * @param {THREE.Object3D} root
 * @param {{ groundPercentile?: number }} [opts]
 * @returns {{ box: THREE.Box3, groundY: number, count: number } | null} 메시가 없으면 null
 */
export function computeContentBounds(root, { groundPercentile = 0.1 } = {}) {
  const box = new THREE.Box3();
  const bottoms = [];
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    if (o.geometry.boundingBox.isEmpty()) return;
    _box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    if (!Number.isFinite(_box.min.y) || !Number.isFinite(_box.max.y)) return;
    box.union(_box);
    bottoms.push(_box.min.y);
  });
  if (bottoms.length === 0) return null;
  bottoms.sort((a, b) => a - b);
  const idx = Math.min(bottoms.length - 1, Math.floor(bottoms.length * groundPercentile));
  return { box, groundY: bottoms[idx], count: bottoms.length };
}
