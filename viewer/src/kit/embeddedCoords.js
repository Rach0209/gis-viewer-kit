import { CRS_LIST, isNearKorea, isValidLonLat, toLonLat } from './crsList.js';

/**
 * 모델 안에 "실제 좌표"가 이미 들어 있는 경우를 다룬다.
 *
 * GIS/CAD에서 내보낸 glb는 건물 모양(작은 크기)과 별개로, 실제 위치(투영 좌표, 예: EPSG:5186의 동·북 값)를
 * 노드 이동값이나 정점 좌표에 담고 있는 경우가 많다. 이런 모델을 "원점을 지도에서 클릭한 곳"에 놓으면 모델이 원점에서
 * 수백 km 떨어진 곳에 놓여 버린다. 이 모듈은 그 좌표를 어느 좌표계로 읽어야 한국 안에 놓이는지 후보를 계산한다.
 *
 * 좌표 읽는 방법은 위쪽 축에 따라 다르다.
 *   Y가 위(glTF 표준):  동 = x,  북 = -z,  높이 = y
 *   Z가 위(CAD 등):     동 = x,  북 = y,   높이 = z
 */

/** 이 거리(단위)보다 원점에서 멀면 "좌표가 들어 있을 수 있다"고 본다 */
export const FAR_FROM_ORIGIN = 5000;

/** 한국 지자체 데이터에서 흔한 순서 (중부원점 5186을 먼저) */
const PREFERENCE = ['EPSG:5186', 'EPSG:5187', 'EPSG:5185', 'EPSG:5179', 'EPSG:4326'];

/** 높이로 받아들일 범위(m). 이를 벗어나면 축을 잘못 읽은 것으로 본다. */
const ELEV_MIN = -500;
const ELEV_MAX = 9000;

/**
 * 모델 중심(파일 좌표)으로 두 가지 읽기 방식의 후보 값을 만든다. 원점 근처면 null.
 * @param {number[]} center [x, y, z] 노드 변환까지 적용한 모델 경계상자의 중심
 * @returns {{yUp:{east:number,north:number,elev:number}|null, zUp:{east:number,north:number,elev:number}|null}|null}
 */
export function embeddedCandidates(center) {
  if (!center) return null;
  const [x, y, z] = center;
  const farY = Math.hypot(x, z) > FAR_FROM_ORIGIN;
  const farZ = Math.hypot(x, y) > FAR_FROM_ORIGIN;
  if (!farY && !farZ) return null;
  return {
    yUp: farY ? { east: x, north: -z, elev: y } : null,
    zUp: farZ ? { east: x, north: y, elev: z } : null,
  };
}

/** 예: 263,792 -> "263,792" */
export const fmtInt = (n) => Math.round(n).toLocaleString('ko-KR');

/**
 * 후보 좌표를 좌표계마다 경위도로 바꿔 보고, 쓸 수 있는 것을 선호 순서로 돌려준다.
 * 쓸 수 있는 조건: 경위도가 유효하고, 높이가 지구 표면 근처(-500~9000 m)이며, 한국 주변이다.
 *
 * @param {{east:number,north:number,elev:number}|null} cand embeddedCandidates()의 yUp 또는 zUp
 * @param {number} [scale=1] 모델 단위 -> m (단위가 mm면 0.001)
 * @returns {Array<{crs:string, label:string, lon:number, lat:number, elev:number, inKorea:boolean}>}
 */
export function guessCrs(cand, scale = 1) {
  if (!cand) return [];
  const elev = cand.elev * scale;
  if (!(elev >= ELEV_MIN && elev <= ELEV_MAX)) return [];
  const out = [];
  for (const crs of PREFERENCE) {
    const info = CRS_LIST.find((c) => c.code === crs);
    if (!info) continue;
    let ll;
    try {
      ll = toLonLat(crs, cand.east * scale, cand.north * scale);
    } catch {
      continue;
    }
    if (!isValidLonLat(ll) || !isNearKorea(ll)) continue;
    out.push({ crs, label: info.label, lon: ll.lon, lat: ll.lat, elev, inKorea: true });
  }
  return out;
}

/** 파일 단위가 mm/cm인 모델도 있어서 이 순서로 배율을 시험한다 (먼저 맞는 것을 쓴다) */
const SCALES = [1, 0.001, 0.01];

/**
 * glb 검사 결과(info)로 "파일 안 실제 좌표" 위치 추천 목록과 경고를 만든다.
 * 해당하지 않는 모델(대부분)은 { suggestions: [], warnings: [] } — 화면에는 아무것도 추가되지 않는다.
 *
 * @param {import('./glbInspect.js').GlbInfo} info
 * @returns {{suggestions: Array<{label:string, spec:object}>, warnings: string[]}}
 */
export function findEmbeddedPlacements(info) {
  const none = { suggestions: [], warnings: [] };
  const c = embeddedCandidates(info?.center);
  if (!c) return none;
  const dist = Math.max(Math.hypot(info.center[0], info.center[2]), Math.hypot(info.center[0], info.center[1]));
  // 가장 먼저 맞는 (배율, 위쪽 축) 조합 하나를 추천한다. 그 조합에서 한국 안으로 읽히는 좌표계는 모두 alternatives로 준다.
  // 서부/중부/동부원점(5185/5186/5187)은 같은 숫자라도 위치가 달라서 값만으로는 구분이 안 되므로, 5186을 기본으로 하고
  // 사용자가 화면에서 바꿀 수 있게 한다.
  const suggestions = [];
  search: for (const scale of SCALES) {
    for (const [upAxis, cand] of [['Y', c.yUp], ['Z', c.zUp]]) {
      const guesses = guessCrs(cand, scale);
      if (!guesses.length) continue;
      const g = guesses[0];
      suggestions.push({
        label: `${g.label} 좌표로 읽기 → 경도 ${g.lon.toFixed(5)}, 위도 ${g.lat.toFixed(5)} (중심 높이 ${g.elev.toFixed(1)} m)`,
        spec: { type: 'projected', crs: g.crs, upAxis, scale },
        lon: g.lon,
        lat: g.lat,
        alternatives: guesses.map(({ crs, label, lon, lat, elev }) => ({ crs, label, lon, lat, elev })),
      });
      break search;
    }
  }
  const warnings = [
    `모델이 파일의 좌표 원점에서 약 ${fmtInt(dist)} 단위 떨어져 있습니다. ` +
      (suggestions.length
        ? '파일에 실제 좌표가 들어 있는 것으로 보입니다 — 아래 추천 위치를 쓰면 지도의 올바른 곳에 놓입니다.'
        : '한국 안의 좌표로는 읽히지 않았습니다. 지도를 클릭해 배치하면 모델이 클릭한 곳이 아니라 그만큼 떨어진 곳에 놓여 화면에 안 보일 수 있습니다.'),
  ];
  return { suggestions, warnings };
}
