/**
 * CameraRig의 'map' 모드 팬 범위 제한 계산. three.js 인스턴스에 의존하지 않는
 * 순수 함수로 뽑아서, 렌더링 없이 단위 테스트할 수 있게 한다.
 */

/**
 * target이 center로부터 maxDistance보다 멀리 벗어났으면, target과 카메라에
 * 똑같이 더해줘야 할 이동량(delta)을 계산한다. 카메라-target 상대 위치(거리/각도)는
 * 그대로 유지한 채 되돌리기 위함이다. 범위 안에 있으면 {deltaX:0, deltaZ:0}을 반환한다.
 * @param {{targetX:number, targetZ:number, centerX:number, centerZ:number, maxDistance:number}} params
 * @returns {{deltaX:number, deltaZ:number}}
 */
export function computePanClampDelta({ targetX, targetZ, centerX, centerZ, maxDistance }) {
  const dx = targetX - centerX;
  const dz = targetZ - centerZ;
  const dist = Math.hypot(dx, dz);
  if (dist <= maxDistance) {
    return { deltaX: 0, deltaZ: 0 };
  }

  const scale = maxDistance / dist;
  const clampedX = centerX + dx * scale;
  const clampedZ = centerZ + dz * scale;
  return { deltaX: clampedX - targetX, deltaZ: clampedZ - targetZ };
}
