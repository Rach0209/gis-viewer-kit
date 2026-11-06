import { pickAt } from './Raycast.js';
import { onDragAwareClick } from './dragAwareClick.js';
import { AnnotationInputPopup } from './AnnotationInputPopup.js';

/**
 * "메모 추가" 모드가 켜져 있는 동안 모델 표면을 클릭하면 짧은 텍스트를 입력받아
 * 그 지점에 마커로 남긴다.
 *
 * 실제 마커 생성/렌더링/PickableRegistry 등록은 AnnotationLayer가 담당하고, 이
 * 클래스는 "클릭 -> 좌표 -> 텍스트 입력 -> 레이어에 위임"만 한다. 클릭은 네이티브
 * 'click'이 아니라 dragAwareClick으로 받는다(카메라 드래그 제스처가 클릭으로
 * 오인되는 문제 방지, MeasureTool과 동일한 이유). 텍스트 입력은 window.prompt() 대신
 * AnnotationInputPopup(비블로킹 인라인 폼)을 쓴다 -- prompt()는 열려 있는 동안
 * 페이지 실행을 멈춰서 진행 중이던 카메라 드래그가 못 끝나고 멈춰버리는 문제가 있었다.
 */
export class AnnotationTool {
  /**
   * @param {import('../layers/AnnotationLayer.js').AnnotationLayer} annotationLayer
   * @param {{onAdded?: () => void}} [options] - 메모가 실제로 추가될 때마다 호출(예: 저장 트리거)
   */
  constructor(annotationLayer, { onAdded } = {}) {
    this._annotationLayer = annotationLayer;
    this._onAdded = onAdded;
    this._viewer = null;
    this._removeDragAwareClick = null;
    this._inputPopup = new AnnotationInputPopup();
    this._onClick = this._onClick.bind(this);
  }

  /** @param {import('../core/Viewer.js').Viewer} viewer */
  enable(viewer) {
    this._viewer = viewer;
    this._removeDragAwareClick = onDragAwareClick(viewer.domElement, this._onClick);
  }

  disable() {
    if (!this._viewer) return;
    this._removeDragAwareClick();
    this._removeDragAwareClick = null;
    this._viewer = null;
  }

  dispose() {
    this.disable();
    this._inputPopup.dispose();
  }

  /** @param {PointerEvent} event */
  async _onClick(event) {
    const hit = pickAt(event.clientX, event.clientY, {
      camera: this._viewer.camera,
      domElement: this._viewer.domElement,
      registry: this._viewer.pickableRegistry,
    });
    if (!hit) return;

    const text = await this._inputPopup.show({ x: event.clientX, y: event.clientY });
    if (!text) return; // 취소하거나 빈 텍스트면 마커를 만들지 않는다

    this._annotationLayer.addAnnotation(hit.point, text);
    this._onAdded?.();
  }
}
