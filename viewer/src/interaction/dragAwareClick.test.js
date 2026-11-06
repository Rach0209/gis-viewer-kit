import { describe, it, expect, vi } from 'vitest';
import { onDragAwareClick } from './dragAwareClick.js';

// jsdom 없이(environment: 'node') 테스트하기 위해, addEventListener/removeEventListener만
// 흉내 내는 최소한의 가짜 DOM 엘리먼트를 만든다. 등록된 핸들러를 직접 호출해 이벤트를
// "발생"시킨다.
function createFakeElement() {
  const handlers = {};
  return {
    addEventListener: (type, fn) => {
      handlers[type] = fn;
    },
    removeEventListener: (type, fn) => {
      if (handlers[type] === fn) delete handlers[type];
    },
    fire(type, event) {
      handlers[type]?.(event);
    },
    _handlers: handlers,
  };
}

describe('onDragAwareClick', () => {
  it('calls onClick when pointerup happens near pointerdown', () => {
    const el = createFakeElement();
    const onClick = vi.fn();
    onDragAwareClick(el, onClick);

    el.fire('pointerdown', { clientX: 100, clientY: 100 });
    el.fire('pointerup', { clientX: 102, clientY: 101 });

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when pointerup is far from pointerdown (drag)', () => {
    const el = createFakeElement();
    const onClick = vi.fn();
    onDragAwareClick(el, onClick);

    el.fire('pointerdown', { clientX: 100, clientY: 100 });
    el.fire('pointerup', { clientX: 260, clientY: 140 });

    expect(onClick).not.toHaveBeenCalled();
  });

  it('respects a custom maxMovementPx threshold', () => {
    const el = createFakeElement();
    const onClick = vi.fn();
    onDragAwareClick(el, onClick, { maxMovementPx: 50 });

    el.fire('pointerdown', { clientX: 0, clientY: 0 });
    el.fire('pointerup', { clientX: 40, clientY: 0 });

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ignores pointerup with no preceding pointerdown', () => {
    const el = createFakeElement();
    const onClick = vi.fn();
    onDragAwareClick(el, onClick);

    el.fire('pointerup', { clientX: 100, clientY: 100 });

    expect(onClick).not.toHaveBeenCalled();
  });

  it('the returned cleanup function removes both listeners', () => {
    const el = createFakeElement();
    const onClick = vi.fn();
    const cleanup = onDragAwareClick(el, onClick);

    cleanup();
    el.fire('pointerdown', { clientX: 0, clientY: 0 });
    el.fire('pointerup', { clientX: 0, clientY: 0 });

    expect(onClick).not.toHaveBeenCalled();
  });
});
