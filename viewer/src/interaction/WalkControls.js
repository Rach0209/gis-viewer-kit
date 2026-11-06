import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { EYE_HEIGHT, createWalkState, findGroundY, isBlocked, jump, probeOriginY, stepVertical } from './walkPhysics.js';

// 2026-08-12: 실제 보행 속도(4/s)에 맞췄더니 넓은 스캔 현장에서는 느리게 느껴진다는
// 피드백을 받아 올림. 1인칭 화면은 카메라가 낮고 시야가 좁아서, 같은 속도라도 위에서
// 내려다보는 오빗 뷰보다 훨씬 느리게 체감된다.
const WALK_SPEED = 8; // 초당 이동 거리
const SPRINT_MULTIPLIER = 2.5;
const GROUND_PROBE_HEIGHT = 2000; // 걷기를 처음 켤 때(시작 위치를 안 골랐을 때)만 이만큼 위에서 쏜다 -- 카메라가 어디 있든
// (예: 전체 보기로 멀리 빠져 있어도) 바로 아래 지면을 찾을 수 있게. 걷는 중에는 발 높이 기준으로 쏜다(walkPhysics.js).
// 사람 눈높이(1.7)에서 가까운 바닥/벽을 제대로 보려면 near가 이 정도로 작아야 한다.
// fitTo()가 넓은 화면을 맞출 때 잡아둔 near(카메라-대상 거리에 비례, 보통 몇 유닛 이상)를
// 그대로 쓰면 눈높이 바로 아래 바닥이 near보다 가까워서 렌더링에서 잘려(안 보여) 나간다
// (2026-08-12 실사용 중 발견). enable()/disable()에서 원래 값과 바꿔치기한다.
const WALK_NEAR = 0.05;

/**
 * 1인칭 시점으로 3D Tiles/모델 표면을 걸어다니는 컨트롤.
 *
 * three.js 기본 제공 PointerLockControls(마우스로 시점 회전, 포인터를 캔버스에 가둠)에
 * WASD 이동과 "바닥 따라가기"를 얹었다. 매 프레임 카메라 바로 위(GROUND_PROBE_HEIGHT)에서
 * 발 높이 바로 위에서 아래로 raycast를 쏴 처음 맞은 표면을 바닥으로 삼고(건물 아래·다층 구조를 걸을 수 있다),
 * 그 높이 + EYE_HEIGHT로 카메라 y를 둔다. 허리 높이 앞쪽에 벽이 있으면 그쪽으로는 못 간다 -- PickableRegistry에
 * 등록된 지오메트리(다른 클릭 기능들과 동일한 registry)를 그대로 재사용하므로, 데이터가
 * glb 하나든 3D Tiles로 쪼개져 있든 상관없이 동작한다.
 *
 * 항공/드론 사진 기반 스캔 데이터는 보통 지붕·바깥 지면만 찍혀 있고 건물 내부는 없다.
 * 그런 "바닥이 없는" 곳(레이가 아무것도 안 맞음)으로는 이동 자체를 취소한다 -- 허공으로
 * 떨어지는 대신 "그쪽으로는 갈 수 없음"으로 처리해, 데이터에 없는 공간을 자연스럽게 막는다.
 */
export class WalkControls {
  /** @param {THREE.PerspectiveCamera} camera @param {HTMLElement} domElement */
  constructor(camera, domElement) {
    this._camera = camera;
    this._domElement = domElement;
    this._pointerLock = new PointerLockControls(camera, domElement);
    this._viewer = null;
    this._keys = { forward: false, back: false, left: false, right: false, sprint: false };
    this._runToggled = false; // R로 켜고 끄는 고정 2배속(Shift와 별개, 같이 쓰면 곱)
    this._state = createWalkState(0); // 발 높이·수직 속도·착지 여부 (walkPhysics.js)
    this._savedNear = null;
    this._savedFar = null;
    this._raycaster = new THREE.Raycaster();
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onCanvasClick = this._onCanvasClick.bind(this);
  }

  get isLocked() {
    return this._pointerLock.isLocked;
  }

  /**
   * @param {import('../core/Viewer.js').Viewer} viewer
   * @param {{x:number,y:number,z:number}} [startPosition] - 표면 위 시작 지점(x/y/z 모두 사용,
   *   y는 그 지점 바로 위 EYE_HEIGHT로 선다). 생략하면 지금 카메라 위치 바로 아래 지면을 찾는다.
   */
  enable(viewer, startPosition) {
    this._viewer = viewer;

    if (startPosition) {
      // StartPositionPicker로 사용자가 직접 고른 지점 -- x/z까지 그대로 옮긴다. 고른 점의 높이가 곧 서는 층이다.
      this._state = createWalkState(startPosition.y);
      this._camera.position.set(startPosition.x, startPosition.y + EYE_HEIGHT, startPosition.z);
    } else {
      // 걷기 모드를 켜는 순간의 카메라 위치 바로 아래 지면을 찾아, 거기 서 있는 높이로 시작한다 (맨 위 표면).
      const p = this._camera.position;
      const groundY = findGroundY(this._raycaster, this._objects(), p.x, p.y + GROUND_PROBE_HEIGHT, p.z);
      this._state = createWalkState(groundY ?? p.y - EYE_HEIGHT);
      this._camera.position.y = this._state.feetY + EYE_HEIGHT;
    }

    this._savedNear = this._camera.near;
    this._savedFar = this._camera.far;
    this._camera.near = WALK_NEAR;
    this._camera.updateProjectionMatrix();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    // 포인터 락은 브라우저가 "사용자 제스처 직후"에만 허용한다. 이 enable()은 항상 버튼
    // 클릭 핸들러 안에서 호출되므로 바로 요청해도 되지만, 이후 락이 풀렸을 때(Esc 등)
    // 다시 클릭해서 재요청할 수 있도록 클릭 리스너도 같이 걸어둔다.
    this._domElement.addEventListener('click', this._onCanvasClick);
    this._pointerLock.lock();
  }

