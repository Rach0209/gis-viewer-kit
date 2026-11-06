import * as THREE from 'three';
import { WGS84_ELLIPSOID } from '3d-tiles-renderer';
import { computeEcefToLocalMatrix } from '../core/geo/ecefFrame.js';
import { ecefToGeodetic } from './analyzeTileset.js';
import { createGeodeticToLocal } from './geoMath.js';
import { getCrs, isValidLonLat, toLonLat } from './crsList.js';
import { projectedAnchor } from './projectedAnchor.js';

/**
 * 단독 glb를 화면의 좌표(geo 모드 로컬 좌표: x=동, y=위, z=-북)에 놓는 계산. 순수 함수라 화면 없이 시험할 수 있다.
 *
 * 모델 행렬 = 이동 · 방향 회전 · 위쪽 축 보정 · 크기
 *  - 위쪽 축: glTF 표준은 Y가 위다('Y', 변환 없음). GIS에서 온 모델은 Z가 위인 경우가 많아('Z') X축으로 -90도 돌려
 *    (x, y, z) -> (x, z, -y) 로 보낸다 (Z가 위, Y가 북이 되도록).
 *  - 방향(heading): 위에서 내려다볼 때 **시계 방향**으로 도(deg). 로컬 y축 둘레의 -heading 회전이다.
 *
 * @typedef {
 *   {type:'single', upAxis?:'Y'|'Z', headingDeg?:number, scale?:number}
 * | {type:'coords', crs:string, x:number, y:number, height?:number, upAxis?:'Y'|'Z', headingDeg?:number, scale?:number}
 * | {type:'rtc', center?:number[], upAxis?:'Y'|'Z', headingDeg?:number, scale?:number}
 * | {type:'ecef'}
 * } PlacementSpec
 *
 * @typedef {{
 *   mode: 'geo'|'model',
 *   origin: {lon:number, lat:number, alt:number}|null,
 *   matrix: THREE.Matrix4,
 *   lonLat: {lon:number, lat:number, height:number}|null,
 *   summary: Array<[string, string]>,
 * }} Placement
 */

const DEG = Math.PI / 180;

/** 위쪽 축 보정 행렬 */
export function upAxisMatrix(upAxis = 'Y') {
  if (upAxis === 'Y') return new THREE.Matrix4();
  if (upAxis === 'Z') return new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  throw new Error(`위쪽 축은 'Y' 또는 'Z' 여야 합니다: ${upAxis}`);
}

/**
 * 이동 · 방향 · 기울기 · 위쪽 축 · 크기를 합친 행렬.
 * 순서: 이동 · 방향 · 앞뒤 기울기 · 좌우 기울기 · 위쪽 축 보정 · 크기 (모델 쪽부터 적용)
 *  - 방향(headingDeg): 위에서 볼 때 시계 방향
 *  - 앞뒤 기울기(pitchDeg): + 이면 (방향 0일 때) 북쪽이 올라간다. 방향을 돌리면 모델과 함께 돈다.
 *  - 좌우 기울기(rollDeg): + 이면 (방향 0일 때) 동쪽이 올라간다.
 */
export function buildLocalMatrix({ position = [0, 0, 0], headingDeg = 0, pitchDeg = 0, rollDeg = 0, upAxis = 'Y', scale = 1, pivot = null } = {}) {
  if (!(scale > 0) || !Number.isFinite(scale)) throw new Error('크기 배율은 0보다 큰 숫자여야 합니다');
  for (const [v, label] of [[headingDeg, '방향'], [pitchDeg, '앞뒤 기울기'], [rollDeg, '좌우 기울기']]) {
    if (!Number.isFinite(v)) throw new Error(`${label}은(는) 숫자(도)여야 합니다`);
  }
  const m = new THREE.Matrix4().makeTranslation(position[0], position[1], position[2]);
  m.multiply(new THREE.Matrix4().makeRotationY(-headingDeg * DEG));
  m.multiply(new THREE.Matrix4().makeRotationX(pitchDeg * DEG));
  m.multiply(new THREE.Matrix4().makeRotationZ(rollDeg * DEG));
  m.multiply(upAxisMatrix(upAxis));
  m.multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
  // 모델 파일 안의 기준점(pivot)을 먼저 원점으로 옮긴다. 파일에 실제 좌표가 들어 있는 모델은 이 점이 position에 놓인다.
  if (pivot) m.multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
  return m;
}

