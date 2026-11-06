/**
 * 웹 메르카토르(슬리피맵) 화면 좌표 수학. 지도 선택기(MapPicker)가 쓰는 순수 함수라 화면 없이 시험할 수 있다.
 *
 * "월드 픽셀": 줌 z에서 세계 전체를 256 * 2^z 픽셀 정사각형으로 펼쳤을 때의 좌표. 왼쪽 위(경도 -180, 위도 85.05)가 (0, 0).
 */

export const TILE_SIZE = 256;
/** 웹 메르카토르가 표현하는 최대 위도 */
export const MAX_LAT = 85.0511287798;

const clampLat = (lat) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));

/** 줌 z의 세계 한 변 길이(픽셀) */
export const worldSize = (z) => TILE_SIZE * 2 ** z;

/** 경위도 -> 월드 픽셀 */
export function lonLatToWorld(lon, lat, z) {
  const size = worldSize(z);
  const rad = (clampLat(lat) * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * size,
  };
}

/** 월드 픽셀 -> 경위도. 경도는 -180~180으로 되감는다(지도를 가로로 여러 바퀴 끌어도 값이 맞게). */
export function worldToLonLat(x, y, z) {
  const size = worldSize(z);
  const lonRaw = (x / size) * 360 - 180;
  const lon = ((((lonRaw + 180) % 360) + 360) % 360) - 180;
  const n = Math.PI - (2 * Math.PI * y) / size;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lon, lat };
}

/**
 * 줌을 바꿀 때 커서 아래의 지점이 그대로 커서 아래에 있도록 새 중심(월드 픽셀)을 구한다.
 * @param {{x:number,y:number}} center 현재 중심 (줌 z의 월드 픽셀)
 * @param {{x:number,y:number}} offset 화면 중심에서 커서까지의 오프셋(px)
 * @param {number} z 현재 줌
 * @param {number} newZ 새 줌
 */
export function zoomAround(center, offset, z, newZ) {
  const k = 2 ** (newZ - z);
  // 커서 아래 점(현재 줌) -> 새 줌의 월드 픽셀
  const px = (center.x + offset.x) * k;
  const py = (center.y + offset.y) * k;
  return { x: px - offset.x, y: py - offset.y };
}

/**
 * 화면(뷰포트)을 덮는 타일 목록. x는 세계를 가로로 감싸 되돌린 값(tx)과 화면에 그릴 위치(px, py)를 함께 준다.
 * @param {{x:number,y:number}} center 줌 z의 월드 픽셀 중심
 * @param {number} z 정수 줌
 * @param {number} width 뷰포트 너비(px)
 * @param {number} height 뷰포트 높이(px)
 * @returns {Array<{z:number, x:number, y:number, key:string, left:number, top:number}>} x는 0..2^z-1로 감싼 타일 번호, left/top은 뷰포트 안 위치(px)
 */
export function visibleTiles(center, z, width, height) {
  const n = 2 ** z;
  const x0 = center.x - width / 2;
  const y0 = center.y - height / 2;
  const txMin = Math.floor(x0 / TILE_SIZE);
  const txMax = Math.floor((x0 + width) / TILE_SIZE);
  const tyMin = Math.max(0, Math.floor(y0 / TILE_SIZE));
  const tyMax = Math.min(n - 1, Math.floor((y0 + height) / TILE_SIZE));
  const out = [];
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      const wrapped = ((tx % n) + n) % n;
      out.push({
        z,
        x: wrapped,
        y: ty,
        key: `${z}/${tx}/${ty}`, // 감싸기 전 번호로 구분: 같은 타일이 화면에 두 번 나올 수 있다
        left: tx * TILE_SIZE - x0,
        top: ty * TILE_SIZE - y0,
      });
    }
  }
  return out;
}

/** 중심의 y가 세계 밖으로 나가지 않게 (위도 한계), x는 자유롭게 */
export function clampCenter(center, z, height) {
  const size = worldSize(z);
  const minY = Math.min(height / 2, size / 2);
  const maxY = Math.max(size - height / 2, size / 2);
  return { x: center.x, y: Math.max(minY, Math.min(maxY, center.y)) };
}
