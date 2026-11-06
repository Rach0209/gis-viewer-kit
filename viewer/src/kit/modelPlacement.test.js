import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WGS84_ELLIPSOID } from '3d-tiles-renderer';
import { buildLocalMatrix, describeEdit, editedMatrix, planPlacement, upAxisMatrix } from './modelPlacement.js';
import { createLocalToGeodetic } from './geoMath.js';
import { fromLonLat } from './crsList.js';

const apply = (m, x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(m);
const close = (v, [x, y, z], d = 6) => {
  expect(v.x).toBeCloseTo(x, d);
  expect(v.y).toBeCloseTo(y, d);
  expect(v.z).toBeCloseTo(z, d);
};

describe('위쪽 축', () => {
  it("'Y'는 변환 없음", () => {
    close(apply(upAxisMatrix('Y'), 1, 2, 3), [1, 2, 3]);
  });

  it("'Z': 모델의 Z(위)는 로컬 위(+y), 모델의 Y(북)는 로컬 -z(북), X(동)는 +x", () => {
    const m = upAxisMatrix('Z');
    close(apply(m, 0, 0, 1), [0, 1, 0]); // 위
    close(apply(m, 0, 1, 0), [0, 0, -1]); // 북 = -z
    close(apply(m, 1, 0, 0), [1, 0, 0]); // 동
  });

  it('잘못된 값은 오류', () => {
    expect(() => upAxisMatrix('X')).toThrow();
  });
});

describe('buildLocalMatrix', () => {
  it('방향: 시계 방향 90도면 동쪽(+x)을 향하던 것이 남쪽(+z)을 향한다 (위에서 볼 때)', () => {
    const m = buildLocalMatrix({ headingDeg: 90 });
    close(apply(m, 1, 0, 0), [0, 0, 1]); // 동 -> 남
    close(apply(m, 0, 0, -1), [1, 0, 0]); // 북(-z) -> 동 (시계 방향)
  });

  it('방향은 위(y)를 바꾸지 않는다', () => {
    close(apply(buildLocalMatrix({ headingDeg: 137 }), 0, 5, 0), [0, 5, 0]);
  });

  it('크기와 이동', () => {
    const m = buildLocalMatrix({ scale: 0.001, position: [10, 20, 30] });
    close(apply(m, 1000, 2000, 3000), [11, 22, 33]);
  });

  it('순서: 크기 -> 위쪽 축 -> 방향 -> 이동', () => {
    const m = buildLocalMatrix({ scale: 2, upAxis: 'Z', headingDeg: 90, position: [0, 100, 0] });
    // 모델 (0,1,0)=북 -> 크기 2 -> 로컬 (0,0,-2) -> 시계 90도 -> (2,0,0)... 북이 동으로 -> +100 위
    close(apply(m, 0, 1, 0), [2, 100, 0]);
  });

  it('배율이 0 이하이거나 숫자가 아니면 오류', () => {
    expect(() => buildLocalMatrix({ scale: 0 })).toThrow();
    expect(() => buildLocalMatrix({ scale: -1 })).toThrow();
    expect(() => buildLocalMatrix({ headingDeg: NaN })).toThrow();
  });
});

describe('planPlacement', () => {
  it('single: 지도 없이 model 모드', () => {
    const p = planPlacement({ type: 'single', upAxis: 'Z' });
    expect(p.mode).toBe('model');
    expect(p.origin).toBeNull();
    expect(p.lonLat).toBeNull();
    close(apply(p.matrix, 0, 0, 1), [0, 1, 0]);
  });

  it('coords(4326): 원점 = 입력 위치, 모델 원점이 로컬 (0, 높이, 0)', () => {
    const p = planPlacement({ type: 'coords', crs: 'EPSG:4326', x: 126.978, y: 37.5665, height: 50 });
    expect(p.mode).toBe('geo');
    expect(p.origin.lon).toBeCloseTo(126.978, 9);
    expect(p.origin.lat).toBeCloseTo(37.5665, 9);
    close(apply(p.matrix, 0, 0, 0), [0, 50, 0], 3);
  });

  it('coords(5179): 5179 좌표가 같은 지점의 4326 입력과 같은 위치로 환산된다', () => {
    const a = planPlacement({ type: 'coords', crs: 'EPSG:4326', x: 126.98, y: 37.57 });
    const xy = fromLonLat('EPSG:5179', 126.98, 37.57);
    const b = planPlacement({ type: 'coords', crs: 'EPSG:5179', x: xy.x, y: xy.y });
    expect(b.origin.lon).toBeCloseTo(a.origin.lon, 8);
    expect(b.origin.lat).toBeCloseTo(a.origin.lat, 8);
  });

  it('coords: 로컬 좌표를 다시 경위도로 바꾸면 입력 위치/높이가 나온다', () => {
    const p = planPlacement({ type: 'coords', crs: 'EPSG:4326', x: 126.99, y: 37.58, height: 123.4, headingDeg: 30 });
    const v = apply(p.matrix, 0, 0, 0);
    const g = createLocalToGeodetic(p.origin)(v.x, v.y, v.z);
    expect(g.lon).toBeCloseTo(126.99, 8);
    expect(g.lat).toBeCloseTo(37.58, 8);
    expect(g.alt).toBeCloseTo(123.4, 3);
  });

  it('coords: 좌표계를 잘못 골라 경위도 범위를 벗어나면 이유를 알려 주는 오류', () => {
    expect(() => planPlacement({ type: 'coords', crs: 'EPSG:4326', x: 953901, y: 1952032 })).toThrow(/좌표계를 확인/);
  });

  it('coords: 요약에 입력 좌표계와 경위도가 들어 있다', () => {
    const p = planPlacement({ type: 'coords', crs: 'EPSG:5179', x: 953901.17, y: 1952032.08, height: 10 });
    const text = p.summary.map((r) => r.join(' ')).join('\n');
    expect(text).toMatch(/EPSG:5179/);
    expect(text).toMatch(/경도 \/ 위도/);
  });

  it('rtc: ECEF 중심 위치에 놓이고 모델 원점이 그 지점의 경위도/고도로 돌아온다', () => {
    const c = new THREE.Vector3();
    WGS84_ELLIPSOID.getCartographicToPosition((37.58 * Math.PI) / 180, (126.99 * Math.PI) / 180, 77, c);
    const p = planPlacement({ type: 'rtc' }, { detected: { kind: 'rtc', center: c.toArray() } });
    expect(p.mode).toBe('geo');
    expect(p.lonLat.lon).toBeCloseTo(126.99, 7);
    expect(p.lonLat.lat).toBeCloseTo(37.58, 7);
    expect(p.lonLat.height).toBeCloseTo(77, 2);
    const v = apply(p.matrix, 0, 0, 0);
    const g = createLocalToGeodetic(p.origin)(v.x, v.y, v.z);
    expect(g.alt).toBeCloseTo(77, 2);
  });

  it('rtc: center가 없으면 오류', () => {
    expect(() => planPlacement({ type: 'rtc' }, {})).toThrow(/CESIUM_RTC/);
  });

  it('ecef: 정점의 ECEF 좌표가 로컬 좌표에서 지구 표면의 같은 지점(원점 부근)에 놓인다', () => {
    const c = new THREE.Vector3();
    WGS84_ELLIPSOID.getCartographicToPosition((37.58 * Math.PI) / 180, (126.99 * Math.PI) / 180, 40, c);
    const p = planPlacement({ type: 'ecef' }, { center: c.toArray() });
    const v = apply(p.matrix, c.x, c.y, c.z); // 중심 정점
    const g = createLocalToGeodetic(p.origin)(v.x, v.y, v.z);
    expect(g.lon).toBeCloseTo(126.99, 7);
    expect(g.lat).toBeCloseTo(37.58, 7);
    expect(g.alt).toBeCloseTo(40, 2);
  });

  it('알 수 없는 종류는 오류', () => {
    expect(() => planPlacement({ type: 'nope' })).toThrow(/알 수 없는/);
  });
});

describe('기울기', () => {
  it('앞뒤 기울기 +90: 북쪽(-z)에 있던 점이 위로 올라간다 (방향 0일 때)', () => {
    const m = buildLocalMatrix({ pitchDeg: 90 });
    close(apply(m, 0, 0, -1), [0, 1, 0]);
  });

  it('좌우 기울기 +90: 동쪽(+x)에 있던 점이 위로 올라간다 (방향 0일 때)', () => {
    const m = buildLocalMatrix({ rollDeg: 90 });
    close(apply(m, 1, 0, 0), [0, 1, 0]);
  });

  it('기울기는 방향과 함께 돈다: 방향 90°(시계)에서 앞뒤 기울기 +90이면 동쪽이 올라간다', () => {
    // 방향 90도로 돌리면 모델의 북쪽이 동쪽을 향하므로, 모델 기준 "북쪽이 올라감"은 세계 기준 "동쪽이 올라감"
    const m = buildLocalMatrix({ headingDeg: 90, pitchDeg: 90 });
    close(apply(m, 0, 0, -1), [0, 1, 0]); // 모델 북쪽 끝점이 위로
    close(apply(m, 1, 0, 0), [0, 0, 1].map((v) => v), 6); // 모델 동쪽은 방향 90에서 남쪽(+z)을 향하고 기울기 축과 평행하지 않음
  });

  it('기울기 0은 기존 행렬과 같다', () => {
    const a = buildLocalMatrix({ headingDeg: 33, upAxis: 'Z', scale: 2, position: [1, 2, 3] });
    const b = buildLocalMatrix({ headingDeg: 33, pitchDeg: 0, rollDeg: 0, upAxis: 'Z', scale: 2, position: [1, 2, 3] });
    expect(a.equals(b)).toBe(true);
  });

  it('기울기가 숫자가 아니면 오류', () => {
    expect(() => buildLocalMatrix({ pitchDeg: NaN })).toThrow(/앞뒤 기울기/);
    expect(() => buildLocalMatrix({ rollDeg: Infinity })).toThrow(/좌우 기울기/);
  });

  it('planPlacement(single/coords)가 기울기를 반영하고 요약에 보여 준다', () => {
    const p = planPlacement({ type: 'single', pitchDeg: 90 });
    close(apply(p.matrix, 0, 0, -1), [0, 1, 0]);
    const c = planPlacement({ type: 'coords', crs: 'EPSG:4326', x: 126.98, y: 37.57, rollDeg: 90 });
    close(apply(c.matrix, 1, 0, 0), [0, 0, 0].map((v, i) => (i === 1 ? 1 : v)), 3);
    expect(c.summary.map((r) => r[0])).toContain('기울기 (앞뒤 / 좌우)');
  });
});

describe('editedMatrix (편집 = 원점은 두고 모델만 옮김)', () => {
  const origin = { lon: 126.978, lat: 37.5665, alt: 0 };

  it('원점 위치에 놓으면 모델 원점이 로컬 (0, 높이, 0)', () => {
    const m = editedMatrix(origin, { lon: origin.lon, lat: origin.lat, height: 12 });
    close(apply(m, 0, 0, 0), [0, 12, 0], 3);
  });

  it('동쪽으로 0.001도 옮기면 약 90m 동쪽(+x)', () => {
    const m = editedMatrix(origin, { lon: origin.lon + 0.001, lat: origin.lat, height: 0 });
    const v = apply(m, 0, 0, 0);
    expect(v.x).toBeCloseTo(0.001 * 111320 * Math.cos((origin.lat * Math.PI) / 180), 0);
    expect(v.z).toBeCloseTo(0, 1);
  });

  it('북쪽으로 옮기면 -z', () => {
    const v = apply(editedMatrix(origin, { lon: origin.lon, lat: origin.lat + 0.001, height: 0 }), 0, 0, 0);
    expect(v.z).toBeLessThan(-100);
  });

  it('편집 행렬을 다시 경위도로 바꾸면 입력한 위치/높이가 나온다', () => {
    const e = { lon: 126.99, lat: 37.58, height: 55.5, headingDeg: 40, pitchDeg: 5, rollDeg: -3, upAxis: 'Z', scale: 2 };
    const v = apply(editedMatrix(origin, e), 0, 0, 0);
    const g = createLocalToGeodetic(origin)(v.x, v.y, v.z);
    expect(g.lon).toBeCloseTo(126.99, 8);
    expect(g.lat).toBeCloseTo(37.58, 8);
    expect(g.alt).toBeCloseTo(55.5, 3);
  });

  it('처음 배치(planPlacement)와 같은 값으로 편집하면 같은 행렬이다', () => {
    const p = planPlacement({ type: 'coords', crs: 'EPSG:4326', x: 126.98, y: 37.57, height: 20, headingDeg: 30, upAxis: 'Z', scale: 0.5 });
    const m = editedMatrix(p.origin, { lon: 126.98, lat: 37.57, height: 20, headingDeg: 30, upAxis: 'Z', scale: 0.5 });
    expect(m.equals(p.matrix) || m.elements.every((v, i) => Math.abs(v - p.matrix.elements[i]) < 1e-9)).toBe(true);
  });
});

describe('describeEdit', () => {
  it('geo면 경위도·높이를, 단일 모델이면 위치 없이 모양만 보여 준다', () => {
    const e = { lon: 128.1, lat: 36.2, height: 5, headingDeg: 10, pitchDeg: 1, rollDeg: 2, upAxis: 'Y', scale: 1 };
    expect(describeEdit(e).map((r) => r[0])).toContain('경도 / 위도');
    expect(describeEdit(e, { geo: false }).map((r) => r[0])).not.toContain('경도 / 위도');
    expect(describeEdit(e).find((r) => r[0] === '방향')[1]).toMatch(/10°/);
  });
});

describe("planPlacement: 'projected' (파일 안의 실제 좌표)", () => {
  // 투영 좌표가 노드 이동값에 들어 있는 건물 glb와 같은 모양: 작은 건물이 노드 이동으로 큰 좌표에 있다 (Y가 위, 북 = -z)
  const info = { bounds: { min: [198080, 140, -551906], max: [198100, 160, -551886] } };

  it('모델 바닥 중심이 5186 좌표가 가리키는 경위도·높이에 놓인다', () => {
    const p = planPlacement({ type: 'projected', crs: 'EPSG:5186' }, info);
    expect(p.mode).toBe('geo');
    expect(p.lonLat.lon).toBeCloseTo(126.978, 2);
    expect(p.lonLat.lat).toBeCloseTo(37.567, 2);
    expect(p.lonLat.height).toBeCloseTo(140, 6);
    // 바닥 중심의 파일 좌표가 로컬 (0, 높이, 0)이 된다 -> 원점이 모델 곁에 있다
    close(apply(p.matrix, 198090, 140, -551896), [0, 140, 0], 4);
  });

  it('파일 안의 좌표 그대로 두 점을 놓으면 서로의 거리·방향이 유지된다 (동쪽 +10 m, 북쪽 +10 m)', () => {
    const p = planPlacement({ type: 'projected', crs: 'EPSG:5186' }, info);
    const east = apply(p.matrix, 198100, 140, -551896);
    const north = apply(p.matrix, 198090, 140, -551906 + 20); // z가 커지면 남쪽
    expect(east.x).toBeCloseTo(10, 4);
    expect(north.z).toBeGreaterThan(0); // -551886은 남쪽 -> 로컬 +z
  });

  it('편집(editedMatrix)에 pivot을 넘기면 처음 배치와 같은 행렬이다', () => {
    const p = planPlacement({ type: 'projected', crs: 'EPSG:5186', headingDeg: 20 }, info);
    const m = editedMatrix(p.origin, { ...p.lonLat, headingDeg: 20, upAxis: 'Y', scale: 1, pivot: p.pivot });
    expect(m.elements.every((v, i) => Math.abs(v - p.matrix.elements[i]) < 1e-6)).toBe(true);
  });

  it('방향을 돌려도 바닥 중심은 제자리다 (pivot 기준 회전)', () => {
    const p = planPlacement({ type: 'projected', crs: 'EPSG:5186', headingDeg: 90 }, info);
    close(apply(p.matrix, 198090, 140, -551896), [0, 140, 0], 4);
  });

  it('Z가 위인 모델은 북 = y, 바닥 = z 로 읽는다', () => {
    const zinfo = { bounds: { min: [198080, 551886, 140], max: [198100, 551906, 160] } };
    const p = planPlacement({ type: 'projected', crs: 'EPSG:5186', upAxis: 'Z' }, zinfo);
    expect(p.lonLat.lat).toBeCloseTo(37.567, 2);
    expect(p.lonLat.height).toBeCloseTo(140, 6);
    close(apply(p.matrix, 198090, 551896, 140), [0, 140, 0], 4);
  });

  it('단위가 mm면 배율을 곱해 읽는다', () => {
    const mm = { bounds: { min: [198080000, 140000, -551906000], max: [198100000, 160000, -551886000] } };
    const p = planPlacement({ type: 'projected', crs: 'EPSG:5186', scale: 0.001 }, mm);
    expect(p.lonLat.lat).toBeCloseTo(37.567, 2);
    expect(p.lonLat.height).toBeCloseTo(140, 6);
  });

  it('범위를 모르거나 좌표가 말이 안 되면 오류', () => {
    expect(() => planPlacement({ type: 'projected', crs: 'EPSG:5186' }, {})).toThrow(/범위/);
    expect(() => planPlacement({ type: 'projected', crs: 'EPSG:4326' }, info)).toThrow(/경위도 범위/);
  });
});