/**
 * 배치한 뒤 고치는 값(편집)으로 행렬을 다시 만든다. 로컬 좌표의 **원점(origin)은 그대로** 두고 모델만 옮긴다
 * (배경 지도·좌표 표시·카메라가 모두 이 원점 기준이라서). 원점에서 수십 km 넘게 옮기면 접평면 오차가 커진다.
 *
 * @param {{lon:number, lat:number, alt?:number}} origin 처음 배치할 때 정해진 로컬 원점
 * @param {ModelEdit} e
 */
export function editedMatrix(origin, e) {
  const p = createGeodeticToLocal(origin)(e.lon, e.lat, e.height ?? 0);
  return buildLocalMatrix({
    position: [p.x, p.y, p.z],
    headingDeg: e.headingDeg ?? 0,
    pitchDeg: e.pitchDeg ?? 0,
    rollDeg: e.rollDeg ?? 0,
    upAxis: e.upAxis ?? 'Y',
    scale: e.scale ?? 1,
    pivot: e.pivot ?? null,
  });
}

/**
 * @typedef {{lon:number, lat:number, height:number, headingDeg:number, pitchDeg:number, rollDeg:number,
 *            upAxis:'Y'|'Z', scale:number}} ModelEdit
 */

/** 편집 값 -> 정보 패널에 보여 줄 행 */
export function describeEdit(e, { geo = true } = {}) {
  const rows = [['배치', geo ? '입력/선택한 위치 (편집됨)' : '좌표 없이 단일 모델 (편집됨)']];
  if (geo) {
    rows.push(['경도 / 위도', `${f(e.lon)} / ${f(e.lat)}`], ['높이 (타원체고)', `${(+e.height).toFixed(2)} m`]);
  }
  rows.push(
    ['위쪽 축', e.upAxis === 'Z' ? 'Z (X축 -90° 보정)' : 'Y (glTF 표준)'],
    ['방향', `${+e.headingDeg.toFixed(2)}° (시계 방향)`],
    ['기울기 (앞뒤 / 좌우)', `${+e.pitchDeg.toFixed(2)}° / ${+e.rollDeg.toFixed(2)}°`],
    ['크기 배율', String(+e.scale.toFixed(4))],
  );
  return rows;
}

const f = (n, d = 6) => n.toFixed(d);

/**
 * @param {PlacementSpec} spec
 * @param {import('./glbInspect.js').GlbInfo} [info] rtc/ecef 배치에 필요 (자동 판별 결과)
 * @returns {Placement}
 */
