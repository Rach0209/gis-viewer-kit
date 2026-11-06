import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GLTFExtensionsPlugin, TilesFadePlugin } from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { LayerBase } from './LayerBase.js';
import { applyGeoTransform } from '../core/geo/ecefFrame.js';

/**
 * Cesium 3D Tiles(b3dm/glTF 등)를 3d-tiles-renderer로 로드하는 레이어.
 *
 * placement:
 *  - 'model': ECEF 재배치를 하지 않고, tileset이 원래 정의된 좌표를 그대로 쓴다.
 *    이 데이터셋처럼 애초에 로컬 좌표(비지리참조)로 만들어진 3D Tiles에 적합하고,
 *    glb 모델처럼 자유 회전하며 확인하는 용도(M4)로 쓴다.
 *  - 'geo': ECEF -> 로컬 좌표 재배치. crs.js와 같은 origin(lon/lat/alt)을 기준으로,
 *    3d-tiles-renderer의 Ellipsoid.getEastNorthUpFrame을 이용해 배치한다. 2026-08-05에
 *    실제 지리참조 3D Tiles(현장 스캔 데이터)로 검증 완료.
 *
 * 동적 LOD로 인한 화면 표시 변화는 라이브러리가 쏘는 tile-visibility-change
 * 이벤트로 감지해 PickableRegistry에 반영한다 -- 한 번 스캔해서 캐싱하는 대신
 * 이벤트에 반응한다는 점이 "동적 LOD 문제"를 실제로 해결하는 지점이다
 * (PickableRegistry.js 문서 참고).
 *
 * load-model/dispose-model이 아니라 tile-visibility-change를 쓰는 이유:
 * load-model은 "타일이 캐시에 로드됨"을 의미할 뿐, 화면에 실제로 보이는지와는
 * 다르다. 3d-tiles-renderer는 성능을 위해 최근에 안 보이게 된 타일도 한동안
 * mesh.visible=false 상태로 캐시(및 씬 그래프)에 남겨둔다. load-model 시점에
 * 등록하면, 부모/자식 타일처럼 같은 공간을 차지하는 안 보이는 타일까지 raycast
 * 대상에 남아 있어서, 마우스를 거의 안 움직여도 호버 대상이 널뛰는(깜빡이는)
 * 버그가 생긴다. tile-visibility-change는 정확히 "지금 화면에 보이는가"를
 * 알려주므로 이 문제가 생기지 않는다.
 */
export class Tiles3DLayer extends LayerBase {
  /**
   * @param {Object} options
   * @param {string} options.id
   * @param {string} options.tilesetUrl
   * @param {'model'|'geo'} [options.placement]
   * @param {{lon:number, lat:number, alt?:number}} [options.origin] - 'geo' placement일 때 필요한 로컬 좌표 기준점
   * @param {number} [options.errorTarget] - 화면 공간 오차(px) 허용치. 라이브러리 기본값은 16 --
   *   낮을수록 더 먼 거리에서도 고해상도 타일을 당겨온다. 용량이 큰 데이터셋(예: 현장 스캔,
   *   타일 하나에 수십MB)에서는 이 값을 올려(예: 32) 카메라가 가까이 가기 전까지는 저해상도
   *   타일로 버티게 하면 초기 로딩 체감 속도가 크게 개선된다. 생략하면 라이브러리 기본값 사용.
   * @param {boolean} [options.enableFade] - LOD 전환 시 크로스페이드 여부. 기본 true.
   *   현장 스캔(reality-capture) 데이터처럼 부모/자식 타일이 같은 물리 표면을 서로 다른
   *   해상도로 각각 표현하는 경우, 페이드 중 두 타일이 겹쳐 그려지면서(둘 다 완전한
   *   coplanar가 아니라) z-fighting이 생겨 오히려 "반짝거림"으로 보일 수 있다 --
   *   2026-08-10에 real-site-3dtiles에서 실제로 확인됨. 그런 데이터셋에는 false로 꺼서
   *   차라리 즉시 전환(pop)되게 하는 게 낫다.
   */
  constructor({
    id,
    tilesetUrl,
    placement = 'model',
    origin,
    errorTarget,
    enableFade = true,
    decoderBaseUrl = '/',
    plugins = [],
  }) {
    super(id);
    // decoderBaseUrl: Draco/KTX2(Basis) WASM이 있는 경로 접두어 ('/' -> /draco/, /basis/).
    //   기본값 '/'는 기존 동작(Vite public/)과 같다. 임베드 시에는 번들 옆 경로로 지정한다.
    // plugins: 3d-tiles-renderer 플러그인을 추가로 등록한다 (예: 로컬 파일 플러그인).
    this._decoderBaseUrl = decoderBaseUrl;
    this._extraPlugins = plugins;
    this._tilesetUrl = tilesetUrl;
    this._placement = placement;
    this._origin = origin;
    this._errorTarget = errorTarget;
    this._enableFade = enableFade;
    /** @type {import('3d-tiles-renderer').TilesRenderer|null} */
    this._tiles = null;
    this._viewer = null;
    this._onVisibilityChange = this._onVisibilityChange.bind(this);
    this._onDisposeModel = this._onDisposeModel.bind(this);
    this._onLoadError = this._onLoadError.bind(this);
  }

