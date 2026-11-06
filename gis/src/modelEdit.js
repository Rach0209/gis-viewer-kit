/**
 * 놓은 glb를 고치는(이동·높이·방향·기울기·크기) 순수 계산. Cesium에 의존하지 않아 단독으로 시험할 수 있다.
 * three.js 뷰어(viewer/src/kit/modelPlacement.js)의 편집 규칙과 같은 뜻을 쓴다:
 *   방향: 위에서 볼 때 시계 방향 도 / 앞뒤 기울기(pitch): +이면 북쪽이 올라간다 / 좌우 기울기(roll): +이면 동쪽이 올라간다
 */

export const NUDGE_STEPS = [0.1, 1, 10, 100]; // 이동·높이 한 번에 움직이는 거리(m)

/** 위도 lat(도)에서 위도 1도, 경도 1도가 몇 m인지 (WGS84 근사식) */
export function metersPerDegree(latDeg) {
  const p = (latDeg * Math.PI) / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
    lon: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p),
  };
}

/** 동쪽 dEast m, 북쪽 dNorth m 만큼 옮긴 경위도 (수백 m~수 km 이동에 충분한 정확도) */
export function nudgeLonLat({ lon, lat }, dEast, dNorth) {
  const m = metersPerDegree(lat);
  return { lon: lon + dEast / m.lon, lat: Math.max(-89.9, Math.min(89.9, lat + dNorth / m.lat)) };
}

/** 각도를 (-180, 180] 로 */
export function normalizeDeg(d) {
  const r = ((((d + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r;
}

const FIELDS = {
  lon: (v) => v,
  lat: (v) => Math.max(-89.9, Math.min(89.9, v)),
  height: (v) => v,
  headingDeg: normalizeDeg,
  pitchDeg: (v) => Math.max(-90, Math.min(90, v)),
  rollDeg: (v) => Math.max(-90, Math.min(90, v)),
  scale: (v) => {
    if (!(v > 0)) throw new Error('크기 배율은 0보다 큰 숫자여야 합니다 (단위가 mm면 0.001)');
    return v;
  },
};

/**
 * 고친 값을 검증·정리한다. 숫자가 아니면 오류, 각도는 범위로, 위도는 극 근처를 막는다.
 * @param {Record<string, any>} patch 바꿀 항목만 (lon, lat, height, headingDeg, pitchDeg, rollDeg, scale, upAxis)
 */
export function sanitizeEdit(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'upAxis') {
      if (v !== 'Y' && v !== 'Z') throw new Error("위쪽 축은 'Y' 또는 'Z' 여야 합니다");
      out.upAxis = v;
    } else if (FIELDS[k]) {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${k} 값은 숫자여야 합니다`);
      out[k] = FIELDS[k](v);
    }
  }
  return out;
}

/** 편집 가능한 값만 뽑아 복사 (처음 값 저장용) */
export function pickEditable(meta) {
  const { lon, lat, height, headingDeg = 0, pitchDeg = 0, rollDeg = 0, scale = 1, upAxis = 'Y' } = meta;
  return { lon, lat, height, headingDeg, pitchDeg, rollDeg, scale, upAxis };
}
