import * as THREE from 'three';
import { PickableRegistry } from '../interaction/PickableRegistry.js';

/**
 * three.js 뷰어의 핵심 골격(scene/camera/renderer/render-loop/resize)을 캡슐화한다.
 *
 * 여러 프로젝트에서 재사용하기 위해, Viewer는 타일이 무엇인지, 좌표계가 무엇인지,
 * 모델 모드인지 지리참조 모드인지 전혀 알지 못한다 -- 그런 지식은 각각
 * layers/, interaction/, config/ 쪽 모듈이 담당한다. Viewer는 오직
 * "화면에 무언가를 그리고, 매 프레임 등록된 콜백들을 실행한다"는 책임만 가진다.
 */
export class Viewer {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - 렌더러의 canvas를 붙일 DOM 요소
   * @param {number} [options.background] - 배경색 (hex)
   */
  constructor({ container, background = 0x111318 }) {
    if (!container) {
      throw new Error('Viewer requires a container element');
    }
    this._container = container;

    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(background);

    this._camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.01,
      10000
    );
    this._camera.position.set(5, 5, 5);

    // powerPreference: 'high-performance' -- 내장/외장 듀얼 GPU 노트북에서 브라우저가
    // 기본으로 절전(내장 GPU)을 고르는 경우가 있어, 명시적으로 고성능 GPU를 요청한다.
    // 최종 선택은 OS/드라이버가 하지만(강제는 아님), 힌트를 주지 않는 것보다는 낫다.
    // preserveDrawingBuffer: true -- 스크린샷 저장(saveScreenshot)이 렌더 루프와 상관없는
    // 임의의 시점(버튼 클릭)에 canvas.toDataURL()을 호출하는데, 기본값(false)이면 브라우저가
    // 프레임을 화면에 표시한 직후 버퍼를 비워버릴 수 있어 검은 화면이 캡처될 수 있다.
    this._renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    // 4K/레티나 디스플레이는 devicePixelRatio가 2~3이라, 그대로 쓰면 렌더링 부하가
    // 4~9배로 뛴다. 대부분 2배 이상에서는 체감 화질 차이가 크지 않아 2로 캡한다.
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this._renderer.domElement);

    // 레이어(RasterTileLayer, Tiles3DLayer, ...)와 상호작용 모듈(HoverHighlight, ClickPopup, ...)
    // 사이의 유일한 연결점. Viewer가 직접 만들어 두면 두 쪽 모두 viewer만 참조하면 되고,
    // 서로의 존재를 몰라도 된다.
    this.pickableRegistry = new PickableRegistry();

    /** @type {Array<(camera: THREE.Camera, dt: number) => void>} */
    this._updateCallbacks = [];
    this._timer = new THREE.Timer(); // THREE.Clock은 deprecated (0.18x) -> Timer로 대체
    this._running = false;
    this._animationFrameId = null;

    // window의 'resize' 이벤트 대신 컨테이너 자체를 관찰하는 이유:
    // 사이드바 토글처럼 창 크기는 그대로인데 컨테이너 크기만 바뀌는 경우도 잡아내기 위함.
    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(container);
  }

  get scene() {
    return this._scene;
  }

  get camera() {
    return this._camera;
  }

  get renderer() {
    return this._renderer;
  }

  get domElement() {
    return this._renderer.domElement;
  }

  /**
   * 실제로 렌더링에 쓰이는 GPU 문자열을 읽어, GPU 가속이 막혀 SwiftShader/llvmpipe 같은
   * 소프트웨어 렌더러로 조용히 폴백된 상태인지 알려준다. (예: 회사 정책으로 GPU가
   * 드라이버 블록리스트에 걸린 환경 -- 일반 사용자의 "하드웨어 가속 설정"과는 무관하게
   * 브라우저가 스스로 판단해서 떨어지는 경우다.) UI 쪽에서 경고 배너를 띄울지 판단하는 용도.
   * @returns {{ renderer: string|null, isSoftware: boolean }}
   */
  getRendererInfo() {
    const gl = this._renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return { renderer: null, isSoftware: false };
    const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    return { renderer, isSoftware: /swiftshader|llvmpipe|software/i.test(renderer) };
  }

  /**
   * 현재 프레임을 PNG로 다운로드한다. preserveDrawingBuffer:true 덕분에 렌더 루프와
   * 무관한 임의의 시점(예: 버튼 클릭)에 호출해도 마지막으로 그려진 프레임을 그대로 얻는다.
   * @param {string} [filename]
   */
  saveScreenshot(filename = 'screenshot.png') {
    const link = document.createElement('a');
    link.href = this._renderer.domElement.toDataURL('image/png');
    link.download = filename;
    link.click();
  }

  /**
   * 매 프레임 호출될 콜백을 등록한다. CameraRig.update, LayerManager.update 등이
   * 여기 등록되어 Viewer가 그 존재를 몰라도 매 프레임 실행되게 한다.
   * @param {(camera: THREE.Camera, dt: number) => void} fn
   */
  addUpdateCallback(fn) {
    this._updateCallbacks.push(fn);
  }

  /** @param {(camera: THREE.Camera, dt: number) => void} fn */
  removeUpdateCallback(fn) {
    this._updateCallbacks = this._updateCallbacks.filter((cb) => cb !== fn);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._tick();
  }

  stop() {
    this._running = false;
    if (this._animationFrameId !== null) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }
  }

  dispose() {
    this.stop();
    this._resizeObserver.disconnect();
    this._renderer.dispose();
    this._container.removeChild(this._renderer.domElement);
  }

  _tick() {
    if (!this._running) return;
    this._timer.update();
    const dt = this._timer.getDelta();
    for (const cb of this._updateCallbacks) {
      cb(this._camera, dt);
    }
    this._renderer.render(this._scene, this._camera);
    this._animationFrameId = requestAnimationFrame(() => this._tick());
  }

  _onResize() {
    const { clientWidth: w, clientHeight: h } = this._container;
    if (w === 0 || h === 0) return; // 컨테이너가 display:none 등으로 숨겨진 경우 0으로 나누기 방지
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h);
  }
}