  /** @param {import('../core/Viewer.js').Viewer} viewer */
  onAdd(viewer) {
    if (this._placement !== 'model' && this._placement !== 'geo') {
      throw new Error(`Tiles3DLayer: unknown placement '${this._placement}'`);
    }
    if (this._placement === 'geo' && !this._origin) {
      throw new Error("Tiles3DLayer: placement 'geo' requires an 'origin' option");
    }

    this._viewer = viewer;
    const tiles = new TilesRenderer(this._tilesetUrl);
    // 이 프로젝트가 서빙되는 origin과 다른 호스트(예: raw.githubusercontent.com)에서
    // 공개 샘플 데이터를 가져오므로 CORS 모드를 명시한다.
    tiles.fetchOptions.mode = 'cors';
    tiles.setCamera(viewer.camera);
    tiles.setResolutionFromRenderer(viewer.camera, viewer.renderer);
    if (this._errorTarget != null) {
      tiles.errorTarget = this._errorTarget;
    }

    // 실제 현장 스캔 데이터(2026-08-05 확인)는 glTF 콘텐츠에 KHR_draco_mesh_compression
    // (지오메트리)과 KHR_texture_basisu(KTX2, 텍스처)를 필수 확장으로 사용한다.
    // 이 플러그인 없이는 그런 콘텐츠는 파싱 자체가 실패한다(스펙상 필수 확장을
    // 모르면 로더가 거부해야 함). 이 확장을 안 쓰는 타일셋(예: 예전 합성 샘플)에는
    // 아무 영향이 없으므로 모든 3D Tiles 레이어에 기본으로 등록해둔다.
    //
    // 세 디코더(Draco/KTX2/Meshopt)를 항상 등록해 둔다. GLTFLoader는 glb가 해당 확장을
    // 선언했을 때만 디코더를 호출하고(그때서야 WASM을 내려받음), 선언하지 않은 타일에는
    // 아무 비용이 없다 -- 그래서 "압축된 데이터인가"를 타일마다 로더가 알아서 판별한다.
    // (사용자 안내/사전 점검용 판별은 kit/inspectContent.js)
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(`${this._decoderBaseUrl}draco/`);
    const ktxLoader = new KTX2Loader();
    ktxLoader.setTranscoderPath(`${this._decoderBaseUrl}basis/`);
    ktxLoader.detectSupport(viewer.renderer);
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader, ktxLoader, meshoptDecoder: MeshoptDecoder }));
    for (const plugin of this._extraPlugins) {
      tiles.registerPlugin(plugin);
    }
    if (this._enableFade) {
      // LOD가 바뀌며 타일이 교체될 때 갑자기 "팝"하는 대신 부드럽게 크로스페이드한다.
      // fadeRootTiles를 기본값(false)으로 두는 이유: 최초 로딩 시 루트 타일까지 페이드시키면
      // LoadingIndicator가 꺼진 직후 화면이 서서히 나타나 "아직도 로딩 중"처럼 보인다.
      // enableFade:false인 레이어(예: real-site-3dtiles)에는 이 문제 자체가 없다.
      tiles.registerPlugin(new TilesFadePlugin());
    }

    if (this._placement === 'geo') {
      applyGeoTransform(tiles, this._origin);
    }

    tiles.addEventListener('tile-visibility-change', this._onVisibilityChange);
    // dispose-model은 안전망이다: 보통은 visibility-change(visible:false)가 먼저
    // unregister를 처리하지만, 혹시 visible 상태로 곧장 사라지는 경우를 대비해
    // 등록되어 있으면 확실히 지운다 (이미 해제된 객체에 unregister를 다시 불러도 안전).
    tiles.addEventListener('dispose-model', this._onDisposeModel);
    // tileset.json 자체를 못 가져오거나(잘못된 URL, CORS 차단) 특정 타일 콘텐츠
    // 파싱이 실패하면, 아무 안내 없이 그냥 아무것도 안 뜨는 상태가 된다. 최소한
    // 콘솔에서 원인을 바로 알 수 있게 로그한다.
    tiles.addEventListener('load-error', this._onLoadError);

    this.object3d.add(tiles.group);
    this._tiles = tiles;
  }

  /**
   * tileset.json 루트가 파싱되어 bounding box를 알 수 있게 되는 즉시 한 번 호출된다.
   * 아직 실제 타일 콘텐츠(b3dm/glTF)가 로드되지 않은 시점에도 tileset.json에 선언된
   * boundingVolume만으로 값을 반환하므로, 카메라를 기다리지 않고 바로 프레이밍할 수 있다.
   *
   * 'load-tileset'이 아니라 'load-root-tileset'을 듣는다 -- 'load-tileset'은 "아무
   * tileset.json이든 로드 완료"를 뜻해서, 이 데이터셋처럼 쿼드트리를 따라 외부
   * tileset.json이 수십 개 딸려있는 경우 탐색 도중 계속(사용자가 카메라를 움직이는
   * 중에도) 반복 발생한다. 그때마다 callback이 다시 불려 fitToAllLayers가 카메라를
   * "전체 보기"로 되돌려버리는 버그가 있었다(2026-08-11 실사용 중 발견 -- 확대해서
   * 둘러보다가 갑자기 초기 화면으로 튕기는 증상). 'load-root-tileset'은 루트가 로드될
   * 때 딱 한 번만 발생하므로 이 문제가 없다.
   * @param {(box: import('three').Box3) => void} callback
   */
  onReady(callback) {
    this._tiles.addEventListener('load-root-tileset', () => {
      const box = this.getBoundingBox();
      if (box) callback(box);
    });
  }

  /**
   * 이 레이어의 타일 다운로드/파싱이 (비활동 상태에서) 시작되거나 모두 끝날 때 호출된다.
   * 로딩 인디케이터처럼 "지금 이 레이어에 네트워크 활동이 있는가"만 필요한 UI에서 쓴다.
   * @param {(loading: boolean) => void} callback
   */
  onLoadingChange(callback) {
    this._tiles.addEventListener('tiles-load-start', () => callback(true));
    this._tiles.addEventListener('tiles-load-end', () => callback(false));
  }

  /**
   * 타일(셋) 로드가 실패할 때마다 호출된다. _onLoadError의 콘솔 로그는 개발자용이고,
   * 이건 별개로 사용자에게도 알리고 싶은 UI(에러 토스트 등)에서 쓴다.
   * @param {(info: {url: string, error: Error}) => void} callback
   */
  onLoadError(callback) {
    this._tiles.addEventListener('load-error', ({ error, url }) => callback({ url, error }));
  }

  /**
   * 현재 tileset.json이 파싱되어 있으면 그 bounding box를, 아직이면 null을 반환한다.
   * 다른 레이어와 bounding box를 합쳐서 카메라를 프레이밍할 때(main.js) 사용한다.
   *
   * tiles.getBoundingBox()는 "group의 로컬 공간" 기준 박스를 준다 -- 즉 group에
   * 적용된 변환(placement:'geo'일 때 applyGeoTransform이 설정한 ECEF->로컬 재배치
   * 행렬) 이전 좌표다. 이걸 그대로 쓰면(특히 실제 ECEF 데이터에서) 카메라가 지구
   * 중심 근처의 수백만 단위 좌표로 튀어버린다. group.matrix를 곱해 우리 레이어의
   * object3d 기준 좌표(다른 레이어와 같은 공간)로 맞춰준다. 'model' 모드에서는
   * group.matrix가 항등행렬이라 이 보정이 아무 효과가 없다.
   * @returns {import('three').Box3|null}
   */
  getBoundingBox() {
    if (!this._tiles) return null;
    const box = new THREE.Box3();
    if (!this._tiles.getBoundingBox(box)) return null;
    box.applyMatrix4(this._tiles.group.matrix);
    return box;
  }

  /**
   * 타일 로딩 현황 스냅샷 (정보 패널용). 레이어가 아직 없거나 dispose됐으면 null.
   * @returns {{loaded:number, downloading:number, parsing:number, queued:number, failed:number, visible:number|null}|null}
   */
  getStats() {
    if (!this._tiles) return null;
    const s = this._tiles.stats;
    return {
      loaded: s.loaded ?? 0,
      downloading: s.downloading ?? 0,
      parsing: s.parsing ?? 0,
      queued: s.queued ?? 0,
      failed: s.failed ?? 0,
      visible: this._tiles.visibleTiles?.size ?? null,
    };
  }

  /** @param {{scene: import('three').Object3D, visible: boolean}} event */
  _onVisibilityChange({ scene, visible }) {
    scene.traverse((obj) => {
      if (!obj.isMesh) return;
      if (visible) {
        this._viewer.pickableRegistry?.register(obj, { layerId: this.id, tilesetUrl: this._tilesetUrl }, this.id);
      } else {
        this._viewer.pickableRegistry?.unregister(obj);
      }
    });
  }

  /** @param {{tile: Object|null, error: Error, url: string|URL}} event */
  _onLoadError({ error, url }) {
    console.error(`[Tiles3DLayer:${this.id}] 타일(셋) 로드 실패: ${url}`, error);
  }

  /** @param {{scene: import('three').Object3D}} event */
  _onDisposeModel({ scene }) {
    scene.traverse((obj) => {
      if (obj.isMesh) {
        this._viewer.pickableRegistry?.unregister(obj);
      }
    });
  }

  /** @param {import('three').Camera} camera */
  update(camera) {
    if (!this._tiles) return;
    // 카메라가 바뀔 수 있으므로(예: 나중에 지리참조 모드에서 카메라 프리셋이 바뀔 때)
    // 매 프레임 다시 지정해도 안전하다 -- setCamera/setResolutionFromRenderer는 멱등적이다.
    this._tiles.setCamera(camera);
    this._tiles.setResolutionFromRenderer(camera, this._viewer.renderer);
    camera.updateMatrixWorld();
    this._tiles.update();
  }

  /** @param {import('../core/Viewer.js').Viewer} viewer */
  onRemove(viewer) {
    viewer.pickableRegistry?.unregisterByLayer(this.id);
  }

  /**
   * LayerBase의 기본(no-op)을 오버라이드: 3d-tiles-renderer는 카메라별로 필요한
   * 타일을 계산해서(cameraMap) 합산하므로, 메인 카메라 외에 다른 카메라도 그냥
   * setCamera로 추가 등록하면 된다 -- 기존에 등록된 메인 카메라를 덮어쓰지 않는다.
   * 미니맵의 탑다운 카메라(MinimapTileRenderer.js)가 이걸 사용한다.
   *
   * 주의: 이 카메라가 데이터 전체 범위를 내려다보므로, 등록하는 순간부터 메인
   * 카메라가 지금 안 보고 있는 먼 구역의 타일도 (낮은 해상도로) 미리 받아오기
   * 시작한다. 렌더타겟이 작을수록(요구 해상도가 낮을수록) 저LOD로 충분해 부담이
   * 적지만, 완전히 공짜는 아니라는 점은 감안해야 한다.
   * @param {import('three').Camera} camera
   * @param {import('three').WebGLRenderer} renderer
   */
  registerAuxCamera(camera, renderer) {
    if (!this._tiles) return;
    this._tiles.setCamera(camera);
    this._tiles.setResolutionFromRenderer(camera, renderer);
  }

  /** @param {import('three').Camera} camera */
  unregisterAuxCamera(camera) {
    this._tiles?.deleteCamera(camera);
  }

  dispose() {
    if (!this._tiles) return;
    this._tiles.removeEventListener('tile-visibility-change', this._onVisibilityChange);
    this._tiles.removeEventListener('dispose-model', this._onDisposeModel);
    this._tiles.removeEventListener('load-error', this._onLoadError);
    // 3d-tiles-renderer의 dispose()가 group 내부 메시/텍스처까지 정리해준다 --
    // utils/dispose.js는 우리가 직접 만든 RasterTileLayer처럼 라이브러리가
    // 스스로 정리해주지 않는 경우를 위한 것이라 여기서는 쓰지 않는다.
    this._tiles.dispose();
    this._tiles = null;
  }
}
