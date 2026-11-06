import * as THREE from 'three';
import { pickAt } from './Raycast.js';
import { onDragAwareClick } from './dragAwareClick.js';
import { updateMarkerVisibilityByScreenSize } from '../layers/markerScreenSize.js';

// POI(15)보다 작게 잡는다 -- 측정 지점은 "정확한 위치 표시"가 목적이지 존재감을
// 뽐낼 필요는 없다. (2026-08-11: 실사용해보니 5도 크다는 피드백을 받아 3으로 축소.)
const POINT_MARKER_RADIUS = 3;
const MEASURE_COLOR = 0xffdd33;

/**
 * 클릭한 여러 점을 순서대로 이어 꺾인 선(폴리라인)으로 표시하고, 구간별/누적 거리를 잰다.
 *
 * enable(viewer) 이후 클릭할 때마다 지금 그리는 폴리라인에 점이 하나씩 늘어난다(2점으로
 * 끝나는 게 아니라 계속 이어짐) -- 평평하지 않은 표면을 따라 점을 여러 개 찍으면
 * 직선 하나로 재는 것보다 실제 표면 경로에 더 가깝게 잴 수 있다. disable() 시점에
 * 지금 그리던 폴리라인을 "완료"로 취급하고, 다음 enable()은 새 폴리라인을 시작한다.
 * clearAll()로 지금까지 그린 모든 폴리라인을 한꺼번에 지운다.
 *
 * 클릭은 네이티브 'click'이 아니라 dragAwareClick으로 받는다 -- 카메라를 드래그해서
 * 회전/틸트하는 제스처의 끝에서도 'click'이 발생해, 화면을 돌리려던 동작이 측정
 * 점 찍기로 오인되는 문제가 있었다.
 *
 * ClickPopup/HoverHighlight와 마찬가지로 PickableRegistry만 바라보는 독립 모듈이다.
 * 빈 공간 클릭(hit 없음)은 무시한다 -- 측정 중 실수로 빗나간 클릭이 진행 중이던
 * 폴리라인을 끊어버리면 안 되기 때문이다.
 */
export class MeasureTool {
  /** @param {{unitLabel?: string}} [options] - 거리 라벨에 붙일 단위. 기본 'm'(지리참조 모드 기준) */
  constructor({ unitLabel = 'm' } = {}) {
    this._unitLabel = unitLabel;
    this._viewer = null;
    this._removeDragAwareClick = null;
    /**
     * @typedef {{
     *   points: THREE.Vector3[],
     *   markers: THREE.Mesh[],
     *   segments: THREE.Line[],
     *   segmentLabels: HTMLElement[],
     *   totalLabel: HTMLElement|null,
     * }} Polyline
     * @type {Polyline|null} 지금 이어서 찍는 중인 폴리라인. disable() 시 null로 리셋.
     */
    this._current = null;
    /** @type {Polyline[]} */
    this._polylines = [];
  }

  /** @param {import('../core/Viewer.js').Viewer} viewer */
  enable(viewer) {
    this._viewer = viewer;
    this._removeDragAwareClick = onDragAwareClick(viewer.domElement, (event) => this._onClick(event));
  }

  disable() {
    if (!this._removeDragAwareClick) return;
    this._removeDragAwareClick();
    this._removeDragAwareClick = null;
    this._current = null; // 다음 enable()은 새 폴리라인부터 시작
    // this._viewer는 여기서 null로 지우지 않는다 -- 도구를 꺼도 이미 그려둔 측정선/
    // 라벨은 화면에 남아 있고(그게 의도한 동작), update()가 계속 카메라를 따라 그
    // 화면 좌표를 갱신해야 한다. 예전엔 여기서 null로 지워서, 도구를 끄고 화면을
    // 움직이면 라벨이 카메라를 안 따라가고 화면에 박제된 채 남는 버그가 있었다
    // (2026-08-11 실사용 중 발견).
  }

  /** 지금까지 그려둔 폴리라인(선/마커/라벨)을 전부 지운다. */
  clearAll() {
    for (const poly of this._polylines) {
      for (const marker of poly.markers) {
        marker.geometry.dispose();
        marker.material.dispose();
        marker.removeFromParent();
      }
      for (const line of poly.segments) {
        line.geometry.dispose();
        line.material.dispose();
        line.removeFromParent();
      }
      for (const label of poly.segmentLabels) label.remove();
      poly.totalLabel?.remove();
    }
    this._polylines = [];
    this._current = null;
  }

  dispose() {
    this.clearAll();
    this.disable();
  }

