import { pickAt } from './Raycast.js';
import { onDragAwareClick } from './dragAwareClick.js';

/**
 * "체험 모드" 진입 시 시작 위치를 고르는 1회성 클릭 대기 상태.
 *
 * 버튼을 눌러도 곧바로 1인칭으로 뛰어들지 않고, 이 상태로 먼저 넘어간다 -- 오빗/맵
 * 카메라는 그대로 살아있어서(cameraRig를 안 건드림) 평소처럼 돌려보며 원하는 지점을
 * 찾은 뒤 클릭하면 그 지점에서 체험 모드가 시작된다. 빈 공간 클릭은 무시하고 계속
 * 대기한다(다른 클릭 도구들과 같은 관례). 표면을 한 번 클릭하면 콜백을 호출하고
 * 스스로 disable()되는 1회용 도구다.
 */
export class StartPositionPicker {
  constructor() {
    this._viewer = null;
    this._removeDragAwareClick = null;
    this._onPick = null;
  }

  /**
   * @param {import('../core/Viewer.js').Viewer} viewer
   * @param {(point: import('three').Vector3) => void} onPick
   */
  enable(viewer, onPick) {
    this._viewer = viewer;
    this._onPick = onPick;
    this._removeDragAwareClick = onDragAwareClick(viewer.domElement, (event) => this._onClick(event));
  }

  disable() {
    if (!this._viewer) return;
    this._removeDragAwareClick();
    this._removeDragAwareClick = null;
    this._onPick = null;
    this._viewer = null;
  }

  /** @param {PointerEvent} event */
  _onClick(event) {
    const hit = pickAt(event.clientX, event.clientY, {
      camera: this._viewer.camera,
      domElement: this._viewer.domElement,
      registry: this._viewer.pickableRegistry,
    });
    if (!hit) return; // 빈 공간 클릭은 무시하고 계속 대기한다

    const onPick = this._onPick;
    const point = hit.point.clone();
    this.disable();
    onPick(point);
  }
}
