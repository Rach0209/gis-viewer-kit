/* global Cesium */
/**
 * 화면에 올라간 데이터(레이어) 목록. 종류가 달라도(3D Tiles, glb 모델, 벡터) 켜기/끄기, 이동, 삭제를 같은 방식으로 한다.
 * Cesium 객체는 `object` 로 들고 있고, `host`로 어느 컬렉션(primitives / dataSources)에 있는지 안다.
 */
export function createLayerStore(viewer, { memoStore = null } = {}) {
  let seq = 0;
  /** @type {Map<string, any>} */
  const layers = new Map();
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn(list()));

  const list = () => [...layers.values()].map(({ id, name, kind, visible, meta, style, memo }) => ({ id, name, kind, visible, meta, style: style ?? null, memo: memo ?? '' }));

  function applyVisible(layer) {
    layer.object.show = layer.visible;
  }

  return {
    list,
    get: (id) => layers.get(id),
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /**
     * @param {{name:string, kind:'tileset'|'model'|'vector'|'terrain'|'raster', object:any, host:'primitives'|'dataSources'|'terrain'|'imagery', meta?:object}} o
     */
    add({ name, kind, object, host, meta = {}, dispose = null, style = null, data = null }) {
      const id = `${kind}-${++seq}`;
      const layer = { id, name, kind, object, host, visible: true, meta, dispose, style, data, memo: memoStore?.load(kind, name) ?? '' };
      layers.set(id, layer);
      notify();
      return layer;
    },

    /** 스타일(SLD 적용 결과)을 바꾸거나(null이면 해제) 알린다 */
    setStyle(id, style) {
      const layer = layers.get(id);
      if (!layer) return;
      layer.style = style;
      notify();
    },

    /** 레이어 메모를 바꾼다 (이 브라우저에 저장). 입력 중에는 목록을 다시 그리지 않는다. */
    setMemo(id, text) {
      const layer = layers.get(id);
      if (!layer) return;
      layer.memo = String(text ?? '');
      memoStore?.save(layer.kind, layer.name, layer.memo);
    },

    /** 목록은 그대로 두고 화면만 다시 그리게 한다 (범례 열기/닫기, 규칙 켜기/끄기) */
    refresh: () => notify(),

    setVisible(id, visible) {
      const layer = layers.get(id);
      if (!layer) return;
      layer.visible = !!visible;
      applyVisible(layer);
      notify();
    },

    /**
     * 벡터 레이어의 지도 위 도형(데이터 소스)을 새것으로 바꿔 끼운다. 새 데이터 소스는 이미 viewer.dataSources 에 올려 둔 것이어야 한다.
     * 켜기/끄기, 메모, 원본 자료(data)는 그대로이고 옛 도형은 지운다 (강조 중이던 피처의 강조도 풀린다).
     * @param {string} id
     * @param {any} object 새 데이터 소스
     * @param {{meta?:object, style?:object|null}} [patch]
     */
    replaceObject(id, object, patch = {}) {
      const layer = layers.get(id);
      if (!layer || layer.host !== 'dataSources') return false;
      const old = layer.object;
      layer.object = object;
      if (patch.meta) layer.meta = patch.meta;
      if ('style' in patch) layer.style = patch.style;
      applyVisible(layer);
      viewer.dataSources.remove(old, true);
      notify();
      return true;
    },

    /** 모든 레이어를 한꺼번에 켜거나 끈다 (목록은 한 번만 다시 그린다) */
    setAllVisible(visible) {
      for (const layer of layers.values()) {
        layer.visible = !!visible;
        applyVisible(layer);
      }
      notify();
    },

    remove(id) {
      const layer = layers.get(id);
      if (!layer) return;
      if (layer.host === 'dataSources') viewer.dataSources.remove(layer.object, true);
      else if (layer.host === 'imagery') viewer.imageryLayers.remove(layer.object, true); // 항공사진 같은 이미지 레이어
      else if (layer.host === 'terrain') layer.object.show = false; // 지형은 컬렉션이 아니라 평평한 지구로 되돌리는 것이 "지우기"
      else viewer.scene.primitives.remove(layer.object);
      layers.delete(id);
      try {
        layer.dispose?.(); // 폴더 연결 해제, 임시 주소 반납 등
      } finally {
        notify();
      }
    },

    zoomTo(id) {
      const layer = layers.get(id);
      if (!layer) return undefined;
      if (layer.kind === 'terrain') return layer.object.flyTo();
      if (layer.kind === 'raster') {
        const [w, s, e, n] = layer.meta.extent;
        return viewer.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(w, s, e, n), duration: 0.8 });
      }
      if (layer.kind === 'model') {
        // viewer.zoomTo는 Model(원시 객체)을 지원하지 않아 경계 구로 직접 이동한다
        const sphere = layer.object.boundingSphere;
        const range = Math.max(sphere.radius * 4, 60);
        return new Promise((resolve) => {
          viewer.camera.flyToBoundingSphere(sphere, {
            duration: 0.8,
            offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), range),
            complete: () => resolve(true),
            cancel: () => resolve(false),
          });
        });
      }
      return viewer.zoomTo(layer.object);
    },

    clear() {
      for (const id of [...layers.keys()]) this.remove(id);
    },
  };
}
