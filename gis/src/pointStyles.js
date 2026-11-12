/**
 * 점(Point) 모양 선택지. DOM·Cesium을 모르는 순수 모듈 (화면과 vectorLayer.js 가 같이 쓴다).
 *
 *  - circle(동그라미): 색 채움 + 흰 테두리. 중심이 위치라서 정확하고, 겹쳐도 알아보기 쉽다
 *  - dot(작은 점): 점이 아주 많을 때. 작고 가볍다
 *  - pin(핀): Cesium 기본 핀(말풍선 모양). 뾰족한 끝이 위치다
 *
 * 마지막으로 고른 모양은 이 브라우저에 기억해 다음에 열 때 기본으로 쓴다 (저장소를 못 쓰면 기본값).
 */
export const POINT_STYLES = [
  { id: 'circle', label: '동그라미', size: 12, outline: 2 },
  { id: 'dot', label: '작은 점', size: 8, outline: 1 },
  { id: 'pin', label: '핀', size: 0, outline: 0 },
];

/** 아무것도 고르지 않았을 때의 모양 */
export const DEFAULT_POINT_STYLE = 'pin';

/**
 * 점이 이 개수 이상이면 '핀'은 지도에 올리는 데 너무 오래 걸린다 (핀은 점마다 그림 하나라서, 3만 개를 올리는 데
 * 그래픽 가속이 없는 시험 브라우저에서 약 25초, 작은 점은 약 3초 걸렸다). PC에 따라 많이 달라서 정확한 값은 아니고 안전하게 잡은 기준이다.
 */
export const HEAVY_POINT_COUNT = 10000;

/** 점이 아주 많은데 '핀'이면 가벼운 '작은 점'으로 바꿔 준다. 그 밖에는 고른 그대로. */
export const lightPointStyleFor = (id, count) => (normalizePointStyle(id) === 'pin' && count >= HEAVY_POINT_COUNT ? 'dot' : normalizePointStyle(id));

const KEY = 'gis-viewer-kit:pointStyle';

/** 알 수 없는 값은 기본 모양으로 */
export const normalizePointStyle = (id) => (POINT_STYLES.some((s) => s.id === id) ? id : DEFAULT_POINT_STYLE);

export const pointStyleSpec = (id) => POINT_STYLES.find((s) => s.id === normalizePointStyle(id));

/** 도형 종류 목록에 점이 있는가 (없으면 모양을 고를 일이 없다) */
export const hasPointGeometry = (types) => (types ?? []).some((t) => t === 'Point' || t === 'MultiPoint' || t === 'GeometryCollection');

/** 마지막으로 고른 모양 (storage: localStorage 같은 getItem/setItem 객체. 못 쓰면 기본값) */
export function loadPointStyle(storage = globalThis.localStorage) {
  try {
    return normalizePointStyle(storage?.getItem(KEY));
  } catch {
    return DEFAULT_POINT_STYLE;
  }
}

export function savePointStyle(id, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, normalizePointStyle(id));
  } catch {
    /* 저장소를 못 쓰는 환경 — 기억하지 않을 뿐이다 */
  }
}
