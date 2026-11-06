/**
 * 글자 라벨과 점선에 쓰는 순수 계산 (Cesium 비의존).
 * 좌표는 [경도, 위도] (도). 면적·길이는 작은 지역에서 경도를 cos(위도)로 줄여 평면처럼 계산한다 (라벨 위치용으로 충분).
 */

const k = (lat) => Math.cos((lat * Math.PI) / 180);

/** 닫힌/열린 고리 점 하나가 고리 안인가 (짝수-홀수 규칙) */
export function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 바깥 고리 안이고 구멍 안이 아닌가 */
export function pointInPolygon(pt, outer, holes = []) {
  return pointInRing(pt, outer) && !holes.some((h) => pointInRing(pt, h));
}

/** 면적 가중 중심 (고리가 퇴화하면 꼭짓점 평균) */
export function ringCentroid(ring) {
  const lat0 = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  const kk = k(lat0);
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const x0 = ring[j][0] * kk;
    const y0 = ring[j][1];
    const x1 = ring[i][0] * kk;
    const y1 = ring[i][1];
    const f = x0 * y1 - x1 * y0;
    a2 += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a2) < 1e-18) return [ring.reduce((a, p) => a + p[0], 0) / ring.length, lat0];
  return [cx / (3 * a2) / kk, cy / (3 * a2)];
}

/** 점에서 고리들의 가장자리까지의 (경도를 줄인 평면) 거리 */
function distToEdges(pt, rings, kk) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = ring[j][0] * kk;
      const ay = ring[j][1];
      const bx = ring[i][0] * kk;
      const by = ring[i][1];
      const px = pt[0] * kk;
      const py = pt[1];
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
    }
  }
  return best;
}

/**
 * 면의 글자를 놓을 점: 중심이 면 안이면 그것, 아니면(오목한 면, 구멍 속 등) 면 안에서 가장자리와 가장 먼 점을 격자로 찾는다.
 * @param {number[][]} outer
 * @param {number[][][]} [holes]
 * @returns {[number, number]}
 */
export function polygonLabelPoint(outer, holes = []) {
  const c = ringCentroid(outer);
  if (pointInPolygon(c, outer, holes)) return c;
  const xs = outer.map((p) => p[0]);
  const ys = outer.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const kk = k((y0 + y1) / 2);
  let best = null;
  let bestD = -1;
  const N = 24;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const p = [x0 + ((x1 - x0) * i) / N, y0 + ((y1 - y0) * j) / N];
      if (!pointInPolygon(p, outer, holes)) continue;
      const d = distToEdges(p, [outer, ...holes], kk);
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best ?? [outer[0][0], outer[0][1]];
}

/** 선을 따라 절반 지점 */
export function lineMidpoint(coords) {
  if (coords.length === 1) return coords[0];
  const lat0 = coords.reduce((a, p) => a + p[1], 0) / coords.length;
  const kk = k(lat0);
  const seg = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const l = Math.hypot((coords[i][0] - coords[i - 1][0]) * kk, coords[i][1] - coords[i - 1][1]);
    seg.push(l);
    total += l;
  }
  let half = total / 2;
  for (let i = 0; i < seg.length; i++) {
    if (half <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? Math.min(1, half / seg[i]) : 0;
      return [coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t];
    }
    half -= seg[i];
  }
  return coords[0];
}

/**
 * SLD의 stroke-dasharray([켬, 끔, ...] 픽셀)를 Cesium 점선 설정(한 주기 길이와 16비트 켬/끔 무늬)으로.
 * 홀수 개이면 반복해서 짝수로 맞춘다 (SVG 규칙). 비트 i가 1이면 주기의 i번째 16분의 1 구간이 그려진다.
 * @param {number[]} dash
 * @returns {{dashLength:number, dashPattern:number}}
 */
export function dashToCesium(dash) {
  const d = dash.length % 2 ? [...dash, ...dash] : dash;
  const length = d.reduce((a, b) => a + b, 0);
  let pattern = 0;
  for (let i = 0; i < 16; i++) {
    let pos = ((i + 0.5) / 16) * length;
    let on = true;
    for (let s = 0; s < d.length; s++) {
      if (pos < d[s]) {
        on = s % 2 === 0;
        break;
      }
      pos -= d[s];
    }
    if (on) pattern |= 1 << i;
  }
  return { dashLength: length, dashPattern: pattern };
}
