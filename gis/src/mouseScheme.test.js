import { describe, expect, it } from 'vitest';
import { MOUSE_HINT, applyMouseScheme } from './mouseScheme.js';

// Cesium 없이 시험하도록 같은 이름의 열거값을 흉내 낸다
const Cesium = {
  CameraEventType: { LEFT_DRAG: 0, RIGHT_DRAG: 1, MIDDLE_DRAG: 2, WHEEL: 3, PINCH: 4 },
  KeyboardEventModifier: { SHIFT: 0, CTRL: 1, ALT: 2 },
};
const T = Cesium.CameraEventType;

describe('applyMouseScheme (3D 뷰어와 같은 조작)', () => {
  const make = () => ({
    // Cesium 기본값
    rotateEventTypes: T.LEFT_DRAG,
    zoomEventTypes: [T.RIGHT_DRAG, T.WHEEL, T.PINCH],
    tiltEventTypes: [T.MIDDLE_DRAG, T.PINCH, { eventType: T.LEFT_DRAG, modifier: 1 }, { eventType: T.RIGHT_DRAG, modifier: 1 }],
  });

  it('우클릭 드래그는 회전(기울기)이고 확대/축소에서는 빠진다', () => {
    const c = applyMouseScheme(Cesium, make());
    expect(c.tiltEventTypes).toContain(T.RIGHT_DRAG);
    expect(c.zoomEventTypes).not.toContain(T.RIGHT_DRAG);
  });

  it('휠과 휠 누르고 드래그는 확대/축소이고 회전에서는 빠진다', () => {
    const c = applyMouseScheme(Cesium, make());
    expect(c.zoomEventTypes).toEqual(expect.arrayContaining([T.WHEEL, T.MIDDLE_DRAG, T.PINCH]));
    expect(c.tiltEventTypes).not.toContain(T.MIDDLE_DRAG);
  });

  it('좌 드래그는 이동 그대로, Ctrl+좌 드래그는 회전(우클릭이 불편한 터치패드용)', () => {
    const c = applyMouseScheme(Cesium, make());
    expect(c.rotateEventTypes).toBe(T.LEFT_DRAG);
    expect(c.tiltEventTypes).toContainEqual({ eventType: T.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL });
  });

  it('같은 입력이 두 동작에 동시에 걸리지 않는다 (충돌 없음)', () => {
    const c = applyMouseScheme(Cesium, make());
    const plain = (list) => list.filter((e) => typeof e === 'number');
    const both = plain(c.zoomEventTypes).filter((e) => plain(c.tiltEventTypes).includes(e) && e !== T.PINCH);
    expect(both).toEqual([]);
  });

  it('두 번 적용해도 같다', () => {
    const c = applyMouseScheme(Cesium, applyMouseScheme(Cesium, make()));
    expect(c.zoomEventTypes).toHaveLength(3);
    expect(c.tiltEventTypes).toHaveLength(3);
  });

  it('안내 문장은 3D 뷰어의 지도 모드 안내와 같다', () => {
    expect(MOUSE_HINT).toBe('좌클릭 드래그: 이동 · 우클릭 드래그: 회전 · 휠: 확대/축소');
  });
});
