/**
 * 여러 TileLayer(LayerBase 구현체)를 한 곳에서 추가/제거/업데이트/정리한다.
 *
 * Viewer는 LayerManager의 존재를 몰라도 되도록, LayerManager가 생성 시점에
 * viewer.addUpdateCallback으로 자기 자신의 updateAll을 등록해 매 프레임 실행되게 한다.
 * 즉 Viewer -> LayerManager 방향의 의존은 없고, LayerManager -> Viewer 방향만 있다.
 */
export class LayerManager {
  /** @param {import('../core/Viewer.js').Viewer} viewer */
  constructor(viewer) {
    this._viewer = viewer;
    /** @type {Map<string, import('./LayerBase.js').LayerBase>} */
    this._layers = new Map();
    this._boundUpdate = (camera, dt) => this.updateAll(camera, dt);
    viewer.addUpdateCallback(this._boundUpdate);
  }

  /** @param {import('./LayerBase.js').LayerBase} layer */
  add(layer) {
    if (this._layers.has(layer.id)) {
      throw new Error(`Layer id already exists: ${layer.id}`);
    }
    // onAdd()를 등록/씬 추가보다 먼저 호출한다 -- onAdd가 던지면(예: 잘못된
    // placement 설정) 아무것도 등록되지 않은 채 깨끗하게 실패하고, 절반만
    // 추가된 "좀비" 레이어가 남지 않는다.
    layer.onAdd(this._viewer);
    this._layers.set(layer.id, layer);
    this._viewer.scene.add(layer.object3d);
  }

  /** @param {string} id */
  remove(id) {
    const layer = this._layers.get(id);
    if (!layer) return;
    layer.onRemove(this._viewer);
    this._viewer.scene.remove(layer.object3d);
    layer.dispose();
    this._layers.delete(id);
  }

  /** @param {string} id */
  get(id) {
    return this._layers.get(id);
  }

  getAll() {
    return Array.from(this._layers.values());
  }

  /**
   * @param {import('three').Camera} camera
   * @param {number} dt
   */
  updateAll(camera, dt) {
    for (const layer of this._layers.values()) {
      layer.update(camera, dt);
    }
  }

  disposeAll() {
    for (const id of Array.from(this._layers.keys())) {
      this.remove(id);
    }
    this._viewer.removeUpdateCallback(this._boundUpdate);
  }
}
