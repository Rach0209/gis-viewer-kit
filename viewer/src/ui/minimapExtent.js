/**
 * 미니맵이 보여줄 범위. 기본은 데이터 전체 범위이고, 화면이 그보다 넓게 보이면(멀리 뺀 경우)
 * 보이는 영역 사각형이 미니맵 밖으로 나가 버리므로 그만큼 넓힌다.
 *
 * 범위는 매 프레임 조금씩 바뀌지 않고 `step`배씩 단계적으로만 커진다. 배경(위에서 찍은 사진)은
 * 초당 4번만 다시 그리는데, 범위가 계속 변하면 배경과 그 위의 사각형·화살표가 어긋나 보이기 때문이다.
 * 데이터 중심은 그대로 두고 정사각형으로 넓힌다.
 *
 * @param {import('three').Box3} bounds 데이터 전체 범위
 * @param {Array<{x:number,z:number}>|null} footprint 지금 화면에 보이는 바닥 네 점 (viewFootprint.js)
 * @param {{step?:number, maxLevels?:number}} [o] maxLevels: 넓힐 수 있는 최대 단계 (너무 멀리까지 넓히지 않는다)
 * @returns {import('three').Box3} 넓힐 필요가 없으면 bounds의 복사본
 */
export function computeMinimapExtent(bounds, footprint, { step = 1.6, maxLevels = 4 } = {}) {
  const extent = bounds.clone();
  if (bounds.isEmpty() || !footprint?.length) return extent;

  const cx = (bounds.min.x + bounds.max.x) / 2;
  const cz = (bounds.min.z + bounds.max.z) / 2;
  const baseHalf = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, 1) / 2;

  let need = 0;
  for (const p of footprint) {
    need = Math.max(need, Math.abs(p.x - cx), Math.abs(p.z - cz));
  }
  if (!(need > baseHalf)) return extent;

  const level = Math.min(Math.ceil(Math.log(need / baseHalf) / Math.log(step) - 1e-9), maxLevels);
  const half = baseHalf * step ** level;
  extent.min.set(cx - half, bounds.min.y, cz - half);
  extent.max.set(cx + half, bounds.max.y, cz + half);
  return extent;
}
