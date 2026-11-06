import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  GRAVITY, JUMP_HEIGHT, STEP_UP, createWalkState, findGroundY, isBlocked, jump, probeOriginY, stepVertical,
} from './walkPhysics.js';

/** 수평면 (위를 보는 면). 중심 (cx, y, cz), 한 변 size */
function floor(cx, y, cz, size) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(cx, y, cz);
  m.updateMatrixWorld(true);
  return m;
}
/** 세운 벽 (x 방향으로 놓인 면 = z 축에 수직): 중심 (cx, cy, cz), 폭 w, 높이 h */
function wall(cx, cy, cz, w, h) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  m.position.set(cx, cy, cz);
  m.updateMatrixWorld(true);
  return m;
}

describe('필로티 건물: 아래가 뚫린 건물의 지붕 밑을 걷는다', () => {
  // 지면 y=0 (넓음), 건물 지붕 y=4 (x,z 모두 -10..10)
  const ground = floor(0, 0, 0, 200);
  const roof = floor(0, 4, 0, 20);
  const objects = [ground, roof];
  const rc = new THREE.Raycaster();

  it('옛 방식(맨 위에서 쏘기)은 건물 아래에서도 지붕을 바닥으로 잡는다 (문제 재현)', () => {
    expect(findGroundY(rc, objects, 0, 2000, 0)).toBeCloseTo(4, 6);
  });

  it('발 높이 기준으로 쏘면 건물 아래에서는 지면을 바닥으로 잡는다', () => {
    const s = createWalkState(0);
    expect(findGroundY(rc, objects, 0, probeOriginY(s), 0)).toBeCloseTo(0, 6);
  });

  it('지붕 위에 서 있으면 지붕이 바닥이다', () => {
    const s = createWalkState(4);
    expect(findGroundY(rc, objects, 0, probeOriginY(s), 0)).toBeCloseTo(4, 6);
  });

  it('건물 밖으로 걸어 나가도 계속 지면을 따라간다', () => {
    const s = createWalkState(0);
    expect(findGroundY(rc, objects, 15, probeOriginY(s), 0)).toBeCloseTo(0, 6);
  });
});

describe('다층 건물: 층마다 따로', () => {
  const objects = [floor(0, 0, 0, 100), floor(0, 3, 0, 20), floor(0, 6, 0, 20)]; // 1층, 2층 바닥, 옥상
  const rc = new THREE.Raycaster();
  it('각 층에 서 있으면 그 층의 바닥을 잡는다', () => {
    for (const y of [0, 3, 6]) {
      expect(findGroundY(rc, objects, 0, probeOriginY(createWalkState(y)), 0)).toBeCloseTo(y, 6);
    }
  });
});

describe('stepVertical', () => {
  it('평지: 바닥에 붙어 있다', () => {
    const s = createWalkState(0);
    stepVertical(s, 0, 0.016);
    expect(s).toMatchObject({ feetY: 0, vy: 0, grounded: true });
  });

  it('작은 오르막(STEP_UP 이하)과 작은 내리막은 바닥을 따라간다', () => {
    const s = createWalkState(0);
    stepVertical(s, STEP_UP, 0.016);
    expect(s.feetY).toBeCloseTo(STEP_UP, 6);
    stepVertical(s, STEP_UP - 0.3, 0.016);
    expect(s.feetY).toBeCloseTo(STEP_UP - 0.3, 6);
    expect(s.grounded).toBe(true);
  });

  it('큰 낭떠러지는 즉시 순간이동하지 않고 중력으로 떨어져 착지한다', () => {
    const s = createWalkState(4);
    stepVertical(s, 0, 0.016);
    expect(s.grounded).toBe(false);
    expect(s.feetY).toBeLessThan(4);
    expect(s.feetY).toBeGreaterThan(3.9); // 한 프레임에 조금만 떨어진다
    let frames = 0;
    while (!s.grounded && frames++ < 1000) stepVertical(s, 0, 0.016);
    expect(s.grounded).toBe(true);
    expect(s.feetY).toBe(0);
    expect(frames).toBeGreaterThan(10);
  });

  it('점프는 JUMP_HEIGHT 근처까지 올라갔다가 착지한다', () => {
    const s = createWalkState(0);
    expect(jump(s)).toBe(true);
    let peak = 0;
    let frames = 0;
    while (!s.grounded && frames++ < 1000) {
      stepVertical(s, 0, 0.005);
      peak = Math.max(peak, s.feetY);
    }
    expect(peak).toBeGreaterThan(JUMP_HEIGHT * 0.95);
    expect(peak).toBeLessThan(JUMP_HEIGHT * 1.05);
    expect(s.grounded).toBe(true);
    expect(s.feetY).toBe(0);
  });

  it('공중에서는 다시 점프할 수 없다', () => {
    const s = createWalkState(0);
    jump(s);
    stepVertical(s, 0, 0.016);
    expect(jump(s)).toBe(false);
  });

  it('바닥을 못 찾으면(null) 상태를 바꾸지 않는다', () => {
    const s = createWalkState(2);
    stepVertical(s, null, 0.016);
    expect(s).toEqual({ feetY: 2, vy: 0, grounded: true });
  });

  it('점프 중 위쪽 바닥(발코니 등)에 닿으면 거기 착지한다', () => {
    const s = createWalkState(0);
    jump(s);
    for (let i = 0; i < 400 && !s.grounded; i++) stepVertical(s, 0.9, 0.005); // 서 있는 곳 아래 바닥이 0.9로 올라가 있음
    expect(s.grounded).toBe(true);
    expect(s.feetY).toBeCloseTo(0.9, 6);
  });
});

describe('isBlocked (벽)', () => {
  const rc = new THREE.Raycaster();
  const state = createWalkState(0);
  // z = -2 위치의 벽 (폭 10, 높이 3, 지면에서 위로)
  const objects = [wall(0, 1.5, -2, 10, 3)];

  it('벽 바로 앞으로 걸으면 막힌다', () => {
    expect(isBlocked(rc, objects, state, 0, -1.5, 0, -0.2)).toBe(true);
  });
  it('벽에서 멀면 막히지 않는다', () => {
    expect(isBlocked(rc, objects, state, 0, 3, 0, -0.1)).toBe(false);
  });
  it('벽에서 멀어지는 방향이면 막히지 않는다', () => {
    expect(isBlocked(rc, objects, state, 0, -1.5, 0, 0.2)).toBe(false);
  });
  it('벽 옆을 따라 걷는 것(평행 이동)은 막히지 않는다', () => {
    expect(isBlocked(rc, objects, state, 0, -1.5, 0.2, 0)).toBe(false);
  });
  it('제자리(이동 0)는 막히지 않는다', () => {
    expect(isBlocked(rc, objects, state, 0, -1.5, 0, 0)).toBe(false);
  });
});

it('상수 확인', () => {
  expect(GRAVITY).toBe(20);
});
