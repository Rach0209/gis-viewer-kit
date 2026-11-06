/**
 * 브라우저 네이티브 'click' 이벤트는 pointerdown과 pointerup 사이에 마우스가 꽤
 * 움직여도(OS/브라우저마다 허용 오차가 다름) 여전히 발생한다. 카메라를 드래그해서
 * 회전/팬/틸트하는 제스처의 마지막 순간에도 'click'이 fire되어서, "클릭해서 뭔가
 * 하기" 기능들이 드래그 하나하나를 클릭으로 오인하는 문제가 있었다(예: 화면을
 * 틸팅하려고 드래그했는데 거리 측정 점이 찍히는 등).
 *
 * pointerdown/pointerup의 실제 화면 이동 거리를 직접 재서, 이동 거리가 작을 때만
 * "진짜 클릭"으로 인정한다. ClickPopup/ClickCoordinateLogger/MeasureTool/AnnotationTool
 * 등 클릭 기반 상호작용 모듈이 모두 네이티브 'click' 대신 이걸 통해서만 클릭을 받는다.
 * @param {HTMLElement} domElement
 * @param {(event: PointerEvent) => void} onClick - 드래그가 아니라고 판단될 때만 호출
 * @param {{maxMovementPx?: number}} [options]
 * @returns {() => void} 등록한 리스너를 제거하는 cleanup 함수
 */
export function onDragAwareClick(domElement, onClick, { maxMovementPx = 6 } = {}) {
  let downPos = null;

  function handlePointerDown(event) {
    downPos = { x: event.clientX, y: event.clientY };
  }

  function handlePointerUp(event) {
    if (!downPos) return;
    const dx = event.clientX - downPos.x;
    const dy = event.clientY - downPos.y;
    downPos = null;
    if (Math.hypot(dx, dy) <= maxMovementPx) {
      onClick(event);
    }
  }

  domElement.addEventListener('pointerdown', handlePointerDown);
  domElement.addEventListener('pointerup', handlePointerUp);

  return () => {
    domElement.removeEventListener('pointerdown', handlePointerDown);
    domElement.removeEventListener('pointerup', handlePointerUp);
  };
}
