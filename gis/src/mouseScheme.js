/**
 * 지도 마우스 조작을 3D 뷰어(three.js 지도 모드)와 똑같이 맞춘다.
 *
 *            3D 뷰어(three.js)            Cesium 기본값
 *   좌 드래그  이동                         이동 (같음)
 *   우 드래그  회전                         확대/축소  -> 회전(기울기·방향)으로 바꾼다
 *   휠         확대/축소                    확대/축소 (같음)
 *   휠 누르고 드래그  확대/축소             회전        -> 확대/축소로 바꾼다
 *
 * 두 화면을 오가도 손이 같게 움직이도록 하는 것이 목적이다. 터치(두 손가락 모으기/기울이기)는 기본값을 그대로 둔다.
 * Cesium의 "회전"은 지도를 잡은 지점을 중심으로 기울이고 돌리는 조작이다 (tilt).
 */

/** 화면에 보여 줄 조작 안내 (3D 뷰어의 지도 모드 안내와 같은 문장) */
export const MOUSE_HINT = '좌클릭 드래그: 이동 · 우클릭 드래그: 회전 · 휠: 확대/축소';

/**
 * @param {typeof import('cesium')} Cesium CameraEventType, KeyboardEventModifier 를 쓴다
 * @param {import('cesium').ScreenSpaceCameraController} controller viewer.scene.screenSpaceCameraController
 */
export function applyMouseScheme(Cesium, controller) {
  const T = Cesium.CameraEventType;
  const M = Cesium.KeyboardEventModifier;
  // 확대/축소: 휠, 휠 누르고 드래그, 두 손가락 모으기 (우 드래그는 회전에 넘긴다)
  controller.zoomEventTypes = [T.WHEEL, T.MIDDLE_DRAG, T.PINCH];
  // 회전: 우 드래그, 두 손가락 기울이기, Ctrl + 좌 드래그(노트북 터치패드 등 우클릭이 불편할 때)
  controller.tiltEventTypes = [T.RIGHT_DRAG, T.PINCH, { eventType: T.LEFT_DRAG, modifier: M.CTRL }];
  // 이동(rotateEventTypes = 좌 드래그)과 둘러보기(Shift + 좌 드래그)는 기본값 그대로
  return controller;
}
