/**
 * 점들을 화면의 "비어 있는 영역"(패널에 가리지 않는 부분)에 여유 있게 담는 수직(위에서 내려다보는) 카메라 위치 계산.
 * Cesium을 모르는 순수 함수. 화면 좌표는 캔버스 기준 px (왼쪽 위가 0,0), 지도는 북쪽이 위인 수직 시점이다.
 */

const R = 6378137;

/**
 * 패널들에 가리지 않는 가장 큰 직사각형을 찾는다.
 * @param {number} W 캔버스 너비 px
 * @param {number} H 캔버스 높이 px
 * @param {{left:number, top:number, right:number, bottom:number}[]} panels 지도를 가리는 패널들
 * @param {{edge?:number, around?:number, minSide?:number}} [o] edge: 캔버스 가장자리 여유, around: 패널 둘레 여유, minSide: 이보다 좁은 영역은 버림
 * @returns {{left:number, top:number, right:number, bottom:number}}
 */
export function freeRect(W, H, panels, { edge = 16, around = 12, minSide = 80 } = {}) {
  const P = panels.map((p) => ({ left: p.left - around, top: p.top - around, right: p.right + around, bottom: p.bottom + around }));
  const clamp = (v, max) => Math.max(0, Math.min(max, v));
  const xs = [...new Set([0, W, ...P.flatMap((p) => [clamp(p.left, W), clamp(p.right, W)])])].sort((a, b) => a - b);
  const ys = [...new Set([0, H, ...P.flatMap((p) => [clamp(p.top, H), clamp(p.bottom, H)])])].sort((a, b) => a - b);
  let best = null;
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      for (let a = 0; a < ys.length; a++) {
        for (let b = a + 1; b < ys.length; b++) {
          const r = { left: xs[i] + edge, right: xs[j] - edge, top: ys[a] + edge, bottom: ys[b] - edge };
          const w = r.right - r.left;
          const h = r.bottom - r.top;
          if (w < minSide || h < minSide) continue;
          // 가장자리 여유를 뺀 영역이 패널(여유 포함)과 겹치지 않아야 한다
          if (P.some((p) => r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top)) continue;
          if (!best || w * h > best.area) best = { ...r, area: w * h };
        }
      }
    }
  }
  if (!best) return { left: edge, top: edge, right: W - edge, bottom: H - edge };
  const { area, ...rect } = best;
  return rect;
}

/**
 * 점들을 rect 안에 여유 있게 담는 수직 카메라.
 * @param {{lon:number, lat:number}[]} points 경위도 (라디안)
 * @param {{left:number, top:number, right:number, bottom:number}} rect 점들이 들어갈 화면 영역 (px)
 * @param {{W:number, H:number, metersPerPxPerHeight:number, pad?:number, minMeters?:number}} o
 *   metersPerPxPerHeight: 카메라 높이 1 m 당 화면 1px 이 나타내는 땅의 m (수직 시점에서 높이에 비례하는 상수, 지금 카메라로 구한다)
 *   pad: 점들의 크기의 몇 배를 사방에 더할지, minMeters: 점들이 거의 한 곳이어도 최소한 보일 크기(m)
 * @returns {{lon:number, lat:number, height:number}} 카메라가 내려다볼 땅 위 중심점(캔버스 한가운데에 오는 점)과 카메라 높이 (라디안, m)
 */
export function fitTopDown(points, rect, { W, H, metersPerPxPerHeight, pad = 0.2, minMeters = 20 }) {
  const lat0 = points.reduce((a, p) => a + p.lat, 0) / points.length;
  const lon0 = points.reduce((a, p) => a + p.lon, 0) / points.length;
  const k = Math.cos(lat0);
  const east = points.map((p) => (p.lon - lon0) * R * k);
  const north = points.map((p) => (p.lat - lat0) * R);
  const [e0, e1] = [Math.min(...east), Math.max(...east)];
  const [n0, n1] = [Math.min(...north), Math.max(...north)];
  const bw = Math.max(e1 - e0, minMeters) * (1 + 2 * pad);
  const bh = Math.max(n1 - n0, minMeters) * (1 + 2 * pad);
  const rw = rect.right - rect.left;
  const rh = rect.bottom - rect.top;
  // 화면 1px 이 나타내야 하는 땅의 길이: 가로·세로 둘 다 들어가는 쪽
  const mPerPx = Math.max(bw / rw, bh / rh);
  const height = mPerPx / metersPerPxPerHeight;
  // 점들 상자의 중심이 rect 중심에 오도록 카메라 중심(캔버스 한가운데)을 옮긴다. 화면 오른쪽=동, 아래=남.
  const ce = (e0 + e1) / 2;
  const cn = (n0 + n1) / 2;
  const dx = (rect.left + rect.right) / 2 - W / 2;
  const dy = (rect.top + rect.bottom) / 2 - H / 2;
  const camE = ce - dx * mPerPx;
  const camN = cn + dy * mPerPx;
  return { lon: lon0 + camE / (R * k), lat: lat0 + camN / R, height };
}
