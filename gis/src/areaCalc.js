/**
 * 지구(WGS84 타원체) 표면 위 다각형의 면적 계산 (Cesium 비의존, 순수 함수).
 *
 * 방법: 면적을 보존하는 원통도법(램버트 정적 원통)으로 옮겨 신발끈 공식으로 구한다.
 *   x = Ra · 경도(라디안),  y = Ra · sin(정적 위도 β)   (β: 타원체를 같은 넓이의 구로 옮기는 위도, Ra: 그 구의 반지름)
 * 이 투영은 면적이 그대로라서 타원체 위의 정확한 면적이 나온다. 변은 두 점 사이의 대원(최단 경로)을 따라 잘게 나눠서 따른다.
 */

const A = 6378137;
const E2 = 0.00669437999014;
const E = Math.sqrt(E2);
const D2R = Math.PI / 180;

const q = (phi) => {
  const s = Math.sin(phi);
  return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
};
const QP = q(Math.PI / 2);
/** 같은 넓이의 구 반지름 (약 6371007.18 m) */
export const AUTHALIC_RADIUS = A * Math.sqrt(QP / 2);

const sinBeta = (latRad) => q(latRad) / QP;

const toVec = ([lon, lat]) => {
  const l = lon * D2R;
  const p = lat * D2R;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
};
const fromVec = ([x, y, z]) => [Math.atan2(y, x) / D2R, Math.atan2(z, Math.hypot(x, y)) / D2R];

/** 두 점 사이를 대원을 따라 maxStepM 이하 간격으로 나눈 점들 (끝점 제외, 시작점 포함) */
function densify(a, b, maxStepM) {
  const va = toVec(a);
  const vb = toVec(b);
  const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const ang = Math.acos(dot);
  const n = Math.min(2000, Math.ceil((ang * AUTHALIC_RADIUS) / maxStepM));
  if (n <= 1 || ang < 1e-12) return [a];
  const sin = Math.sin(ang);
  const out = [a];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const wa = Math.sin((1 - t) * ang) / sin;
    const wb = Math.sin(t * ang) / sin;
    out.push(fromVec([wa * va[0] + wb * vb[0], wa * va[1] + wb * vb[1], wa * va[2] + wb * vb[2]]));
  }
  return out;
}

/**
 * 다각형(바깥 고리) 면적 (제곱미터). 고리는 닫혀 있지 않아도 된다 (끝점이 시작점과 같아도 된다).
 * @param {Array<[number, number]>} ring [경도, 위도] (도)
 * @param {{maxStepM?:number}} [o] 변을 나누는 최대 간격(m). 기본 5 km: 이보다 짧은 변은 나누지 않는다
 */
export function ringAreaM2(ring, { maxStepM = 5000 } = {}) {
  let pts = ring;
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
  if (pts.length < 3) return 0;
  const dense = [];
  for (let i = 0; i < pts.length; i++) dense.push(...densify(pts[i], pts[(i + 1) % pts.length], maxStepM));
  // 날짜 변경선을 가로질러도 이어지게 경도를 앞 점 기준으로 펼친다
  let lon = dense[0][0];
  const xy = dense.map(([lo, la], i) => {
    if (i > 0) {
      let d = lo - ((lon % 360) + 540) % 360 + 180;
      d = ((d + 540) % 360) - 180;
      lon += d;
    }
    return [lon * D2R, sinBeta(la * D2R)];
  });
  let sum = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x0, y0] = xy[i];
    const [x1, y1] = xy[(i + 1) % xy.length];
    sum += x0 * y1 - x1 * y0;
  }
  return Math.abs(sum / 2) * AUTHALIC_RADIUS * AUTHALIC_RADIUS;
}

/** 구멍이 있는 다각형: 바깥 면적에서 구멍 면적을 뺀다 */
export function polygonAreaM2(outer, holes = [], o) {
  return Math.max(0, ringAreaM2(outer, o) - holes.reduce((a, h) => a + ringAreaM2(h, o), 0));
}
