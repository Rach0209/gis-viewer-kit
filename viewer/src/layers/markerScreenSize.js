/**
 * POI/메모처럼 고정된 월드 크기를 가진 점 마커가, 원근 카메라로부터 얼마나 멀리
 * 있느냐에 따라 화면에서 실제로 몇 픽셀 크기로 보이는지 계산한다.
 *
 * 단순히 "카메라와의 거리(raw distance)"만 기준으로 켜고 끄면 FOV나 화면 크기가
 * 바뀔 때 기준이 안 맞는다(예: 좁은 화면/넓은 FOV에서는 같은 거리라도 더 작게 보임).
 * 원근 투영 공식을 그대로 써서 "실제 화면에서 몇 px인가"를 구하면 그 문제가 없다.
 * @param {{worldRadius:number, distance:number, cameraFovDeg:number, viewportHeightPx:number}} params
 * @returns {number} 화면상 반지름(px). distance가 0 이하면 카메라 바로 앞/뒤이므로 Infinity.
 */
export function computeApparentRadiusPx({ worldRadius, distance, cameraFovDeg, viewportHeightPx }) {
  if (distance <= 0) return Infinity;
  const fovRad = (cameraFovDeg * Math.PI) / 180;
  const pixelsPerUnit = viewportHeightPx / (2 * distance * Math.tan(fovRad / 2));
  return worldRadius * pixelsPerUnit;
}

/**
 * 마커 mesh들을, 화면상 반지름이 minScreenRadiusPx보다 작아지면 숨긴다(visible=false).
 * three.js Raycaster는 visible=false인 객체의 raycast를 건너뛰므로(Raycaster 내부
 * intersect()가 최상단에서 확인), 이 한 줄로 렌더링뿐 아니라 클릭/호버까지 함께
 * "너무 멀어서 어차피 못 누르는 상태"로 만들 수 있다 -- 화면에 점만 남아 있는데
 * 클릭은 안 되는 어중간한 상태를 피한다.
 * @param {import('three').Object3D[]} meshes
 * @param {number} worldRadius
 * @param {import('three').Camera & {position: import('three').Vector3, fov: number}} camera
 * @param {number} viewportHeightPx
 * @param {number} [minScreenRadiusPx] - 이보다 작아지면 숨김. 기본 4px.
 */
export function updateMarkerVisibilityByScreenSize(
  meshes,
  worldRadius,
  camera,
  viewportHeightPx,
  minScreenRadiusPx = 4
) {
  for (const mesh of meshes) {
    const distance = camera.position.distanceTo(mesh.position);
    const radiusPx = computeApparentRadiusPx({
      worldRadius,
      distance,
      cameraFovDeg: camera.fov,
      viewportHeightPx,
    });
    mesh.visible = radiusPx >= minScreenRadiusPx;
  }
}