  disable() {
    if (!this._viewer) return;
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this._domElement.removeEventListener('click', this._onCanvasClick);
    if (this._pointerLock.isLocked) this._pointerLock.unlock();
    this._keys = { forward: false, back: false, left: false, right: false, sprint: false };
    this._runToggled = false;
    this._state = createWalkState(0);
    // near/far를 오빗/맵 모드가 쓰던 값으로 되돌린다 -- 걷기용으로 낮춰둔 near(0.05)를
    // 그대로 두면, 다시 멀리서 전체를 볼 때 z-fighting/정밀도 문제가 생길 수 있다.
    if (this._savedNear != null) {
      this._camera.near = this._savedNear;
      this._camera.far = this._savedFar;
      this._camera.updateProjectionMatrix();
      this._savedNear = null;
      this._savedFar = null;
    }
    this._viewer = null;
  }

  dispose() {
    this.disable();
    this._pointerLock.dispose();
  }

  /**
   * 매 프레임 호출. cameraRig.update() 대신 이게 카메라를 직접 움직이므로, 이 도구가
   * 켜져 있는 동안은 main.js 쪽에서 cameraRig.update()를 부르지 않아야 한다(둘 다
   * camera.position을 건드리면 서로 충돌한다).
   * @param {number} dt
   */
  update(dt) {
    if (!this._viewer || !this._pointerLock.isLocked) return;

    // Shift(누르는 동안)와 R(눌러서 켜고 끄는 토글)은 서로 독립적이라 둘 다 켜져 있으면 곱해진다.
    const fastMultiplier =
      (this._keys.sprint ? SPRINT_MULTIPLIER : 1) * (this._runToggled ? SPRINT_MULTIPLIER : 1);
    const speed = WALK_SPEED * fastMultiplier * dt;
    const beforeX = this._camera.position.x;
    const beforeZ = this._camera.position.z;

    if (this._keys.forward) this._pointerLock.moveForward(speed);
    if (this._keys.back) this._pointerLock.moveForward(-speed);
    if (this._keys.right) this._pointerLock.moveRight(speed);
    if (this._keys.left) this._pointerLock.moveRight(-speed);

    // 수평 이동이 벽에 막히면 그 방향은 취소한다. 대각선이 막히면 한 축씩 따로 시도해서 벽을 따라 미끄러진다.
    const pos = this._camera.position;
    const dx = pos.x - beforeX;
    const dz = pos.z - beforeZ;
    if (dx !== 0 || dz !== 0) {
      const objects = this._objects();
      const st = this._state;
      if (isBlocked(this._raycaster, objects, st, beforeX, beforeZ, dx, dz)) {
        const slideX = dx !== 0 && !isBlocked(this._raycaster, objects, st, beforeX, beforeZ, dx, 0);
        const slideZ = dz !== 0 && !isBlocked(this._raycaster, objects, st, beforeX, beforeZ, 0, dz);
        pos.x = slideX ? beforeX + dx : beforeX;
        pos.z = slideZ ? beforeZ + dz : beforeZ;
      }
    }

    let groundY = findGroundY(this._raycaster, this._objects(), pos.x, probeOriginY(this._state), pos.z);
    if (groundY === null) {
      // 바닥이 없는 곳(스캔 안 된 건물 내부, 데이터 바깥 등)으로 나가려 했다 -- 수평 이동만 취소하고,
      // 원래 있던 자리 기준으로 바닥을 다시 찾는다.
      pos.x = beforeX;
      pos.z = beforeZ;
      groundY = findGroundY(this._raycaster, this._objects(), pos.x, probeOriginY(this._state), pos.z);
    }

    stepVertical(this._state, groundY, dt); // 점프·낙하·계단 오르내리기
    pos.y = this._state.feetY + EYE_HEIGHT;
  }

  _objects() {
    return this._viewer?.pickableRegistry?.getAll() ?? [];
  }

  _onCanvasClick() {
    if (!this._pointerLock.isLocked) this._pointerLock.lock();
  }

  /** @param {KeyboardEvent} event */
  _onKeyDown(event) {
    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        this._keys.forward = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this._keys.back = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this._keys.left = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this._keys.right = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this._keys.sprint = true;
        break;
      case 'KeyR':
        this._runToggled = !this._runToggled;
        break;
      case 'Space':
        // 브라우저 기본 동작(스크롤, 그리고 무엇보다 -- 걷기 모드를 켠 버튼이 아직
        // 포커스를 갖고 있으면 Space가 그 버튼을 다시 "클릭"해서 걷기 모드가 꺼져버리는
        // 문제, 2026-08-12 실사용 중 발견)을 막는다. ToolControls에서 클릭 후 버튼을
        // blur()하도록도 고쳐뒀지만, 여기서도 한 번 더 막아 이중으로 방지한다.
        event.preventDefault();
        // 땅에 있을 때만 점프를 받아들인다(공중에서 다시 눌러도 무시 -- 이중 점프 방지).
        jump(this._state);
        break;
    }
  }

  /** @param {KeyboardEvent} event */
  _onKeyUp(event) {
    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        this._keys.forward = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this._keys.back = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this._keys.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this._keys.right = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this._keys.sprint = false;
        break;
    }
  }
}
