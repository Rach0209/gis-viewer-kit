/**
 * THREE.Object3D 서브트리를 순회하며 geometry/material/텍스처를 재귀적으로 해제한다.
 *
 * 타일 레이어는 카메라가 움직일 때마다 메시가 계속 생성되고 버려진다
 * (특히 3D Tiles의 동적 LOD). dispose를 빠뜨리면 GPU 메모리 누수로 이어지므로,
 * 모든 레이어의 onRemove/dispose에서 이 함수를 통해서만 정리한다.
 * @param {import('three').Object3D} object3d
 */
export function disposeObject3D(object3d) {
  object3d.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) disposeMaterial(obj.material);
  });
}

/** @param {import('three').Material|import('three').Material[]} material */
function disposeMaterial(material) {
  const materials = Array.isArray(material) ? material : [material];
  for (const mat of materials) {
    // 어떤 텍스처 슬롯(map, normalMap, aoMap, ...)이 쓰였는지 미리 알 필요 없이,
    // 머티리얼의 모든 속성 중 텍스처처럼 보이는 것을 찾아 해제한다.
    for (const value of Object.values(mat)) {
      if (value && value.isTexture && typeof value.dispose === 'function') {
        value.dispose();
      }
    }
    mat.dispose();
  }
}
