import * as THREE from 'three';

/**
 * ECEF(지구중심직교좌표)로 authored된 3D Tiles 콘텐츠를, crs.js와 같은 축 규칙
 * (x=동, y=상, z=-북)을 쓰는 origin 기준 로컬 좌표로 옮기는 변환 행렬을 만든다.
 *
 * 3d-tiles-renderer의 Ellipsoid.getEastNorthUpFrame이 주는 ENU 프레임은
 * X=동, Y=북, Z=상 축을 쓴다 -- crs.js(x=동, y=상, z=-북)와는 다른 규칙이라, 그대로
 * 쓰면 3D Tiles 레이어와 래스터 레이어가 서로 다른 방향으로 놓이게 된다. 이를 맞추기
 * 위해 X축 기준 -90도 회전을 추가로 곱한다: (동,북,상) -> (동,상,-북).
 *
 * @param {import('3d-tiles-renderer').Ellipsoid} ellipsoid
 * @param {{lon:number, lat:number, alt?:number}} origin
 * @returns {THREE.Matrix4} ECEF 좌표 -> 로컬 좌표 변환 행렬
 */
export function computeEcefToLocalMatrix(ellipsoid, origin) {
  const latRad = (origin.lat * Math.PI) / 180;
  const lonRad = (origin.lon * Math.PI) / 180;
  const height = origin.alt ?? 0;

  const enuToEcef = new THREE.Matrix4();
  ellipsoid.getEastNorthUpFrame(latRad, lonRad, height, enuToEcef);

  const axisFix = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  return axisFix.multiply(enuToEcef.invert());
}

/**
 * TilesRenderer의 group을 위 변환으로 재배치한다. matrixAutoUpdate를 꺼서 three.js가
 * position/quaternion/scale로부터 matrix를 다시 계산해 덮어쓰지 않게 한다 -- 우리가
 * 직접 계산한 행렬을 그대로 유지해야 하기 때문이다.
 * @param {import('3d-tiles-renderer').TilesRenderer} tiles
 * @param {{lon:number, lat:number, alt?:number}} origin
 */
export function applyGeoTransform(tiles, origin) {
  tiles.group.matrix.copy(computeEcefToLocalMatrix(tiles.ellipsoid, origin));
  tiles.group.matrixAutoUpdate = false;
}
