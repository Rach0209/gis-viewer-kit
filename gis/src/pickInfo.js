/* global Cesium */
/**
 * 지도를 클릭했을 때 무엇을 눌렀는지 알아내고(벡터 피처, 3D Tiles 피처, glb 모델, 타일셋) 속성 목록과 강조를 만든다.
 * 벡터 피처의 강조는 highlight.js 가 맡고, 여기서는 3D Tiles 피처와 모델의 강조(색)를 맡는다.
 */
import { entityProperties } from './vectorLayer.js';
import { formatDistance } from './coordFormat.js';

const YELLOW = () => Cesium.Color.fromCssColorString('#ffe600');

/** 강조·측정용으로 우리가 얹은 엔티티인가 (클릭 대상에서 뺀다) */
export function isOverlayEntity(entity) {
  const name = entity?.entityCollection?.owner?.name;
  return name === 'highlight' || name === 'measure';
}

/**
 * 클릭한 화면 위치의 대상. 겹쳐 있으면 가장 위(가까운) 것.
 * @returns {{kind:'entity', entity:Cesium.Entity} | {kind:'tile-feature', feature:Cesium.Cesium3DTileFeature} | {kind:'model', model:Cesium.Model} | {kind:'tileset', tileset:Cesium.Cesium3DTileset} | null}
 */
export function findTarget(scene, position) {
  for (const p of scene.drillPick(position, 10)) {
    if (p instanceof Cesium.Cesium3DTileFeature) return { kind: 'tile-feature', feature: p };
    if (p?.id instanceof Cesium.Entity) {
      if (isOverlayEntity(p.id)) continue;
      return { kind: 'entity', entity: p.id.__companion ?? p.id }; // 테두리 선·글자를 누르면 원래 피처로
    }
    const prim = p?.primitive;
    if (prim instanceof Cesium.Model) return { kind: 'model', model: prim };
    if (prim instanceof Cesium.Cesium3DTileset) return { kind: 'tileset', tileset: prim };
    if (p?.content?.tileset) return { kind: 'tileset', tileset: p.content.tileset };
  }
  return null;
}

const show = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** 3D Tiles 피처의 속성 [이름, 값] */
export function tileFeatureProperties(feature) {
  const out = [];
  let ids = [];
  try {
    ids = feature.getPropertyIds?.() ?? [];
  } catch {
    ids = [];
  }
  for (const id of ids) {
    let v;
    try {
      v = feature.getProperty(id);
    } catch {
      v = undefined;
    }
    out.push([id, show(v)]);
  }
  return out;
}

/** 대상의 속성 목록 */
export function targetProperties(target) {
  if (target.kind === 'entity') return entityProperties(target.entity);
  if (target.kind === 'tile-feature') return tileFeatureProperties(target.feature);
  return [];
}

/**
 * 3D Tiles 피처(색)·모델(노란색 섞기)을 강조하고, 되돌리는 함수를 준다. (벡터 피처는 highlight.js)
 * @returns {() => void}
 */
export function highlightTarget(target) {
  if (target.kind === 'tile-feature') {
    const f = target.feature;
    const before = Cesium.Color.clone(f.color);
    f.color = YELLOW();
    return () => {
      try {
        f.color = before;
      } catch {
        // 타일이 이미 내려갔을 수 있다
      }
    };
  }
  if (target.kind === 'model') {
    // 윤곽선(silhouette)은 환경에 따라 그려지지 않아서, 노란색을 섞어 강조한다
    const m = target.model;
    const before = { color: m.color, mode: m.colorBlendMode, amount: m.colorBlendAmount };
    m.color = YELLOW();
    m.colorBlendMode = Cesium.ColorBlendMode.MIX;
    m.colorBlendAmount = 0.6;
    return () => {
      if (m.isDestroyed?.()) return;
      m.color = before.color;
      m.colorBlendMode = before.mode;
      m.colorBlendAmount = before.amount;
    };
  }
  return () => {};
}

const mb = (bytes) => (Number.isFinite(bytes) ? `${(bytes / 1048576).toFixed(1)} MB` : '–');
const lonLatH = (cartesian) => {
  const c = Cesium.Cartographic.fromCartesian(cartesian);
  return `경도 ${Cesium.Math.toDegrees(c.longitude).toFixed(6)}, 위도 ${Cesium.Math.toDegrees(c.latitude).toFixed(6)}, 높이 ${c.height.toFixed(1)} m`;
};

/** 3D Tiles 레이어의 정보 [이름, 값] (지금까지 불러온 만큼의 통계 포함) */
export function tilesetInfoRows(tileset, meta = {}) {
  const rows = [];
  if (meta.files != null) rows.push(['폴더 안 파일', `${meta.files.toLocaleString('ko-KR')}개`]);
  if (tileset.asset?.version) rows.push(['3D Tiles 버전', String(tileset.asset.version)]);
  if (tileset.asset?.tilesetVersion) rows.push(['타일셋 버전', String(tileset.asset.tilesetVersion)]);
  const bs = tileset.boundingSphere;
  if (bs) {
    rows.push(['중심', lonLatH(bs.center)]);
    rows.push(['범위 반지름', formatDistance(bs.radius)]);
  }
  if (Number.isFinite(tileset.geometricError)) rows.push(['최대 기하 오차', `${tileset.geometricError} m`]);
  const st = tileset.statistics;
  if (st) {
    rows.push(['타일 수', `${st.numberOfTilesTotal?.toLocaleString('ko-KR') ?? '–'}개 (내용 준비 ${st.numberOfTilesWithContentReady?.toLocaleString('ko-KR') ?? '–'}개)`]);
    rows.push(['메모리', `도형 ${mb(st.geometryByteLength)}, 텍스처 ${mb(st.texturesByteLength)}`]);
  }
  const props = tileset.properties ? Object.keys(tileset.properties) : [];
  if (props.length) rows.push(['속성 이름', props.slice(0, 12).join(', ') + (props.length > 12 ? ` 외 ${props.length - 12}개` : '')]);
  rows.push(['불러오기', tileset.tilesLoaded ? '끝남' : '진행 중 (지도를 움직이면 더 불러옵니다)']);
  return rows;
}

/** glb 모델 레이어의 정보 [이름, 값] */
export function modelInfoRows(layer) {
  const m = layer.meta ?? {};
  const rows = [['위치', `경도 ${m.lon?.toFixed(6)}, 위도 ${m.lat?.toFixed(6)}, 높이 ${m.height?.toFixed(1)} m`]];
  rows.push(['방향·기울기', `방향 ${m.headingDeg ?? 0}°, 앞뒤 ${m.pitchDeg ?? 0}°, 좌우 ${m.rollDeg ?? 0}°`]);
  rows.push(['크기 배율 · 위쪽 축', `${m.scale ?? 1} · ${m.upAxis ?? 'Y'}`]);
  const r = layer.object?.boundingSphere?.radius;
  if (Number.isFinite(r)) rows.push(['범위 반지름', formatDistance(r)]);
  return rows;
}