  /**
   * 매 프레임 호출: 라벨은 DOM 엘리먼트라 카메라가 움직일 때마다 화면 좌표를 다시
   * 계산해야 하고, 점 마커도 너무 멀어지면(화면에서 몇 px 이하) 숨겨서 지저분해
   * 보이지 않게 한다(markerScreenSize.js와 같은 방식, POI/메모 마커 참고).
   * @param {import('three').Camera} camera
   */
  update(camera) {
    if (!this._viewer) return;
    const viewportHeightPx = this._viewer.renderer.domElement.clientHeight;
    for (const poly of this._polylines) {
      updateMarkerVisibilityByScreenSize(poly.markers, POINT_MARKER_RADIUS, camera, viewportHeightPx);
      for (let i = 0; i < poly.segments.length; i++) {
        this._updateLabelPosition(poly.segmentLabels[i], this._segmentMidpoint(poly, i));
      }
      if (poly.totalLabel && poly.points.length > 0) {
        this._updateLabelPosition(poly.totalLabel, poly.points[poly.points.length - 1]);
      }
    }
  }

  /** @param {PointerEvent} event */
  _onClick(event) {
    const hit = pickAt(event.clientX, event.clientY, {
      camera: this._viewer.camera,
      domElement: this._viewer.domElement,
      registry: this._viewer.pickableRegistry,
    });
    if (!hit) return;
    this._addPoint(hit.point.clone());
  }

  /** @param {THREE.Vector3} point */
  _addPoint(point) {
    if (!this._current) {
      this._current = { points: [], markers: [], segments: [], segmentLabels: [], totalLabel: null };
      this._polylines.push(this._current);
    }
    const poly = this._current;

    const marker = this._createPointMarker(point);
    this._viewer.scene.add(marker);
    poly.markers.push(marker);

    if (poly.points.length > 0) {
      const prev = poly.points[poly.points.length - 1];
      const segmentDistance = prev.distanceTo(point);

      const line = this._createSegmentLine(prev, point);
      this._viewer.scene.add(line);
      poly.segments.push(line);
      poly.segmentLabels.push(this._createLabel(`${segmentDistance.toFixed(2)} ${this._unitLabel}`, MEASURE_COLOR));

      // 두 번째 점을 찍어 첫 구간이 막 생긴 시점부터 누적 거리 라벨도 같이 보여준다.
      if (!poly.totalLabel) {
        poly.totalLabel = this._createLabel('', '#ffffff', true);
      }
    }

    poly.points.push(point);

    if (poly.totalLabel) {
      poly.totalLabel.textContent = `합계: ${this._totalDistance(poly).toFixed(2)} ${this._unitLabel}`;
    }

    this.update(this._viewer.camera); // 새로 만든 라벨/마커를 바로 올바른 위치/가시성으로 맞춘다
  }

  /** @param {import('./MeasureTool.js').Polyline} poly */
  _totalDistance(poly) {
    let total = 0;
    for (let i = 1; i < poly.points.length; i++) {
      total += poly.points[i - 1].distanceTo(poly.points[i]);
    }
    return total;
  }

  _segmentMidpoint(poly, index) {
    return poly.points[index].clone().add(poly.points[index + 1]).multiplyScalar(0.5);
  }

  /** @param {THREE.Vector3} point */
  _createPointMarker(point) {
    const geometry = new THREE.SphereGeometry(POINT_MARKER_RADIUS, 12, 12);
    // depthTest:false + 높은 renderOrder -- 타일 표면에 파묻혀 안 보이는 z-fighting을
    // 피하고, 측정 결과 확인이 우선이니 항상 위에 그려지게 한다(선과 동일한 처리).
    const material = new THREE.MeshBasicMaterial({ color: MEASURE_COLOR, depthTest: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(point);
    mesh.renderOrder = 999;
    return mesh;
  }

  /** @param {THREE.Vector3} from @param {THREE.Vector3} to */
  _createSegmentLine(from, to) {
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    const material = new THREE.LineBasicMaterial({ color: MEASURE_COLOR, depthTest: false });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 999;
    return line;
  }

  _createLabel(text, color, bold = false) {
    const label = document.createElement('div');
    label.className = 'measure-label';
    label.textContent = text;
    Object.assign(label.style, {
      position: 'fixed',
      padding: '2px 6px',
      borderRadius: '3px',
      background: 'rgba(20,22,26,0.85)',
      color: typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : color,
      fontWeight: bold ? 'bold' : 'normal',
      font: '12px system-ui, sans-serif',
      pointerEvents: 'none',
      zIndex: '15',
      transform: 'translate(-50%, -50%)',
      display: 'none',
    });
    document.body.appendChild(label);
    return label;
  }

  _updateLabelPosition(label, worldPoint) {
    const ndc = worldPoint.clone().project(this._viewer.camera);
    // ndc.z > 1이면 카메라 뒤쪽(화면 밖)이라 라벨을 숨긴다.
    if (ndc.z > 1) {
      label.style.display = 'none';
      return;
    }
    const rect = this._viewer.domElement.getBoundingClientRect();
    label.style.display = 'block';
    label.style.left = `${rect.left + ((ndc.x + 1) / 2) * rect.width}px`;
    label.style.top = `${rect.top + ((1 - ndc.y) / 2) * rect.height}px`;
  }
}
