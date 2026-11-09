/**
 * 성능 모드: 사양이 낮은 PC(코어가 적거나 메모리가 작은 사무용, 내장 그래픽)에서 덜 무겁게 돌리는 설정 묶음.
 * 3D 뷰어와 GIS 작업실이 같이 쓴다 (같은 사이트라 설정도 서로 공유한다).
 *
 *   'auto'   이 PC의 코어 수·메모리로 판단 (기본)
 *   'low'    저사양 설정을 강제
 *   'normal' 일반 설정을 강제
 *
 * 저사양 설정: 선 부드럽게(안티앨리어싱) 끔, 고해상도 화면 배율 1배, 3D 타일 품질 기준을 한 단계 낮춤(덜 자세히 불러옴),
 * 큰 지형(DEM) 파일 상한을 낮춤. 화질이 조금 떨어지는 대신 그리기와 메모리 부담이 줄어든다.
 * 이 모듈은 DOM·Cesium·three.js를 모르는 순수 함수라 단독으로 시험한다.
 */

export const PERF_KEY = 'gis-viewer-kit:perf';
export const PERF_MODES = ['auto', 'low', 'normal'];

/** 코어(논리 프로세서)가 이 수 이하이거나, 메모리(GB)가 이 값 이하이면 저사양으로 본다 */
export const LOW_CORES = 4;
export const LOW_MEMORY_GB = 4;

/** 지형 격자 상한(화소 수): Float32 4바이트 x 화소 수가 메모리를 차지하고, 읽는 중에는 복사본도 생긴다 */
export const DEM_MAX_PIXELS = { normal: 120_000_000, low: 40_000_000 };

/**
 * @param {{cores?:number, memoryGB?:number}} env 브라우저가 알려 주는 값. 모르는 값(undefined)은 판단에 쓰지 않는다
 *   (deviceMemory는 크롬 계열만 알려 주고, 값이 있어도 8GB로 잘려서 온다)
 */
export function isLowEndDevice({ cores, memoryGB } = {}) {
  const fewCores = Number.isFinite(cores) && cores > 0 && cores <= LOW_CORES;
  const smallMemory = Number.isFinite(memoryGB) && memoryGB > 0 && memoryGB <= LOW_MEMORY_GB;
  return fewCores || smallMemory;
}

/** 지금 브라우저의 사양 정보 */
export function readEnv(nav = globalThis.navigator) {
  return { cores: nav?.hardwareConcurrency, memoryGB: nav?.deviceMemory };
}

/** 저장해 둔 선택을 읽는다. 없거나 알 수 없는 값이면 'auto' */
export function loadPref(storage) {
  try {
    const v = (storage ?? globalThis.localStorage)?.getItem(PERF_KEY);
    return PERF_MODES.includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function savePref(pref, storage) {
  try {
    (storage ?? globalThis.localStorage)?.setItem(PERF_KEY, PERF_MODES.includes(pref) ? pref : 'auto');
  } catch {
    /* 저장을 못 해도(시크릿 창 등) 이번 방문에는 적용된다 */
  }
}

/**
 * 선택(pref)과 사양(env)으로 실제 설정을 정한다.
 * @param {'auto'|'low'|'normal'} pref
 * @param {{cores?:number, memoryGB?:number}} env
 * @returns {{
 *   pref: 'auto'|'low'|'normal', lowEnd: boolean, detectedLow: boolean,
 *   antialias: boolean, maxPixelRatio: number, tileQualityScale: number, maxDemPixels: number, msaaSamples: number,
 *   label: string, reason: string,
 * }}
 */
export function resolvePerf(pref = 'auto', env = {}) {
  const p = PERF_MODES.includes(pref) ? pref : 'auto';
  const detectedLow = isLowEndDevice(env);
  const lowEnd = p === 'low' ? true : p === 'normal' ? false : detectedLow;
  const cores = Number.isFinite(env.cores) ? `코어 ${env.cores}개` : '';
  const mem = Number.isFinite(env.memoryGB) ? `메모리 약 ${env.memoryGB}GB` : '';
  const detail = [cores, mem].filter(Boolean).join(', ') || '사양 정보를 알 수 없음';
  return {
    pref: p,
    lowEnd,
    detectedLow,
    antialias: !lowEnd,
    maxPixelRatio: lowEnd ? 1 : 2,
    // 3D 타일이 "충분히 자세하다"고 보는 화면 오차 기준에 곱한다. 클수록 덜 자세히 불러와서 가볍다
    tileQualityScale: lowEnd ? 1.5 : 1,
    maxDemPixels: lowEnd ? DEM_MAX_PIXELS.low : DEM_MAX_PIXELS.normal,
    msaaSamples: lowEnd ? 1 : 4,
    label: lowEnd ? '저사양' : '일반',
    reason: p === 'auto' ? `이 PC 사양(${detail})으로 판단: ${detectedLow ? '저사양' : '일반'}` : `직접 선택: ${lowEnd ? '저사양' : '일반'} (${detail})`,
  };
}

/** 저장된 선택과 지금 브라우저 사양으로 한 번에 */
export function currentPerf(storage, nav) {
  return resolvePerf(loadPref(storage), readEnv(nav));
}

/** 격자가 상한을 넘을 때 보여 줄 안내 문장 (저사양이면 모드를 바꿀 수 있다는 말을 덧붙인다) */
export function demLimitHint(perf) {
  return perf.lowEnd
    ? ` 저사양 모드라서 상한을 낮췄습니다(${(perf.maxDemPixels / 1e6).toFixed(0)}백만 화소). 더 큰 파일이 꼭 필요하면 "성능" 선택을 "일반"으로 바꾸세요(브라우저가 느려지거나 멈출 수 있습니다).`
    : '';
}