export function planPlacement(spec, info) {
  const upAxis = spec.upAxis ?? 'Y';
  const scale = spec.scale ?? 1;
  const headingDeg = spec.headingDeg ?? 0;
  const pitchDeg = spec.pitchDeg ?? 0;
  const rollDeg = spec.rollDeg ?? 0;
  const common = [
    ['위쪽 축', upAxis === 'Z' ? 'Z (X축 -90° 보정)' : 'Y (glTF 표준)'],
    ['방향', `${headingDeg}° (시계 방향)`],
    ['기울기 (앞뒤 / 좌우)', `${pitchDeg}° / ${rollDeg}°`],
    ['크기 배율', String(scale)],
  ];

  if (spec.type === 'single') {
    return {
      mode: 'model',
      origin: null,
      matrix: buildLocalMatrix({ headingDeg, pitchDeg, rollDeg, upAxis, scale }),
      lonLat: null,
      summary: [['배치', '좌표 없이 단일 모델'], ...common],
    };
  }

  if (spec.type === 'coords') {
    const crs = getCrs(spec.crs);
    const ll = toLonLat(spec.crs, spec.x, spec.y);
    if (!isValidLonLat(ll)) {
      throw new Error(`입력한 좌표가 경위도 범위를 벗어났습니다 (${f(ll.lon, 3)}, ${f(ll.lat, 3)}). 좌표계를 확인하세요.`);
    }
    const height = spec.height ?? 0;
    if (!Number.isFinite(height)) throw new Error('높이는 숫자여야 합니다');
    const origin = { lon: ll.lon, lat: ll.lat, alt: 0 };
    const p = createGeodeticToLocal(origin)(ll.lon, ll.lat, height);
    return {
      mode: 'geo',
      origin,
      matrix: buildLocalMatrix({ position: [p.x, p.y, p.z], headingDeg, pitchDeg, rollDeg, upAxis, scale }),
      lonLat: { ...ll, height },
      summary: [
        ['배치', '입력한 좌표'],
        ['입력 좌표계', crs.label],
        [crs.xLabel.split(' ')[0], f(spec.x, crs.geographic ? 6 : 2)],
        [crs.yLabel.split(' ')[0], f(spec.y, crs.geographic ? 6 : 2)],
        ['경도 / 위도', `${f(ll.lon)} / ${f(ll.lat)}`],
        ['높이 (타원체고)', `${height} m`],
        ...common,
      ],
    };
  }

  if (spec.type === 'projected') {
    // 파일 안의 정점/노드 좌표가 이미 실제 투영 좌표(동·북)인 모델. 바닥 중심을 그 좌표에 놓는다.
    const { east, north, lon, lat, height, pivot } = projectedAnchor({ crs: spec.crs, upAxis, scale }, info?.bounds);
    const ll = { lon, lat };
    const origin = { lon: ll.lon, lat: ll.lat, alt: 0 };
    const p = createGeodeticToLocal(origin)(ll.lon, ll.lat, height);
    return {
      mode: 'geo',
      origin,
      pivot,
      matrix: buildLocalMatrix({ position: [p.x, p.y, p.z], headingDeg, pitchDeg, rollDeg, upAxis, scale, pivot }),
      lonLat: { ...ll, height },
      summary: [
        ['배치', '파일 안의 실제 좌표 (모델 바닥 중심)'],
        ['읽은 좌표계', getCrs(spec.crs).label],
        ['동 / 북', `${east.toFixed(2)} / ${north.toFixed(2)}`],
        ['경도 / 위도', `${f(ll.lon)} / ${f(ll.lat)}`],
        ['높이 (바닥)', `${height.toFixed(2)} m`],
        ...common,
      ],
    };
  }

  if (spec.type === 'rtc') {
    const center = spec.center ?? (info?.detected?.kind === 'rtc' ? info.detected.center : null);
    if (!center) throw new Error('CESIUM_RTC 좌표가 없습니다');
    const g = ecefToGeodetic(center[0], center[1], center[2]);
    const origin = { lon: g.lon, lat: g.lat, alt: 0 };
    const p = createGeodeticToLocal(origin)(g.lon, g.lat, g.alt);
    return {
      mode: 'geo',
      origin,
      matrix: buildLocalMatrix({ position: [p.x, p.y, p.z], headingDeg, pitchDeg, rollDeg, upAxis, scale }),
      lonLat: { lon: g.lon, lat: g.lat, height: g.alt },
      summary: [
        ['배치', '파일의 CESIUM_RTC 좌표 (자동 판별)'],
        ['경도 / 위도', `${f(g.lon)} / ${f(g.lat)}`],
        ['높이 (타원체고)', `${g.alt.toFixed(2)} m`],
        ...common,
      ],
    };
  }

  if (spec.type === 'ecef') {
    const c = info?.center;
    if (!c) throw new Error('모델 범위를 알 수 없어 ECEF 좌표로 배치할 수 없습니다');
    const g = ecefToGeodetic(c[0], c[1], c[2]);
    const origin = { lon: g.lon, lat: g.lat, alt: 0 };
    return {
      mode: 'geo',
      origin,
      // 정점이 이미 ECEF 좌표이므로 3D Tiles를 로컬로 옮길 때와 같은 변환만 적용한다 (축 보정·크기·방향 없음)
      matrix: computeEcefToLocalMatrix(WGS84_ELLIPSOID, origin),
      lonLat: { lon: g.lon, lat: g.lat, height: g.alt },
      summary: [
        ['배치', '정점이 지구 좌표(ECEF)로 저장됨 (자동 판별)'],
        ['중심 경도 / 위도', `${f(g.lon)} / ${f(g.lat)}`],
        ['중심 높이 (타원체고)', `${g.alt.toFixed(2)} m`],
      ],
    };
  }

  throw new Error(`알 수 없는 배치 종류: ${spec.type}`);
}
