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

  const polygon = (h) => {
    ds.entities.add({ polygon: { hierarchy: h, material: YELLOW().withAlpha(0.4), classificationType: BOTH() } });
    const ring = (positions) => positions.length > 1 && line([...positions, positions[0]], 4);
    ring(h.positions);
    for (const hole of h.holes ?? []) ring(hole.positions);
  };
  const point = (position) => {
    ds.entities.add({
      position,
      point: { pixelSize: 20, color: YELLOW().withAlpha(0.9), outlineColor: Cesium.Color.BLACK, outlineWidth: 3, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    });
  };

  function add(entity, now) {
    if (entity.polygon) {
      const h = entity.polygon.hierarchy?.getValue(now);
      if (h) polygon(h);
    } else if (entity.polyline) {
      const pos = entity.polyline.positions?.getValue(now);
      if (pos) line(pos, 6);
    } else if (entity.position) {
      const position = entity.position.getValue(now);
      if (position) point(position);
    }
  }

  /** GeoJSON 좌표([경도, 위도, …]들) → 지도 위 점들 (높이는 쓰지 않는다: 강조는 늘 지면에 붙인다) */
  const cartesians = (coords) => Cesium.Cartesian3.fromDegreesArray(coords.flatMap((c) => [c[0], c[1]]));

  /** GeoJSON 도형을 강조용 도형으로 그린다 (속성 표에서 행을 고를 때: 엔티티 없이 도형만으로) */
  function addGeometry(g) {
    if (!g) return;
    switch (g.type) {
      case 'Point':
        point(Cesium.Cartesian3.fromDegrees(g.coordinates[0], g.coordinates[1]));
        break;
      case 'MultiPoint':
        for (const c of g.coordinates) point(Cesium.Cartesian3.fromDegrees(c[0], c[1]));
        break;
      case 'LineString':
        line(cartesians(g.coordinates), 6);
        break;
      case 'MultiLineString':
        for (const c of g.coordinates) line(cartesians(c), 6);
        break;
      case 'Polygon':
        polygon(new Cesium.PolygonHierarchy(cartesians(g.coordinates[0]), g.coordinates.slice(1).map((r) => new Cesium.PolygonHierarchy(cartesians(r)))));
        break;
      case 'MultiPolygon':
        for (const p of g.coordinates) addGeometry({ type: 'Polygon', coordinates: p });
        break;
      case 'GeometryCollection':
        for (const x of g.geometries) addGeometry(x);
        break;
      default:
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

    /**
     * GeoJSON 도형을 강조한다. source(그 피처가 속한 데이터 소스)를 주면 그 레이어를 끄거나 지울 때 강조도 같이 없어진다.
     */
    showGeometry(geometry, dataSource = null) {
      this.clear();
      source = dataSource;
      ds.entities.suspendEvents();
      try {
        addGeometry(geometry);
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
