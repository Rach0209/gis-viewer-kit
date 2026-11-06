import * as THREE from 'three';

// 2026-08-12: 처음 값(12)이 느리다는 피드백을 받아 올림.
const MOVE_SPEED = 20; // 초당 이동 거리 -- 자유 비행이라 도보(WalkControls)보다 기본적으로 빠르게
const BOOST_MULTIPLIER = 3;
const LOOK_SENSITIVITY = 0.003;
const WHEEL_DOLLY_SPEED = 0.05; // 휠 한 "틱"(deltaY 한 단위)당 앞뒤로 이동하는 거리
// WalkControls와 같은 이유(EYE_HEIGHT 정도로 가까운 벽/바닥이 near보다 가까워 렌더링에서
// 잘려 안 보이는 문제 방지) -- 건물 내부를 가까이서 둘러볼 수도 있으니 여기서도 필요하다.
const AERIAL_NEAR = 0.05;

/**
 * 마우스 드래그로 시점을 돌리는 자유 비행 카메라("항공"/3인칭 체험 모드).
 *
 * WalkControls(1인칭)와 달리 Pointer Lock을 전혀 쓰지 않는다 -- 커서가 계속 보이고,
 * 왼쪽 버튼을 누른 채 드래그할 때만 시점이 회전한다(이미 오빗/맵 컨트롤에서 익숙한
 * "드래그해서 둘러보기" 감각 그대로). 클릭해서 잠그고 Esc로 풀어야 하는 포인터 락의
 * UX 문턱이 없다 -- 1인칭 모드의 포인터 락이 헷갈린다는 피드백을 받고 대안으로
 * 추가했다(2026-08-12).
 *
 * 바닥 따라가기/중력도 없다 -- WASD + Space(위)/Shift(아래)로 3D 공간을 자유롭게
 * 날아다닌다. ExperienceControls가 WalkControls와 함께 묶어서 Tab으로 전환한다.
 */
export class AerialControls {
  /** @param {THREE.PerspectiveCamera} camera @param {HTMLElement} domElement */
  constructor(camera, domElement) {
    this._camera = camera;
    this._domElement = domElement;
    this._viewer = null;
    this._dragging = false;
    this._keys = { forward: false, back: false, left: false, right: false, up: false, down: false };
    this._boost = false; // R로 켜고 끄는 가속 토글(WalkControls의 R과 일관된 자리)
    this._savedNear = null;
    this._savedFar = null;
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
  }

  /** @param {import('../core/Viewer.js').Viewer} viewer */
  enable(viewer) {
    this._viewer = viewer;

    this._savedNear = this._camera.near;
    this._savedFar = this._camera.far;
    this._camera.near = AERIAL_NEAR;
    this._camera.updateProjectionMatrix();

    this._domElement.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    // wheel은 캔버스 위에서만 -- 다른 도구/스크롤과 안 겹치게, passive:false로 페이지
    // 스크롤(기본 동작)을 막을 수 있게 등록한다.
    this._domElement.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  disable() {
    if (!this._viewer) return;
    this._domElement.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    this._domElement.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this._dragging = false;
    this._keys = { forward: false, back: false, left: false, right: false, up: false, down: false };
    this._boost = false;
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
  }

  /** @param {number} dt */
  update(dt) {
    if (!this._viewer) return;
    const speed = MOVE_SPEED * (this._boost ? BOOST_MULTIPLIER : 1) * dt;

    // getWorldDirection이 matrixWorld를 읽는데, 이 함수는 렌더 루프보다 먼저 불리므로
    // (viewer의 프레임별 update 콜백 -> 그 다음에 render) 회전만 하고 아직 한 번도
    // 렌더되지 않은 프레임에서는 matrixWorld가 최신이 아닐 수 있다. 직접 갱신해서 확실히 한다.
    this._camera.updateMatrixWorld();
    this._camera.getWorldDirection(this._forward);
    this._right.crossVectors(this._forward, this._camera.up).normalize();

    if (this._keys.forward) this._camera.position.addScaledVector(this._forward, speed);
    if (this._keys.back) this._camera.position.addScaledVector(this._forward, -speed);
    if (this._keys.right) this._camera.position.addScaledVector(this._right, speed);
    if (this._keys.left) this._camera.position.addScaledVector(this._right, -speed);
    if (this._keys.up) this._camera.position.y += speed;
    if (this._keys.down) this._camera.position.y -= speed;
  }

  /** @param {PointerEvent} event */
  _onPointerDown(event) {
    if (event.button !== 0) return; // 왼쪽 버튼 드래그만 시점 회전으로 쓴다
    this._dragging = true;
  }

  /** @param {PointerEvent} event */
  _onPointerMove(event) {
    if (!this._dragging) return;
    this._euler.setFromQuaternion(this._camera.quaternion);
    this._euler.y -= event.movementX * LOOK_SENSITIVITY;
    this._euler.x -= event.movementY * LOOK_SENSITIVITY;
    this._euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this._euler.x));
    this._camera.quaternion.setFromEuler(this._euler);
  }

  _onPointerUp() {
    this._dragging = false;
  }

  /**
   * 오빗/맵 컨트롤의 "휠로 확대/축소"에 대응하는 동작 -- 항공 모드는 target이 없는
   * 자유 비행이라 "확대"라는 개념 자체가 없다. 그래서 대신 보고 있는 방향으로 앞뒤
   * 이동(dolly)시킨다. Blender 등 다른 3D 툴의 fly 모드와 같은 관례다.
   * @param {WheelEvent} event
   */
  _onWheel(event) {
    event.preventDefault();
    this._camera.updateMatrixWorld();
    this._camera.getWorldDirection(this._forward);
    const distance = -event.deltaY * WHEEL_DOLLY_SPEED;
    this._camera.position.addScaledVector(this._forward, distance);
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
      case 'Space':
        event.preventDefault(); // 스크롤/포커스된 버튼 재클릭 방지(WalkControls와 같은 이유)
        this._keys.up = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this._keys.down = true;
        break;
      case 'KeyR':
        this._boost = !this._boost;
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
      case 'Space':
        this._keys.up = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this._keys.down = false;
        break;
    }
  }
}
