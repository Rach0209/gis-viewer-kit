/**
 * 배경 지도. ion(유료)을 쓰지 않고 OSM / VWorld 같은 XYZ 타일만 쓴다.
 * 공급자 정의(주소, 최대 줌, 출처 표기)는 three.js 뷰어와 같은 파일을 쓴다.
 */
import { PROVIDERS, resolveProvider } from '../../viewer/src/kit/rasterProviders.js';

export const IMAGERY_OPTIONS = [
  ...Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, needsKey: p.needsKey })),
  { id: 'none', label: '쓰지 않음', needsKey: false },
];

/** @returns {Cesium.UrlTemplateImageryProvider|null} 키가 필요한데 없으면 오류 */
export function createImageryProvider(Cesium, id, apiKey = '') {
  if (id === 'none') return null;
  const p = resolveProvider(id, apiKey);
  return new Cesium.UrlTemplateImageryProvider({
    url: p.urlTemplate,
    maximumLevel: p.maxZoom,
    credit: p.attribution,
  });
}
