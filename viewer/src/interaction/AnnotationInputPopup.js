/**
 * 클릭 지점 근처에 짧은 텍스트를 입력받는 작은 인라인 폼을 띄운다.
 *
 * window.prompt()를 안 쓰는 이유: 그건 브라우저 네이티브 블로킹 다이얼로그라 열려있는
 * 동안 페이지의 JS 실행이 멈춘다. 그동안 OrbitControls/MapControls가 진행 중이던 드래그
 * 제스처의 pointerup을 못 받아, 컨트롤이 "계속 드래그 중"이라 착각한 채 카메라가
 * 멈춰버리는 문제가 실사용 중 발견됐다(2026-08-11). 이 폼은 그냥 일반 DOM 엘리먼트라
 * 페이지 실행을 막지 않으므로 그 문제가 없다.
 */
export class AnnotationInputPopup {
  constructor() {
    this._container = document.createElement('div');
    this._container.className = 'annotation-input-popup';
    Object.assign(this._container.style, {
      position: 'fixed',
      display: 'none',
      flexDirection: 'row',
      gap: '6px',
      padding: '8px',
      borderRadius: '4px',
      background: 'rgba(20,22,26,0.95)',
      zIndex: '25',
      transform: 'translate(-50%, -110%)',
    });

    this._input = document.createElement('input');
    this._input.type = 'text';
    this._input.placeholder = '메모 내용';
    Object.assign(this._input.style, {
      width: '180px',
      padding: '4px 6px',
      borderRadius: '3px',
      border: '1px solid rgba(255,255,255,0.3)',
      background: '#1a1c20',
      color: '#fff',
      font: '13px system-ui, sans-serif',
    });

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.textContent = '추가';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = '취소';
    for (const button of [confirmButton, cancelButton]) {
      Object.assign(button.style, {
        padding: '4px 8px',
        borderRadius: '3px',
        border: '1px solid rgba(255,255,255,0.3)',
        cursor: 'pointer',
        background: 'rgba(255,255,255,0.1)',
        color: '#fff',
        font: '13px system-ui, sans-serif',
      });
    }

    confirmButton.addEventListener('click', () => this._close(this._input.value.trim() || null));
    cancelButton.addEventListener('click', () => this._close(null));
    this._input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this._close(this._input.value.trim() || null);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this._close(null);
      }
    });

    this._container.appendChild(this._input);
    this._container.appendChild(confirmButton);
    this._container.appendChild(cancelButton);
    document.body.appendChild(this._container);

    this._resolve = null;
  }

  /**
   * @param {{x:number, y:number}} screenPos
   * @returns {Promise<string|null>} 입력한 텍스트(공백만 있으면 null), 취소 시 null
   */
  show(screenPos) {
    this._close(null); // 이미 열려 있던 게 있으면 취소 처리하고 새로 연다

    this._container.style.left = `${screenPos.x}px`;
    this._container.style.top = `${screenPos.y}px`;
    this._container.style.display = 'flex';
    this._input.value = '';
    this._input.focus();

    return new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  _close(value) {
    if (!this._resolve) return;
    this._container.style.display = 'none';
    const resolve = this._resolve;
    this._resolve = null;
    resolve(value);
  }

  dispose() {
    this._close(null);
    this._container.remove();
  }
}
