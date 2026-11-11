import * as THREE from 'three';

const NDC_CORNERS = [
  [-1, 1], // 화면 왼쪽 위
  [1, 1], // 오른쪽 위
  [1, -1], // 오른쪽 아래
  [-1, -1], // 왼쪽 아래
];

const origin = new THREE.Vector3();
const dir = new THREE.Vector3();

/**
 * 지금 화면에 보이는 영역이 바닥(수평면 y = planeY)에서 차지하는 네 점을 구한다 (미니맵에 사각형으로 그린다).
 * 가까이 확대하면 작은 사각형, 멀리 빼면 큰 사각형이 되어 "얼마나 확대했는지"가 보인다.
 *
 * 화면 네 모서리에서 쏜 시선이 바닥에 닿는 곳을 쓴다. 시선이 수평선 위를 향하면(기울여서 하늘이 보일 때)
 * 바닥에 닿지 않으므로, 카메라에서 수평으로 `reach`만큼 떨어진 곳에서 끊는다. 그래서 사각형이 끝없이
 * 늘어나지 않고 앞쪽으로 길게 뻗은 모양이 된다. 바닥에 닿는 시선도 같은 거리로 제한한다.
 * `reach`는 최소한 카메라 높이의 3배로 늘려서, 높이 올라간 카메라의 화면이 찌그러지지 않게 한다.
 *
 * @param {import('three').PerspectiveCamera} camera 월드 행렬이 최신이어야 한다
 * @param {number} planeY 바닥 높이
 * @param {number} reach 수평으로 볼 최대 거리
 * @returns {Array<{x:number, z:number}>} 왼쪽 위, 오른쪽 위, 오른쪽 아래, 왼쪽 아래 순서
 */
export function computeViewFootprint(camera, planeY, reach) {
  camera.updateMatrixWorld();
  origin.setFromMatrixPosition(camera.matrixWorld);
  const height = origin.y - planeY;
  const cap = Math.max(reach, height > 0 ? height * 3 : 0);
  return NDC_CORNERS.map(([nx, ny]) => {
    dir.set(nx, ny, 0.5).unproject(camera).sub(origin).normalize();
    const flat = Math.hypot(dir.x, dir.z);
    if (flat < 1e-9) return { x: origin.x, z: origin.z }; // 바로 아래/위를 향하는 시선
    // 카메라가 바닥 위에 있고 시선이 아래를 향할 때만 바닥에 닿는다. 수평 거리 = t * flat
    const hits = height > 0 && dir.y < -1e-6;
    const horizontal = hits ? Math.min((height / -dir.y) * flat, cap) : cap;
    const k = horizontal / flat;
    return { x: origin.x + dir.x * k, z: origin.z + dir.z * k };
  });
}
