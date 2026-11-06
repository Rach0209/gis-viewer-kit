/* global Cesium */
/**
 * 클릭한 벡터 피처를 눈에 띄게 표시한다. 원래 도형은 건드리지 않고, 그 위에 강조용 도형을 따로 얹는다.
 *  - 면: 반투명 노란 채우기 + 검정 바탕 위 노란 테두리 (구멍도 테두리)
 *  - 선: 검정 바탕 위 굵은 노란 선
 *  - 점: 검정 테두리의 큰 노란 점
 * 어떤 배경색·SLD 색 위에서도 보이도록 검정 바탕선을 깐다. 모두 지면에 붙인다.
 *
 * MultiPolygon은 Cesium에서 조각마다 엔티티가 따로 생기므로, 같은 데이터 소스에서 속성이 똑같은 조각은 함께 강조한다.
 */
import { entityProperties } from './vectorLayer.js';

const YELLOW = () => Cesium.Color.fromCssColorString('#ffe600');
const BOTH = () => Cesium.ClassificationType.BOTH;

const signature = (entity) => JSON.stringify(entityProperties(entity));
const kindOf = (e) => (e.polygon ? 'polygon' : e.polyline ? 'polyline' : e.billboard || e.point ? 'point' : null);

export function createHighlighter(viewer) {
  const ds = new Cesium.CustomDataSource('highlight');
  viewer.dataSources.add(ds);
  let source = null; // 강조 중인 피처가 속한 데이터 소스

  const line = (positions, width) => {
    ds.entities.add({ polyline: { positions, width: width + 4, clampToGround: true, material: Cesium.Color.BLACK.withAlpha(0.85), classificationType: BOTH() } });
    ds.entities.add({ polyline: { positions, width, clampToGround: true, material: YELLOW(), classificationType: BOTH() } });
  };

  function add(entity, now) {
    if (entity.polygon) {
      const h = entity.polygon.hierarchy?.getValue(now);
      if (!h) return;
      ds.entities.add({ polygon: { hierarchy: h, material: YELLOW().withAlpha(0.4), classificationType: BOTH() } });
      const ring = (positions) => positions.length > 1 && line([...positions, positions[0]], 4);
      ring(h.positions);
      for (const hole of h.holes ?? []) ring(hole.positions);
    } else if (entity.polyline) {
      const pos = entity.polyline.positions?.getValue(now);
      if (pos) line(pos, 6);
    } else if (entity.position) {
      const position = entity.position.getValue(now);
      if (position) {
        ds.entities.add({
          position,
          point: { pixelSize: 20, color: YELLOW().withAlpha(0.9), outlineColor: Cesium.Color.BLACK, outlineWidth: 3, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        });
      }
    }
  }

  return {
    /** 강조용 엔티티인지 (클릭 판정에서 빼기 위해) */
    owns: (entity) => entity?.entityCollection === ds.entities,

    /** 이 피처(와 같은 피처의 다른 조각)를 강조한다 */
    show(entity) {
      this.clear();
      const kind = kindOf(entity);
      if (!kind) return;
      const now = Cesium.JulianDate.now();
      source = entity.entityCollection?.owner ?? null;
      ds.entities.suspendEvents();
      try {
        add(entity, now);
        if (kind === 'polygon' && source) {
          // 같은 피처의 다른 조각: 속성이 똑같은 면
          const sig = signature(entity);
          if (sig !== '[]') for (const other of source.entities.values) if (other !== entity && other.polygon && other.show && signature(other) === sig) add(other, now);
        }
      } finally {
        ds.entities.resumeEvents();
      }
    },

    clear() {
      ds.entities.removeAll();
      source = null;
    },

    /** 강조 중인 데이터 소스가 지워졌거나 숨겨졌으면 강조를 없앤다 */
    validate() {
      if (!source) return;
      if (!viewer.dataSources.contains(source) || !source.show) this.clear();
    },
  };
}
