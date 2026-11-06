import * as THREE from 'three';

/**
 * @typedef {Object} TileLayer
 * @property {string} id
 * @property {THREE.Object3D} object3d
 * @property {(viewer: import('../core/Viewer.js').Viewer) => void} onAdd
 * @property {(viewer: import('../core/Viewer.js').Viewer) => void} onRemove
 * @property {(camera: THREE.Camera, dt: number) => void} update
 * @property {() => void} dispose
 */

/**
 * TileLayer 계약의 no-op 기본 구현. 구체 레이어(RasterTileLayer, Tiles3DLayer 등)는
 * 이 클래스를 상속해 필요한 메서드만 오버라이드한다.
 *
 * 엄격한 인터페이스 대신 "덕타이핑 + 위 JSDoc @typedef" 조합을 쓰는 이유:
 * 지금은 TypeScript가 아니라서 진짜 interface를 쓸 수 없고, 나중에 TS로 옮길 때
 * 이 @typedef가 거의 그대로 TS type이 되도록 준비해두기 위함이다.
 */
export class LayerBase {
  /** @param {string} id */
  constructor(id) {
    this.id = id;
    this.object3d = new THREE.Group();
    this.object3d.name = `layer:${id}`;
  }

  /**
   * 레이어가 LayerManager에 추가될 때 한 번 호출된다. 실제 데이터 로딩은 여기서 시작한다.
   * @param {import('../core/Viewer.js').Viewer} viewer
   */
  onAdd(viewer) {}

  /**
   * 레이어가 제거되기 직전에 호출된다. PickableRegistry 등록 해제 등을 여기서 한다.
   * @param {import('../core/Viewer.js').Viewer} viewer
   */
  onRemove(viewer) {}

  /**
   * 매 프레임 호출된다 (LayerManager 경유). 3D Tiles처럼 프레임마다 갱신이 필요한 레이어가 사용한다.
   * @param {THREE.Camera} camera
   * @param {number} dt
   */
  update(camera, dt) {}

  /** geometry/material/texture 등 GPU 리소스를 해제한다. */
  dispose() {}

  /**
   * 이 레이어가 카메라 기반으로 LOD/로딩을 결정하는 경우(예: Tiles3DLayer), 메인
   * 카메라 외에 "보조 카메라"도 같이 등록해 그 카메라 기준으로도 필요한 콘텐츠를
   * 챙기게 한다. 미니맵의 실시간 탑다운 렌더(MinimapTileRenderer.js)가 이걸 써서
   * 타일 레이어에 위에서 내려다보는 직교 카메라를 추가로 등록한다.
   *
   * 카메라 개념이 없는 레이어(POI, 래스터 등)에는 의미가 없으니 기본은 아무것도
   * 안 한다 -- 호출하는 쪽(main.js/MinimapTileRenderer)이 매번 "이 레이어가 이걸
   * 지원하나?" 검사하지 않아도 되게, LayerBase 기본 구현을 no-op으로 둔다.
   * @param {THREE.Camera} camera
   * @param {import('three').WebGLRenderer} renderer
   */
  registerAuxCamera(camera, renderer) {}

  /** @param {THREE.Camera} camera */
  unregisterAuxCamera(camera) {}
}
