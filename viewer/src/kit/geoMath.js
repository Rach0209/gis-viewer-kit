import * as THREE from 'three';
import { WGS84_ELLIPSOID } from '3d-tiles-renderer';
import { computeEcefToLocalMatrix } from '../core/geo/ecefFrame.js';
import { ecefToGeodetic } from './analyzeTileset.js';

/**
 * geo 모드의 로컬 좌표(x=동, y=상, z=-북, 원점 기준) -> 경위도/타원체고.
 *
 * 타일셋을 로컬 좌표로 옮길 때 쓰는 변환(computeEcefToLocalMatrix)의 정확한 역변환이라,
 * 화면에 보이는 3D Tiles와 표시 좌표가 어긋나지 않는다. 기존 앱의 좌표 표시는 별도
 * 투영좌표계(proj4, EPSG:5179 등)를 거치는데, 그건 사용자가 임의의 타일셋을 열 때는
 * 좌표계를 알 수 없어서 쓰지 않는다.
 *
 * @param {{lon:number, lat:number, alt?:number}} origin
 * @returns {(x:number, y:number, z:number) => {lon:number, lat:number, alt:number}}
 */
export function createLocalToGeodetic(origin) {
  const inverse = computeEcefToLocalMatrix(WGS84_ELLIPSOID, origin).invert();
  const v = new THREE.Vector3();
  return (x, y, z) => {
    v.set(x, y, z).applyMatrix4(inverse);
    return ecefToGeodetic(v.x, v.y, v.z);
  };
}

/**
 * 경위도/타원체고 -> geo 모드의 로컬 좌표. {@link createLocalToGeodetic}의 반대 방향이며,
 * 3D Tiles를 로컬로 옮기는 것과 같은 변환(computeEcefToLocalMatrix)을 쓴다.
 * 그래서 이 함수로 놓은 배경 지도는 3D Tiles와 같은 기준(WGS84 타원체, 원점의 접평면)에 정확히 겹친다.
 * (EPSG:3857 같은 투영좌표를 그대로 로컬 좌표로 쓰면 위도 36도에서 길이가 약 24% 늘어나 어긋난다.)
 *
 * @param {{lon:number, lat:number, alt?:number}} origin
 * @returns {(lon:number, lat:number, alt?:number) => {x:number, y:number, z:number}}
 */
export function createGeodeticToLocal(origin) {
  const toLocal = computeEcefToLocalMatrix(WGS84_ELLIPSOID, origin);
  const v = new THREE.Vector3();
  const DEG = Math.PI / 180;
  return (lon, lat, alt = 0) => {
    WGS84_ELLIPSOID.getCartographicToPosition(lat * DEG, lon * DEG, alt, v);
    v.applyMatrix4(toLocal);
    return { x: v.x, y: v.y, z: v.z };
  };
}
