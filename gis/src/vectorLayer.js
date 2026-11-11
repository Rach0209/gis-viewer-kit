/* global Cesium */
/** WGS84 GeoJSON(vectorParse.js의 결과)을 Cesium 데이터 소스로 만든다. 지면과 3D 타일 위에 붙여서(clamp/classify) 그린다. */
import { labelText, parseColor, pickRule, ruleActiveAtScale } from './sld.js';
import { shiftHeights, stripHeights } from './geomHeights.js';
import { dashToCesium, lineMidpoint, polygonLabelPoint } from './geomLabel.js';
import { DEFAULT_POINT_STYLE, normalizePointStyle, pointStyleSpec } from './pointStyles.js';

const toCesiumColor = (hex, opacity) => {
  const c = parseColor(hex, opacity);
  return c ? new Cesium.Color(c.r, c.g, c.b, c.a) : null;
};

/** 스타일을 입힐 때 만든 보조 도형(테두리 선, 글자)인가. 그 도형을 만든 원래 피처 엔티티를 가리킨다 (e.__companion). */
export const isCompanion = (e) => !!e?.__companion;

const DEG = 180 / Math.PI;
const toLonLat = (cartesian) => {
  const c = Cesium.Cartographic.fromCartesian(cartesian);
  return [c.longitude * DEG, c.latitude * DEG];
};

/** 규칙에 축척 범위가 없을 때 글자를 보여 주는 카메라 거리(m) */
export const LABEL_MAX_DISTANCE = 40000;

/** 스타일 입히기를 다시 할 때 앞서 만든 테두리·글자를 먼저 지운다 */
function removeCompanions(ds) {
  const old = ds.entities.values.filter(isCompanion);
  ds.entities.suspendEvents();
  try {
    for (const e of old) ds.entities.remove(e);
  } finally {
    ds.entities.resumeEvents();
  }
}

/** 면의 테두리: 땅에 붙인 면은 Cesium이 테두리를 그리지 못해서, 고리마다 땅에 붙인 선을 따로 얹는다 */
function addOutline(ds, polyEntity, stroke, idx, ruleOf, now) {
  const color = toCesiumColor(stroke.color, stroke.opacity);
  if (!color) return;
  const h = polyEntity.polygon.hierarchy?.getValue(now);
  if (!h) return;
  const material = stroke.dash ? new Cesium.PolylineDashMaterialProperty({ color, ...dashToCesium(stroke.dash) }) : new Cesium.ColorMaterialProperty(color);
  for (const ring of [h.positions, ...(h.holes ?? []).map((x) => x.positions)]) {
    if (!ring || ring.length < 2) continue;
    const line = ds.entities.add({
      name: polyEntity.name,
      properties: polyEntity.properties,
      polyline: { positions: [...ring, ring[0]], width: Math.max(1, stroke.width), clampToGround: true, classificationType: Cesium.ClassificationType.BOTH, material, zIndex: 2 },
    });
    line.__companion = polyEntity;
    ruleOf.set(line, idx);
  }
}

const H_ORIGIN = (x) => (x <= 0.25 ? Cesium.HorizontalOrigin.LEFT : x >= 0.75 ? Cesium.HorizontalOrigin.RIGHT : Cesium.HorizontalOrigin.CENTER);
// SLD 앵커 Y: 0이면 점이 글자 아래쪽 (글자가 점 위로), 1이면 점이 글자 위쪽
const V_ORIGIN = (y) => (y <= 0.25 ? Cesium.VerticalOrigin.BOTTOM : y >= 0.75 ? Cesium.VerticalOrigin.TOP : Cesium.VerticalOrigin.CENTER);

/** 라벨을 놓을 [경도, 위도] (면: 안쪽 대표점, 선: 중간, 점: 그 위치). 없으면 null */
function labelAnchor(e, now) {
  if (e.polygon) {
    const h = e.polygon.hierarchy?.getValue(now);
    if (!h?.positions?.length) return null;
    return polygonLabelPoint(h.positions.map(toLonLat), (h.holes ?? []).map((x) => x.positions.map(toLonLat)));
  }
  if (e.polyline) {
    const pos = e.polyline.positions?.getValue(now);
    return pos?.length ? lineMidpoint(pos.map(toLonLat)) : null;
  }
  const pos = e.position?.getValue(now);
  return pos ? toLonLat(pos) : null;
}

