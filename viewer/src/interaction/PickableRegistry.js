/**
 * 레이어가 만들었다가 언젠가 없앨 메시들을 등록/해제하는 공유 저장소.
 *
 * 3D Tiles는 동적 LOD 때문에 화면에 무엇이 떠 있는지가 실시간으로 바뀐다
 * (카메라 거리, 화면 크기, 네트워크 속도에 따라 메시가 생성/파괴됨).
 * 그래서 HoverHighlight/ClickPopup 같은 상호작용 모듈은 "지금 이 순간 실제로
 * 존재하는" 대상만 다뤄야 하고, 이 목록을 프레임 간에 캐싱하면 안 된다 --
 * 캐싱하면 이미 dispose된 메시를 raycast하게 되거나, 화면에서 사라진 타일이
 * 계속 하이라이트된 것처럼 보이는 버그로 이어진다. 그래서 getAll()은 항상
 * 그 순간의 상태를 매번 새로 계산해서 돌려준다 (내부 Map을 그대로 캐싱해 쓰지 않음).
 */
export class PickableRegistry {
  constructor() {
    /** @type {Map<import('three').Object3D, {metadata: Object, layerId: string}>} */
    this._entries = new Map();
  }

  /**
   * @param {import('three').Object3D} object3d
   * @param {Object} metadata - 클릭/호버 시 보여줄 정보 (예: {z,x,y,layerId})
   * @param {string} layerId - unregisterByLayer로 일괄 해제할 때 쓰는 소속 레이어 id
   */
  register(object3d, metadata, layerId) {
    this._entries.set(object3d, { metadata, layerId });
  }

  /** @param {import('three').Object3D} object3d */
  unregister(object3d) {
    this._entries.delete(object3d);
  }

  /** 레이어 전체가 제거될 때(onRemove) 그 레이어가 등록한 모든 객체를 한 번에 해제한다. */
  /** @param {string} layerId */
  unregisterByLayer(layerId) {
    for (const [object3d, entry] of this._entries) {
      if (entry.layerId === layerId) {
        this._entries.delete(object3d);
      }
    }
  }

  /** @param {import('three').Object3D} object3d */
  has(object3d) {
    return this._entries.has(object3d);
  }

  /**
   * 등록된 모든 객체를 배열로 반환한다. 호출부는 이 결과를 다음 프레임까지
   * 들고 있으면 안 되고, 필요할 때마다 다시 호출해야 한다.
   * @returns {import('three').Object3D[]}
   */
  getAll() {
    return Array.from(this._entries.keys());
  }

  /** @param {import('three').Object3D} object3d */
  getMetadata(object3d) {
    return this._entries.get(object3d)?.metadata;
  }

  clear() {
    this._entries.clear();
  }
}
