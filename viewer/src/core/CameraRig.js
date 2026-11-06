import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { computePanClampDelta } from './panClamp.js';

/**
 * 뷰 모드(모델 모드/지리참조 모드)에 따라 내부적으로 다른 three.js 컨트롤을
 * 사용하지만, 바깥에는 동일한 인터페이스(setBounds/fitTo/update/dispose)만
 * 노출한다. 이 덕분에 main.js나 레이어 코드는 "지금 OrbitControls를 쓰는지
 * MapControls를 쓰는지"를 몰라도 된다.
 */
export class CameraRig {
  /**
   * @param {THREE.Camera} camera
   * @param {HTMLElement} domElement
   * @param {'orbit'|'map'} [mode] - 'orbit': 자유 회전(모델 모드), 'map': 팬/줌 위주 + 이동 범위 제한(지리참조 모드)
   */
  constructor(camera, domElement, mode = 'orbit') {
    this._camera = camera;
    this._mode = mode;

    // 'map' 모드에서만 setBounds()로 채워지는 값들.
    this._maxPanDistance = null;
    this._panCenter = null;

    this._controls =
      mode === 'map' ? new MapControls(camera, domElement) : new OrbitControls(camera, domElement);

    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.08;
  }

  get controls() {
    return this._controls;
  }

  get mode() {
    return this._mode;
  }

  /**
   * 카메라가 이동할 수 있는 범위를 제한한다. 'model' 모드에서는 자유롭게 돌려보는 것이
   * 목적이므로 아무 효과가 없고, 'map' 모드(지리참조)에서 사용자가 데이터 영역
   * 밖으로 한없이 팬 하는 것을 막을 때 쓴다.
   * @param {THREE.Box3} box
   */
  setBounds(box) {
    if (this._mode !== 'map') return;
    this._panCenter = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this._maxPanDistance = Math.max(size.x, size.z) * 0.75;
  }

  /**
   * 대상의 bounding box 전체가 화면에 들어오도록 카메라를 자동 배치한다.
   * 모델 모드에서는 데이터를 로드한 직후 "화면 중앙에 맞춰 보여주기" 용도로,
   * 지리참조 모드에서는 특정 레이어로 즉시 이동("zoom to layer")하는 용도로 쓴다.
   * @param {THREE.Box3} box
   */
  fitTo(box) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    const fov = (this._camera.fov * Math.PI) / 180;
    // 1.5배 여유를 두어 대상이 화면 가장자리에 딱 붙지 않게 한다.
    const distance = ((maxDim / 2) / Math.tan(fov / 2)) * 1.5;

    this._camera.position.set(
      center.x + distance * 0.6,
      center.y + distance * 0.6,
      center.z + distance * 0.6
    );
    this._controls.target.copy(center);

    // near/far를 대상 크기에 맞게 재조정하지 않으면, 아주 작거나 아주 큰
    // 데이터셋(예: 건물 하나 vs 도시 전체)에서 클리핑이 발생할 수 있다.
    this._camera.near = Math.max(distance / 1000, 0.01);
    this._camera.far = distance * 100;
    this._camera.updateProjectionMatrix();
    this._controls.update();
  }

  /** @param {number} dt */
  update(dt) {
    this._controls.update(dt);
    if (this._mode === 'map' && this._maxPanDistance != null) {
      this._clampPan();
    }
  }

  // MapControls 자체에는 "중심점 기준 반경 제한" 기능이 없어 직접 구현한다.
  // 실제 클램프 수학은 panClamp.js의 순수 함수로 뽑아뒀다(단위 테스트 대상).
  _clampPan() {
    const target = this._controls.target;
    const { deltaX, deltaZ } = computePanClampDelta({
      targetX: target.x,
      targetZ: target.z,
      centerX: this._panCenter.x,
      centerZ: this._panCenter.z,
      maxDistance: this._maxPanDistance,
    });
    if (deltaX === 0 && deltaZ === 0) return;

    target.x += deltaX;
    target.z += deltaZ;
    this._camera.position.x += deltaX;
    this._camera.position.z += deltaZ;
  }

  dispose() {
    this._controls.dispose();
  }
}
