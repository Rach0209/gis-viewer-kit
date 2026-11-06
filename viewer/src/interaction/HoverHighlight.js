import { pickAt } from './Raycast.js';

/**
 * 커서 아래에 있는, PickableRegistry에 등록된 객체를 강조 표시한다.
 *
 * enable(viewer)/disable()만 노출하는 독립 모듈이다 -- registry만 바라보고
 * 어떤 레이어가, 어떤 모드(model/geo)로 그 객체를 만들었는지는 전혀 모른다.
 * 그래서 M1의 정적 RasterTileLayer에서 만들어도, M4의 동적 Tiles3DLayer로
 * 바뀌어도 이 파일은 손댈 필요가 없다.
 */
export class HoverHighlight {
  /**
   * @param {{color?: number, throttleMs?: number}} [options]
   *   throttleMs: pointermove 처리 최소 간격. 0(기본)이면 매 이벤트마다 raycast한다.
   *   타일이 많은 큰 데이터셋에서는 50 정도로 주면 호버 반응은 거의 그대로이면서 raycast 비용이 줄어든다.
   */
  constructor({ color = 0x3aa0ff, throttleMs = 0 } = {}) {
    this._throttleMs = throttleMs;
    this._lastMoveAt = -Infinity;
    this._color = color;
    this._hovered = null;
    this._originalHex = null;
    this._viewer = null;
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onUpdate = this._onUpdate.bind(this);
  }

  /** @param {import('../core/Viewer.js').Viewer} viewer */
  enable(viewer) {
    this._viewer = viewer;
    viewer.domElement.addEventListener('pointermove', this._onPointerMove);
    viewer.addUpdateCallback(this._onUpdate);
  }

  disable() {
    if (!this._viewer) return;
    this._viewer.domElement.removeEventListener('pointermove', this._onPointerMove);
    this._viewer.removeUpdateCallback(this._onUpdate);
    this._clearHover();
    this._viewer = null;
  }

  get hoveredObject() {
    return this._hovered;
  }

  /** @param {PointerEvent} event */
  _onPointerMove(event) {
    if (event.buttons !== 0) {
      // 마우스 버튼을 누른 채 드래그 중(카메라 회전/팬/줌)이면, 화면상 커서 좌표는
      // 그대로인데 그 아래 지오메트리는 프레임마다 바뀐다 -- 그때마다 호버 색이
      // 계속 바뀌면서 "반짝거리는" 것처럼 보인다. 드래그 중엔 호버 자체를 쉬게 한다.
      this._clearHover();
      return;
    }

    if (this._throttleMs > 0) {
      const now = performance.now();
      if (now - this._lastMoveAt < this._throttleMs) return;
      this._lastMoveAt = now;
    }

    const hit = pickAt(event.clientX, event.clientY, {
      camera: this._viewer.camera,
      domElement: this._viewer.domElement,
      registry: this._viewer.pickableRegistry,
    });

    const nextObject = hit?.object ?? null;
    if (nextObject === this._hovered) return;

    this._clearHover();
    if (nextObject) {
      this._applyHover(nextObject);
    }
  }

  /**
   * 매 프레임 확인한다: 하이라이트 중인 객체가 동적 LOD로 registry에서 빠졌는데
   * (예: 타일이 안 보이게 됨) 그 사이 마우스가 전혀 안 움직여서 pointermove로는
   * 못 알아챈 경우를 잡아낸다. 이게 없으면, 그 객체가 나중에 재사용되어 다시
   * 보이게 됐을 때 예전 하이라이트 색이 그대로 남아있을 수 있다.
   */
  _onUpdate() {
    if (this._hovered && !this._viewer.pickableRegistry.has(this._hovered)) {
      this._clearHover();
    }
  }

  /** @param {import('three').Object3D} object */
  _applyHover(object) {
    // 레이어마다 머티리얼 종류가 다르다 (RasterTileLayer는 MeshBasicMaterial,
    // 3D Tiles의 glTF는 보통 MeshStandardMaterial). emissive가 있으면 그쪽을,
    // 없으면 color를 바꾼다 -- 이 분기 덕분에 두 머티리얼 종류 모두에서
    // 코드 수정 없이 하이라이트가 동작한다.
    const material = object.material;
    if (!material || Array.isArray(material)) return; // 멀티 머티리얼은 아직 다루지 않음

    if (material.emissive) {
      this._originalHex = material.emissive.getHex();
      material.emissive.setHex(this._color);
    } else if (material.color) {
      this._originalHex = material.color.getHex();
      material.color.setHex(this._color);
    } else {
      return;
    }
    this._hovered = object;
  }

  _clearHover() {
    if (this._hovered && this._originalHex !== null) {
      const material = this._hovered.material;
      if (material?.emissive) material.emissive.setHex(this._originalHex);
      else if (material?.color) material.color.setHex(this._originalHex);
    }
    this._hovered = null;
    this._originalHex = null;
  }
}
