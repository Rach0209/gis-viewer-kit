/* global Cesium */
/**
 * glb 한 개를 경위도에 놓는 Cesium 쪽 계산과 로딩.
 *
 * three.js 뷰어와 같은 규칙을 쓴다 (모델 좌표: Y가 위일 때 x=동, y=위, -z=북 / Z가 위일 때 x=동, y=북, z=위,
 * 방향(heading)은 위에서 볼 때 시계 방향).
 *
 *   세계 좌표 = 동북위(원점) · 방향 · 크기 · (A·v - A·pivot)      A = 위쪽 축 보정 (Y위: (x,y,z)->(x,-z,y), Z위: 그대로)
 *
 * Cesium은 glTF에 보정 A를 이미 적용한다. forwardAxis를 X로 주면 "앞쪽 +Z -> +X" 보정이 빠져서 A만 남는다.
 * 그래서 modelMatrix = 동북위 · 방향 · 크기 · 이동(-A·pivot) 로 만들면 위 식과 같아진다.
 */

/** 파일 좌표의 pivot을 A로 바꾼다 (동북위 축 기준) */
export function pivotToEnu(pivot, upAxis) {
  if (!pivot) return [0, 0, 0];
  return upAxis === 'Z' ? [pivot[0], pivot[1], pivot[2]] : [pivot[0], -pivot[2], pivot[1]];
}

/**
 * modelMatrix = 동북위(원점) · 방향 · 앞뒤 기울기 · 좌우 기울기 · 크기 · 이동(-A·pivot)
 *  - 방향(headingDeg): 위에서 볼 때 시계 방향이 +  (동북위의 위쪽 축 둘레로 -heading 만큼 회전)
 *  - 앞뒤 기울기(pitchDeg): + 이면 (방향 0일 때) 북쪽이 올라간다  (동쪽 축 둘레로 +pitch)
 *  - 좌우 기울기(rollDeg): + 이면 (방향 0일 때) 동쪽이 올라간다  (북쪽 축 둘레로 -roll)
 *  방향을 돌리면 기울기도 모델과 함께 돈다. 크기와 기울기는 pivot(없으면 모델 원점)을 기준으로 한다.
 */
export function buildModelMatrix({ lon, lat, height = 0, headingDeg = 0, pitchDeg = 0, rollDeg = 0, scale = 1, upAxis = 'Y', pivot = null }) {
  if (!(scale > 0) || !Number.isFinite(scale)) throw new Error('크기 배율은 0보다 큰 숫자여야 합니다');
  const rad = Cesium.Math.toRadians;
  const origin = Cesium.Cartesian3.fromDegrees(lon, lat, height);
  const fixed = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  // 회전은 Cesium.Matrix3 (오른손 법칙: X는 y->z, Y는 z->x, Z는 x->y 방향이 +)
  const rot = Cesium.Matrix3.multiply(
    Cesium.Matrix3.fromRotationZ(-rad(headingDeg)),
    Cesium.Matrix3.multiply(Cesium.Matrix3.fromRotationX(rad(pitchDeg)), Cesium.Matrix3.fromRotationY(-rad(rollDeg)), new Cesium.Matrix3()),
    new Cesium.Matrix3(),
  );
  const rotation = Cesium.Matrix4.fromRotation(rot, new Cesium.Matrix4());
  const q = pivotToEnu(pivot, upAxis);
  const shift = Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(-q[0], -q[1], -q[2]));
  const local = Cesium.Matrix4.multiply(Cesium.Matrix4.fromUniformScale(scale), shift, new Cesium.Matrix4());
  return Cesium.Matrix4.multiply(fixed, Cesium.Matrix4.multiply(rotation, local, new Cesium.Matrix4()), new Cesium.Matrix4());
}

/**
 * @param {File} file
 * @param {{lon:number, lat:number, height?:number, headingDeg?:number, scale?:number, upAxis?:'Y'|'Z', pivot?:number[]|null}} p
 * @returns {Promise<{model: Cesium.Model, objectUrl: string}>} 화면에 올리는 것(primitives.add)은 호출하는 쪽에서 한다
 */
export async function createModel(file, p) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const model = await Cesium.Model.fromGltfAsync({
      url: objectUrl,
      modelMatrix: buildModelMatrix(p),
      upAxis: p.upAxis === 'Z' ? Cesium.Axis.Z : Cesium.Axis.Y,
      forwardAxis: Cesium.Axis.X,
    });
    return { model, objectUrl };
  } catch (e) {
    URL.revokeObjectURL(objectUrl);
    throw e;
  }
}
