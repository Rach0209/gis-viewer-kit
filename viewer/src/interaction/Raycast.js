import * as THREE from 'three';

// 매 pointermove마다 새로 만들지 않도록 재사용한다 (호출 빈도가 높은 경로).
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();

/** 자신과 모든 조상이 visible 인가 */
export function isVisibleInHierarchy(object) {
  for (let n = object; n; n = n.parent) {
    if (!n.visible) return false;
  }
  return true;
}

/**
 * 화면 좌표(클라이언트 픽셀)를 registry에 등록된 객체들을 대상으로 raycast한다.
 *
 * three.js의 raycaster.intersectObjects(..., true)는 등록된 객체의 자손까지
 * 재귀적으로 검사하므로, 실제로 맞은 노드는 registry가 모르는 자손 메시일 수 있다
 * (예: 3D Tiles가 로드하는 glTF 내부 구조). 그래서 교차 결과에서부터 부모로
 * 올라가며 registry에 실제로 등록된 노드를 찾는다.
 *
 * @param {number} clientX
 * @param {number} clientY
 * @param {{camera: THREE.Camera, domElement: HTMLElement, registry: import('./PickableRegistry.js').PickableRegistry}} ctx
 * @returns {{object: THREE.Object3D, point: THREE.Vector3, metadata: Object}|null}
 */
export function pickAt(clientX, clientY, { camera, domElement, registry }) {
  const rect = domElement.getBoundingClientRect();
  pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointerNdc, camera);
  // registry.getAll()을 매번 다시 호출한다 -- 캐싱하면 동적 LOD로 이미
  // 사라진 타일을 대상으로 raycast하게 될 수 있다 (PickableRegistry 문서 참고).
  // three.js의 raycast는 visible=false(레이어 패널로 끈 레이어 등)를 무시하고 맞춘다.
  // 화면에 보이지 않는 것이 호버/클릭/좌표에 잡히지 않도록 보이는 첫 교차점만 쓴다.
  const hit = raycaster.intersectObjects(registry.getAll(), true).find((i) => isVisibleInHierarchy(i.object));
  if (!hit) return null;
  let node = hit.object;
  while (node && !registry.has(node)) {
    node = node.parent;
  }
  if (!node) return null;

  return { object: node, point: hit.point, metadata: registry.getMetadata(node) };
}
