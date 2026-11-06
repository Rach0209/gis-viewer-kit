import { isValidLonLat, toLonLat } from './crsList.js';

/**
 * 파일 안의 정점/노드 좌표가 이미 실제 투영 좌표(동·북)인 모델의 "바닥 중심"을 경위도·높이로 바꾼다.
 * three.js 뷰어와 Cesium 페이지가 같이 쓰므로 그래픽 라이브러리에 의존하지 않는다.
 *
 *   Y가 위: 동 = x, 북 = -z, 바닥 = min.y   / Z가 위: 동 = x, 북 = y, 바닥 = min.z
 *
 * @param {{crs:string, upAxis?:'Y'|'Z', scale?:number}} spec 읽을 좌표계, 위쪽 축, 모델 단위 -> m 배율
 * @param {{min:number[], max:number[]}} bounds 노드 변환까지 적용한 파일 안 경계 상자
 * @returns {{east:number, north:number, lon:number, lat:number, height:number, pivot:number[]}}
 *   pivot: 파일 좌표계에서의 바닥 중심 (이 점이 경위도·높이에 놓인다)
 */
export function projectedAnchor(spec, bounds) {
  if (!bounds) throw new Error('모델 범위를 알 수 없어 파일 안의 좌표로 배치할 수 없습니다');
  const { min, max } = bounds;
  const scale = spec.scale ?? 1;
  const cx = (min[0] + max[0]) / 2;
  const z = spec.upAxis === 'Z';
  const cy = (min[1] + max[1]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const east = cx * scale;
  const north = (z ? cy : -cz) * scale;
  const base = z ? min[2] : min[1];
  const pivot = z ? [cx, cy, min[2]] : [cx, min[1], cz];
  const ll = toLonLat(spec.crs, east, north);
  if (!isValidLonLat(ll)) {
    throw new Error(`파일 안의 좌표가 경위도 범위를 벗어납니다 (${ll.lon.toFixed(3)}, ${ll.lat.toFixed(3)}). 좌표계나 크기 배율을 확인하세요.`);
  }
  return { east, north, lon: ll.lon, lat: ll.lat, height: base * scale, pivot };
}
