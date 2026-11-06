import * as THREE from 'three';

/**
 * 걷기(1인칭)의 "발 아래 바닥 찾기"와 수직 이동(점프·낙하) 계산. 카메라/DOM에 의존하지 않아 시험할 수 있다.
 *
 * 예전에는 매 프레임 카메라의 2000 단위 **위**에서 아래로 쏴서 맨 위 표면을 바닥으로 삼았다. 항공 스캔처럼 표면이 한 겹인
 * 데이터에는 충분하지만, 아래가 뚫린 건물(필로티)이나 다층 구조에서는 지붕이 항상 "바닥"이 되어 건물 아래로 못 걷고
 * 옥상으로 올라갔다. 지금은 **발 높이 + STEP_UP**에서 아래로 쏴서, 지금 서 있는 층 바로 아래의 첫 표면을 바닥으로 삼는다.
 *  - 천장이나 지붕은 레이 시작점보다 위에 있어 무시된다 → 건물 아래/안쪽 층을 걸을 수 있다.
 *  - 계단·경사처럼 STEP_UP 이하로 오르는 표면은 그대로 따라 오른다. 그보다 높은 단차는 올라가지 않는다(벽 취급은 아래 blocked).
 */

/** 눈높이(발 위) */
export const EYE_HEIGHT = 1.7;
/** 한 번에 오를 수 있는 높이. 계단 한 칸·연석 정도 */
export const STEP_UP = 0.6;
/** 이보다 작게 내려가는 바닥은 떨어지지 않고 붙어서 따라 내려간다 (내리막·계단 내려가기) */
export const STEP_DOWN = 0.5;
export const GRAVITY = 20;
export const JUMP_HEIGHT = 1.2;
export const JUMP_VELOCITY = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
/** 앞을 막는 벽을 검사하는 높이(발 위)와 몸 반지름 */
export const WAIST_HEIGHT = 0.9;
export const BODY_RADIUS = 0.35;

/** @param {number} feetY 처음 서는 발 높이 */
export function createWalkState(feetY) {
  return { feetY, vy: 0, grounded: true };
}

/**
 * x, z 위치에서 발 아래 바닥 높이를 찾는다. 시작점 아래로 맨 처음 만나는 표면. 없으면 null.
 * @param {THREE.Raycaster} raycaster
 * @param {THREE.Object3D[]} objects
 * @param {number} x @param {number} originY 레이를 쏘는 높이 @param {number} z
 */
export function findGroundY(raycaster, objects, x, originY, z) {
  raycaster.set(new THREE.Vector3(x, originY, z), new THREE.Vector3(0, -1, 0));
  const hits = raycaster.intersectObjects(objects, true);
  return hits.length > 0 ? hits[0].point.y : null;
}

/** 지금 발 높이에서 바닥을 찾는 시작 높이 */
export const probeOriginY = (state) => state.feetY + STEP_UP;

/**
 * 수평 이동(dx, dz)이 벽에 막히는지 본다. 허리 높이에서 이동 방향으로 (이동 거리 + 몸 반지름) 앞을 쏜다.
 * @returns {boolean} 막히면 true
 */
export function isBlocked(raycaster, objects, state, x, z, dx, dz) {
  const len = Math.hypot(dx, dz);
  if (len === 0) return false;
  raycaster.set(new THREE.Vector3(x, state.feetY + WAIST_HEIGHT, z), new THREE.Vector3(dx / len, 0, dz / len));
  const hits = raycaster.intersectObjects(objects, true);
  return hits.length > 0 && hits[0].distance <= len + BODY_RADIUS;
}

/** 땅에 있을 때만 점프한다 (공중 이중 점프 방지) */
export function jump(state) {
  if (!state.grounded) return false;
  state.vy = JUMP_VELOCITY;
  state.grounded = false;
  return true;
}

/**
 * 수직 상태를 한 프레임 진행한다.
 * @param {{feetY:number, vy:number, grounded:boolean}} state
 * @param {number|null} groundY 지금 서 있는 곳 아래 바닥 높이 (null이면 바닥을 못 찾음 → 그대로 둔다)
 * @param {number} dt
 */
export function stepVertical(state, groundY, dt) {
  if (groundY === null) return;

  if (state.grounded) {
    if (groundY >= state.feetY || state.feetY - groundY <= STEP_DOWN) {
      state.feetY = groundY; // 평지·오르막·작은 내리막은 바닥에 붙는다
      return;
    }
    state.grounded = false; // 바닥이 크게 꺼졌다 → 낙하 시작
  }

  state.vy -= GRAVITY * dt;
  state.feetY += state.vy * dt;
  if (state.feetY <= groundY) {
    state.feetY = groundY; // 착지 (또는 점프 중 위쪽 바닥에 닿음)
    state.vy = 0;
    state.grounded = true;
  }
}