/** 글자 라벨 (TextSymbolizer) */
function addLabel(ds, e, t, idx, ruleOf, now, props, withDistanceLimit) {
  const text = labelText(t, props);
  if (!text) return;
  const at = labelAnchor(e, now);
  if (!at) return;
  const fill = toCesiumColor(t.fill, t.fillOpacity) ?? Cesium.Color.BLACK;
  const halo = t.halo ? toCesiumColor(t.halo.fill, t.halo.opacity) : null;
  const family = t.fontFamily ? `"${t.fontFamily}", sans-serif` : 'sans-serif';
  const label = ds.entities.add({
    name: e.name,
    properties: e.properties,
    position: Cesium.Cartesian3.fromDegrees(at[0], at[1]),
    label: {
      text,
      font: `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${Math.max(8, t.fontSize)}px ${family}`,
      fillColor: fill,
      outlineColor: halo ?? Cesium.Color.TRANSPARENT,
      outlineWidth: t.halo ? Math.max(1, t.halo.radius * 2) : 0,
      style: halo ? Cesium.LabelStyle.FILL_AND_OUTLINE : Cesium.LabelStyle.FILL,
      horizontalOrigin: H_ORIGIN(t.anchor[0]),
      verticalOrigin: V_ORIGIN(t.anchor[1]),
      pixelOffset: new Cesium.Cartesian2(t.displacement[0], -t.displacement[1]),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      // 축척 범위가 없는 규칙의 글자는 너무 멀리서는 겹쳐서 읽을 수 없으니 가까이서만 (축척 범위가 있으면 그 규칙이 정한다)
      distanceDisplayCondition: withDistanceLimit ? new Cesium.DistanceDisplayCondition(0, LABEL_MAX_DISTANCE) : undefined,
    },
  });
  label.__companion = e;
  ruleOf.set(label, idx);
}

/**
 * SLD 스타일을 데이터 소스의 모든 피처에 적용한다. 지도에 올리기(viewer.dataSources.add) **전에** 부르면 가장 빠르다.
 * 규칙에 맞는 첫 스타일로 칠하고, 어느 규칙에도 안 맞는 피처는 감춘다 (SLD에서는 규칙이 없으면 그리지 않는다).
 * 채우기·선·점 색, **면의 테두리**(땅에 붙인 선을 따로 얹음, 점선 지원), **글자 라벨**(TextSymbolizer)을 적용한다.
 * 규칙의 축척 범위는 updateScale 이 카메라가 움직일 때 켜고 끈다.
 *
 * MultiPolygon은 Cesium에서 조각마다 엔티티가 따로 생겨 엔티티 수가 피처 수보다 많다. collection을 주면 범례의 개수를 피처 수로 센다.
 *
 * @param {Cesium.GeoJsonDataSource} ds
 * @param {object} style parseSld 결과
 * @param {{features:Array<{properties:object}>}} [collection] 같은 데이터의 FeatureCollection (피처 수 계산용)
 * @returns {{style:object, ruleOf:Map<object,number>, counts:number[], unmatched:number, hiddenRules:Set<number>, scaleHidden:Set<number>, hasScale:boolean}}
 */
export function applyStyle(ds, style, collection = null) {
  const now = Cesium.JulianDate.now();
  removeCompanions(ds);
  const ruleOf = new Map();
  const counts = new Array(style.rules.length).fill(0);
  let unmatched = 0;
  const entities = [...ds.entities.values]; // 순회 중에 보조 도형이 늘어나므로 지금 것만
  const hasText = style.rules.some((r) => r.text);
  ds.entities.suspendEvents();
  try {
    for (const e of entities) {
      const props = e.properties?.getValue(now) ?? {};
      const hit = pickRule(style, props);
      if (!hit) {
        unmatched++;
        ruleOf.set(e, -1);
        e.show = false;
        continue;
      }
      ruleOf.set(e, hit.index);
      counts[hit.index]++;
      e.show = true;
      const { polygon, line, point, text } = hit.rule;
      if (e.polygon && polygon) {
        const fill = polygon.fill ? toCesiumColor(polygon.fill, polygon.fillOpacity) : null;
        e.polygon.fill = !!fill;
        if (fill) e.polygon.material = new Cesium.ColorMaterialProperty(fill);
        e.polygon.outline = false;
        if (polygon.stroke) addOutline(ds, e, polygon.stroke, hit.index, ruleOf, now);
      }
      if (e.polyline && (line || polygon?.stroke)) {
        const s = line ?? polygon.stroke;
        const color = toCesiumColor(s.color, s.opacity);
        if (color) {
          e.polyline.material = s.dash ? new Cesium.PolylineDashMaterialProperty({ color, ...dashToCesium(s.dash) }) : new Cesium.ColorMaterialProperty(color);
          e.polyline.width = Math.max(1, s.width);
        }
      }
      if (point) {
        const color = toCesiumColor(point.fill, point.fillOpacity);
        if (color && e.billboard) e.billboard.color = color;
        else if (color && e.point) e.point.color = color; // 동그라미·작은 점
      }
      if (hasText && text) addLabel(ds, e, text, hit.index, ruleOf, now, props, hit.rule.minScale == null && hit.rule.maxScale == null);
    }
  } finally {
    ds.entities.resumeEvents();
  }
  if (collection) {
    counts.fill(0);
    unmatched = 0;
    for (const f of collection.features) {
      const hit = pickRule(style, f.properties ?? {});
      if (hit) counts[hit.index]++;
      else unmatched++;
    }
  }
  const hasScale = style.rules.some((r) => r.minScale != null || r.maxScale != null);
  return { style, ruleOf, counts, unmatched, hiddenRules: new Set(), scaleHidden: new Set(), hasScale };
}

