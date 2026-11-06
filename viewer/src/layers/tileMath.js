/**
 * 표준 슬리피맵(XYZ) 타일 좌표 계산. three.js/DOM에 의존하지 않는 순수 함수만 모아두어
 * 렌더링 없이 단위 테스트할 수 있게 한다.
 */

/**
 * 경도를 주어진 줌 레벨의 타일 x 인덱스로 변환한다.
 * @param {number} lon - 경도 (도)
 * @param {number} zoom
 * @returns {number}
 */
export function lonToTileX(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

/**
 * 위도를 주어진 줌 레벨의 타일 y 인덱스로 변환한다 (Web Mercator).
 * 위도가 커질수록(북쪽으로 갈수록) 타일 y 인덱스는 작아진다 -- 부호를 헷갈리기 쉬운
 * 지점이라 computeTileRange에서 이 함수 이름으로만 남/북을 구분한다.
 * @param {number} lat - 위도 (도)
 * @param {number} zoom
 * @returns {number}
 */
export function latToTileY(lat, zoom) {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom
  );
}

/**
 * 타일 x 인덱스를 그 타일의 서쪽 경계 경도로 변환한다 (lonToTileX의 역함수).
 * @param {number} x
 * @param {number} zoom
 * @returns {number}
 */
export function tileXToLon(x, zoom) {
  return (x / 2 ** zoom) * 360 - 180;
}

/**
 * 타일 y 인덱스를 그 타일의 북쪽 경계 위도로 변환한다 (latToTileY의 역함수).
 * @param {number} y
 * @param {number} zoom
 * @returns {number}
 */
export function tileYToLat(y, zoom) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * 위경도 bbox와 줌 레벨로부터 필요한 타일의 {x,y} 인덱스 범위를 계산한다.
 * @param {{west:number, south:number, east:number, north:number}} bbox
 * @param {number} zoom
 * @returns {{zoom:number, xMin:number, xMax:number, yMin:number, yMax:number}}
 */
export function computeTileRange(bbox, zoom) {
  return {
    zoom,
    xMin: lonToTileX(bbox.west, zoom),
    xMax: lonToTileX(bbox.east, zoom),
    yMin: latToTileY(bbox.north, zoom), // north -> 더 작은 y
    yMax: latToTileY(bbox.south, zoom), // south -> 더 큰 y
  };
}

/**
 * computeTileRange의 결과를 실제 로드할 {z,x,y} 목록으로 펼친다.
 * @param {{zoom:number, xMin:number, xMax:number, yMin:number, yMax:number}} range
 * @returns {Array<{z:number, x:number, y:number}>}
 */
export function enumerateTiles(range) {
  const tiles = [];
  for (let x = range.xMin; x <= range.xMax; x++) {
    for (let y = range.yMin; y <= range.yMax; y++) {
      tiles.push({ z: range.zoom, x, y });
    }
  }
  return tiles;
}
