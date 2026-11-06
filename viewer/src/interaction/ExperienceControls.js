import { WalkControls } from './WalkControls.js';
import { AerialControls } from './AerialControls.js';

/**
 * "체험 모드" 하나로 1인칭(WalkControls, 포인터 락 + 바닥 따라가기 + 점프)과
 * 3인칭/항공(AerialControls, 드래그로 시점 회전 + 자유 비행) 두 가지를 묶어서,
 * Tab으로 그 자리에서 바로 전환할 수 있게 한다.
 *
 * 나중에 glb 건물 모델(내부까지 있는 경우)을 디지털 트윈처럼 걸어다니며 살펴보는
 * 용도로는 1인칭이 필요하고, 건물 전체를 넓게 훑어보거나 포인터 락 UX가 부담스러운
 * 경우엔 3인칭/항공이 더 편해서 -- 둘 다 남겨두고 Tab으로만 오가게 했다
 * (2026-08-12, 1인칭 단독으로는 UX가 어렵다는 피드백 이후).
 */
export class ExperienceControls {
  /** @param {THREE.PerspectiveCamera} camera @param {HTMLElement} domElement */
  constructor(camera, domElement) {
    this._walk = new WalkControls(camera, domElement);
    this._aerial = new AerialControls(camera, domElement);
    this._personMode = 'first'; // 'first' | 'third'
    this._viewer = null;
  }

  get personMode() {
    return this._personMode;
  }

  /**
   * @param {import('../core/Viewer.js').Viewer} viewer
   * @param {{x:number,y:number,z:number}} [startPosition] - StartPositionPicker로 고른 시작 지점.
   *   생략하면 WalkControls가 지금 카메라 위치 바로 아래 지면을 대신 찾는다.
   */
  enable(viewer, startPosition) {
    this._viewer = viewer;
    this._current().enable(viewer, startPosition);
  }

  disable() {
    if (!this._viewer) return;
    this._current().disable();
    this._viewer = null;
  }

  dispose() {
    this._walk.dispose();
    this._aerial.dispose();
  }

  /** @param {number} dt */
  update(dt) {
    if (!this._viewer) return;
    this._current().update(dt);
  }

  /** Tab 키에 연결. 지금 위치/시점을 그대로 들고 다른 인칭으로 넘어간다(카메라 객체를 공유하므로). */
  togglePersonMode() {
    if (!this._viewer) return;
    const viewer = this._viewer;
    this._current().disable();
    this._personMode = this._personMode === 'first' ? 'third' : 'first';
    this._current().enable(viewer);
  }

  _current() {
    return this._personMode === 'first' ? this._walk : this._aerial;
  }
}