/** 사용자가 끈 규칙과 축척 밖인 규칙을 합쳐 도형을 보이거나 감춘다 */
function applyRuleVisibility(ds, state) {
  ds.entities.suspendEvents();
  try {
    for (const [entity, idx] of state.ruleOf) entity.show = idx >= 0 && !state.hiddenRules.has(idx) && !state.scaleHidden.has(idx);
  } finally {
    ds.entities.resumeEvents();
  }
}

/**
 * 새로 만든 데이터 소스에 앞서 적용한 스타일을 그대로 다시 입힌다 (레이어의 도형을 다시 만들 때).
 * 범례에서 사용자가 끈 규칙은 계속 꺼 둔다. 축척 범위로 감춘 규칙은 updateScale 이 다시 정한다.
 */
export function restyle(ds, old, collection = null) {
  const state = applyStyle(ds, old.style, collection);
  state.hiddenRules = new Set(old.hiddenRules);
  if (state.hiddenRules.size) applyRuleVisibility(ds, state);
  return state;
}

/** 범례의 규칙 하나를 켜거나 끈다 (그 규칙으로 칠해진 피처만) */
export function setRuleVisible(ds, state, ruleIndex, visible) {
  if (visible) state.hiddenRules.delete(ruleIndex);
  else state.hiddenRules.add(ruleIndex);
  applyRuleVisibility(ds, state);
}

/**
 * 지금 지도 축척(분모)에서 축척 범위 밖인 규칙을 감춘다. 바뀐 것이 있으면 true.
 * @param {number} denom 화면 축척 분모 (예: 25000 = 1:25,000)
 */
export function updateScale(ds, state, denom) {
  if (!state.hasScale) return false;
  const hidden = new Set();
  state.style.rules.forEach((r, i) => {
    if (!ruleActiveAtScale(r, denom)) hidden.add(i);
  });
  const same = hidden.size === state.scaleHidden.size && [...hidden].every((i) => state.scaleHidden.has(i));
  if (same) return false;
  state.scaleHidden = hidden;
  applyRuleVisibility(ds, state);
  return true;
}

const PALETTE = ['#ff9f1c', '#2ec4b6', '#e71d36', '#9b5de5', '#3a86ff', '#8ac926', '#ff5ca8', '#ffd23f'];
let colorIndex = 0;
export const nextColor = () => PALETTE[colorIndex++ % PALETTE.length];

/**
 * @param {object} collection WGS84 FeatureCollection
 * @param {{name:string, color?:string, useHeights?:boolean, heightOffset?:number, pointStyle?:string}} o
 *   useHeights: false(기본)면 높이를 떼고 모두 지면에 붙인다. true면 좌표의 높이대로 그린다(지면에 붙이지 않음)
 *   heightOffset: useHeights 일 때 높이에 더하는 값(m). 해수면 기준 표고를 타원체고에 맞출 때 쓴다
 *   pointStyle: 점 모양 'circle'(동그라미) | 'dot'(작은 점) | 'pin'(핀). pointStyles.js
 * @returns {Promise<Cesium.GeoJsonDataSource>}
 */
export async function createVectorDataSource(collection, { name, color = nextColor(), useHeights = false, heightOffset = 0, pointStyle = DEFAULT_POINT_STYLE }) {
  const c = Cesium.Color.fromCssColorString(color);
  const ds = await Cesium.GeoJsonDataSource.load(useHeights ? shiftHeights(collection, heightOffset) : stripHeights(collection), {
    clampToGround: !useHeights,
    stroke: c,
    fill: c.withAlpha(0.35),
    strokeWidth: 3,
    markerColor: c,
  });
  ds.name = name;
  ds.__baseColor = color; // 높이·점 모양을 바꿔 다시 만들 때 같은 색을 쓰려고
  const style = normalizePointStyle(pointStyle);
  ds.__pointStyle = style;
  const spec = pointStyleSpec(style);
  ds.entities.suspendEvents();
  try {
    for (const e of ds.entities.values) {
      // 기본은 지형(지구 표면)에만 붙는다. 3D 타일 위에도 붙도록 분류 대상을 넓힌다.
      if (e.polygon) e.polygon.classificationType = Cesium.ClassificationType.BOTH;
      if (e.polyline) e.polyline.classificationType = Cesium.ClassificationType.BOTH;
      if (e.billboard && style !== 'pin') {
        // Cesium 은 점을 핀 그림(billboard)으로 만든다. 핀이 아닌 모양은 색 점(point)으로 바꿔 단다.
        e.billboard = undefined;
        e.point = new Cesium.PointGraphics({
          pixelSize: spec.size,
          color: c,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: spec.outline,
          heightReference: useHeights ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
        });
      }
    }
  } finally {
    ds.entities.resumeEvents();
  }
  return ds;
}

/** 엔티티의 속성을 [이름, 값] 목록으로 */
export function entityProperties(entity) {
  const bag = entity?.properties;
  if (!bag) return [];
  const now = Cesium.JulianDate.now();
  const out = [];
  for (const name of bag.propertyNames ?? []) {
    let v;
    try {
      v = bag[name]?.getValue ? bag[name].getValue(now) : bag[name];
    } catch {
      v = undefined;
    }
    out.push([name, v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)]);
  }
  return out;
}
