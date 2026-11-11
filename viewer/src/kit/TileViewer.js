import * as THREE from 'three';
import { Viewer } from '../core/Viewer.js';
import { CameraRig } from '../core/CameraRig.js';
import { LayerManager } from '../layers/LayerManager.js';
import { Tiles3DLayer } from '../layers/Tiles3DLayer.js';
import { MeasureTool } from '../interaction/MeasureTool.js';
import { AnnotationTool } from '../interaction/AnnotationTool.js';
import { HoverHighlight } from '../interaction/HoverHighlight.js';
import { createMinimap, SIZE as MINIMAP_SIZE } from '../ui/Minimap.js';
import { createMinimapTileRenderer } from '../ui/MinimapTileRenderer.js';
import { AnnotationLayer } from '../layers/AnnotationLayer.js';
import { pickAt } from '../interaction/Raycast.js';
import { onDragAwareClick } from '../interaction/dragAwareClick.js';
import { ExperienceControls } from '../interaction/ExperienceControls.js';
import { StartPositionPicker } from '../interaction/StartPositionPicker.js';
import { BasemapLayer } from './BasemapLayer.js';
import { ModelLayer } from './ModelLayer.js';
import { inspectGlb } from './glbInspect.js';
import { parseGlb } from './gltfLoad.js';
import { buildLocalMatrix, describeEdit, editedMatrix, planPlacement } from './modelPlacement.js';
import { findEmbeddedPlacements } from './embeddedCoords.js';
import { computeContentBounds } from './contentBounds.js';
import { bboxFromPoints, resolveProvider } from './rasterProviders.js';
import { createGeodeticToLocal, createLocalToGeodetic } from './geoMath.js';
import { resolvePersistence } from './persistence.js';
import { defaultDecoderBaseUrl } from './scriptBase.js';
import { analyzeTileset } from './analyzeTileset.js';
import { inspectContent, checkDecoders } from './inspectContent.js';
import { resolveSource } from './sources.js';
import { getBackendTileset } from './backend.js';

/* global __TVK_BACKEND__ */
// `<script>` 번들(vite.lib.config.js)은 Java 서버 연결 코드를 빼고 빌드한다 (클라이언트 전용). 개발용 데모는 포함한다.
const BACKEND_ENABLED = typeof __TVK_BACKEND__ !== 'undefined' ? __TVK_BACKEND__ : true;
import { createKitUi } from './ui.js';
import { currentPerf, readEnv, resolvePerf, savePref } from './perfMode.js';
import { pickFolder, fromDropEvent, pickGlbFile, glbFromDropEvent } from './folderPicker.js';

/**
 * 최소 기능 뷰어: 화면 이동(회전/이동/확대) + 타일셋 정보 + 거리재기
 * + 스크린샷 + 나침반 + 마우스 위치 좌표 + 클릭 지점 정보 + 메모.
 * docs/03-viewer-api.md 의 `TileViewer.create(container, options)` 초안 중
 * 해당하는 부분만 구현한다.
 *
 * 기존 main.js와 달리 window.location / import.meta.env / localStorage 에 의존하지 않고,
 * 모든 DOM을 컨테이너 안에 만들며, dispose()로 완전히 정리된다.
 *
 * @param {HTMLElement} container 높이가 있는 요소
 * @param {Object} [options]
 * @param {'auto'|'model'|'geo'} [options.mode='auto']
 * @param {string} [options.decoderBaseUrl]  draco/, basis/ 폴더가 있는 경로 접두어 (끝에 /).
 *   기본값: 번들(`<script>`)이면 그 스크립트가 있는 폴더, 아니면 '/'
 * @param {boolean} [options.ui=true]
 * @param {boolean} [options.enableDrop=true]    폴더를 화면에 끌어다 놓아 열기
 * @param {'none'|'localStorage'|{load:Function, save:Function}} [options.persistence='none'] 메모 저장소
 * @param {boolean} [options.hover=true]   마우스를 올린 메시 강조
 * @param {boolean} [options.minimap=true]  우측 하단 미니맵 (툴바에서도 켜고 끌 수 있다)
 * @param {boolean} [options.confirmSwitch=true]  메모가 있는 상태에서 다른 타일셋을 열 때 먼저 확인을 받는다.
 *   false면 묻지 않고 메모를 지운 뒤 경고만 보여준다 (프로그램에서 연속으로 여는 경우).
 * @param {null|string|{provider:string|object, apiKey?:string, height?:number, maxTiles?:number}} [options.basemap=null]
 *   geo 타일셋 아래에 까는 배경 지도. 'osm' | 'vworld-base' | 'vworld-satellite' (VWorld는 apiKey 필요) 또는
 *   {urlTemplate, maxZoom, attribution}. 화면의 "레이어" 패널에서도 고를 수 있다.
 */
const BM_STORAGE_KEY = 'tvk.basemap';

export function createTileViewer(container, options = {}) {
  const opts = {
    mode: 'auto',
    decoderBaseUrl: defaultDecoderBaseUrl(), // 번들이면 스크립트 옆, 개발 서버면 '/'
    ui: true,
    enableDrop: true,
    persistence: 'none',
    hover: true,
    minimap: true,
    confirmSwitch: true,
    ...options,
  };
  const persistence = resolvePersistence(opts.persistence);
  // 성능 모드: 사양이 낮은 PC에서는 선 부드럽게(안티앨리어싱)와 고해상도 배율을 줄이고 타일을 덜 자세히 불러온다.
  // options.performance('auto'|'low'|'normal')로 정할 수 있고, 화면의 "성능" 선택은 저장되어 3D 뷰어와 GIS 작업실이 같이 쓴다.
  let perf = opts.performance ? resolvePerf(opts.performance, readEnv()) : currentPerf();

  const listeners = new Map();
  const emit = (type, payload) => (listeners.get(type) ?? []).forEach((fn) => fn(payload));

  // ---------- UI / 뷰어 골격 ----------
  const ui = createKitUi(container, {
    onOpenFolder: async () => {
      try {
        // 폴더 안 파일이 많으면 읽는 데 시간이 걸린다: 고른 직후부터 로딩 표시 + 읽은 파일 수
        const source = await pickFolder(folderReadHooks());
        await api.loadTileset(source);
      } catch (e) {
        ui.setBusy(null);
        if (e?.name !== 'AbortError') reportError(e);
      }
    },
    onOpenGlb: async () => {
      try {
        const file = await pickGlbFile();
        await api.loadModel(file);
      } catch (e) {
        ui.setBusy(null);
        if (e?.name !== 'AbortError') reportError(e);
      }
    },
    // 예제 glb: options.sampleGlbUrl 이 있을 때만 버튼이 생긴다 (데모 화면용, 임베드 번들에는 없음)
    onOpenSample: opts.sampleGlbUrl
      ? async () => {
          try {
            const res = await fetch(opts.sampleGlbUrl);
            if (!res.ok) throw new Error(`예제 파일을 가져오지 못했습니다 (HTTP ${res.status})`);
            await api.loadModel(new File([await res.arrayBuffer()], 'house-5186.glb'));
          } catch (e) {
            ui.setBusy(null);
            reportError(e);
          }
        }
      : null,
    onCopyDiagnostics: () => copyDiagnostics(),
    onEditChange: (patch) => editChange(patch),
    onEditNudge: (dEast, dNorth) => editNudge(dEast, dNorth),
    onEditPickOnMap: () => editPickOnMap(),
    onEditDragToggle: (on) => setDragMove(on),
    onEditReset: () => editReset(),
    onReset: () => api.resetView(),
    onToggleMeasure: (on) => api.setTool(on ? 'measure' : null),
    onClearMeasure: () => measure?.clearAll(),
    onToggleAnnotate: (on) => api.setTool(on ? 'annotate' : null),
    onClearAnnotations: () => api.clearAnnotations(),
    onScreenshot: () => api.saveScreenshot(),
    onToggleMinimap: (on) => api.setMinimapEnabled(on),
    minimapOn: opts.minimap,
    onPerfChange: (pref) => api.setPerformance(pref),
    perf,
    onToggleWalk: (on) => api.setTool(on ? 'walk' : null),
    onCompassDblClick: () => api.faceNorth(),
    onLayerVisible: (key, on) => api.setLayerVisible(key, on),
    onBasemapApply: ({ provider, apiKey }) => api.setBasemap(provider === 'none' ? null : { provider, apiKey }),
    onBasemapHeight: (m) => api.setBasemapHeight(m),
  });
  if (!opts.ui) ui.root.classList.add('tvk-no-ui');

  const viewer = new Viewer({ container: ui.canvasHost, antialias: perf.antialias, maxPixelRatio: perf.maxPixelRatio });
  const layerManager = new LayerManager(viewer);

  /** @type {CameraRig|null} */
  let rig = null;
  let rigMode = null;
  /** @type {MeasureTool|null} */
  let measure = null;
  /** @type {'measure'|'annotate'|'walk'|null} 한 번에 하나만 켠다 (클릭이 무슨 뜻인지 모호해지지 않게) */
  let tool = null;
  // 체험(걷기) 모드: 먼저 시작 위치를 클릭으로 고르고(picking), 고르면 1인칭/항공 컨트롤이 카메라를 잡는다(active).
  // 둘 다 카메라를 직접 움직이므로 active인 동안에는 CameraRig(orbit/map)를 갱신하지 않는다.
  let experience = null;
  let picker = null;
  let walkPicking = false;
  let walkActive = false;
  let rigHint = '';
  // 배경 지도: 어떤 지도를 쓸지(bmSpec)와 실제 레이어(basemapLayer)를 분리해서, 타일셋을 바꿔도 같은 지도가 다시 깔린다.
  let bmSpec = null; // { provider, apiKey, height?, maxTiles? }
  let bmHeight = null; // 사용자가 지정한 높이. null이면 타일셋 바닥에 맞춘다.
  // 좌표로 배치한 glb는 지도 위에 놓은 것이므로 배경 지도를 기본(OSM)으로 켠다. 그렇게 자동으로 켠 것(bmAutoSet)은
  // 타일셋으로 바꾸면 되돌리고, 사용자가 "쓰지 않음"을 직접 고른 적이 있으면(bmUserOff) 자동으로 켜지 않는다.
  let bmAutoSet = false;
  let bmUserOff = false;
  let basemapLayer = null;
  let bmSeq = 0;
  const visibility = { tileset: true, basemap: true, memos: true };
  /** @type {AnnotationLayer|null} */
  let annotationLayer = null;
  /** @type {AnnotationTool|null} */
  let annotationTool = null;
  let annotationScope = null;
  /** geo 모드일 때만: 로컬 좌표 -> 경위도 */
  let toGeo = null;
  // 미니맵: 켜져 있어도 타일셋이 로드되기 전에는 만들지 않는다 (레이어 목록을 만들 때 잡아 두기 때문).
  let minimapOn = !!opts.minimap;
  let minimapChoice = null; // 사용자가 미니맵 버튼으로 직접 정한 값 (null = 아직 안 정함 -> 데이터 종류별 기본값)
  let minimap = null;
  let minimapBg = null;
  // 호버 강조 (레지스트리만 보므로 어떤 레이어든 동작). 타일이 많아서 raycast를 50ms 간격으로 제한한다.
  const hover = opts.hover ? new HoverHighlight({ throttleMs: 50 }) : null;
  let layer = null;
  let homeBox = null;
  let loadToken = 0;
  let layerSeq = 0;
  let current = null; // { name, mode, info, content, decoderProblems, profile }
  let failedMessages = [];
  let disposed = false;

  const camDir = new THREE.Vector3();
  viewer.addUpdateCallback((camera, dt) => {
    if (walkActive) experience.update(dt);
    else rig?.update(dt);
    measure?.update(camera);
    if (toGeo) {
      // 카메라가 북(-z)에서 얼마나 돌아섰는지 (동쪽을 보면 +90도). 위/아래 시선(pitch)은 무시한다.
      camera.getWorldDirection(camDir);
      ui.setCompassHeading(Math.atan2(camDir.x, -camDir.z));
    }
    if (minimap && minimapBg && homeBox) {
      camera.getWorldDirection(camDir);
      minimapBg.update(homeBox, dt);
      minimap.update({
        bounds: homeBox,
        cameraPosition: { x: camera.position.x, z: camera.position.z },
        headingRad: Math.atan2(camDir.x, -camDir.z),
        // 메모를 미니맵 점으로 보여준다 (기존 앱은 POI 점)
        pois: annotationLayer ? annotationLayer.getAll().map((a) => ({ x: a.position.x, z: a.position.z })) : [],
      });
    }
  });
  viewer.start();
  // HoverHighlight.enable()은 두 번 부르면 갱신 콜백이 중복 등록되므로 켜짐 상태를 직접 관리한다.
  let hoverOn = false;
  function setHover(on) {
    if (!hover || on === hoverOn) return;
    if (on) hover.enable(viewer);
    else hover.disable();
    hoverOn = on;
  }
  setHover(true);

  // 시작할 때 배경 지도: 옵션이 우선, 없으면 지난번 선택(persistence가 localStorage일 때). 타일셋이 준비되면 깔린다.
  {
    const initial = opts.basemap ?? loadBasemapPref();
    if (initial) {
      const s = typeof initial === 'string' ? { provider: initial } : initial;
      if (s.height != null) bmHeight = s.height;
      bmSpec = { provider: s.provider, apiKey: s.apiKey ?? '', maxTiles: s.maxTiles };
      ui.setBasemapState({ provider: typeof s.provider === 'string' ? s.provider : undefined, apiKey: s.apiKey ?? '' });
    }
  }

  // ---------- 마우스 위치 좌표 / 클릭 지점 정보 ----------
  function describePoint({ x, y, z }) {
    if (toGeo) {
      const g = toGeo(x, y, z);
      return [`위도 ${g.lat.toFixed(6)}`, `경도 ${g.lon.toFixed(6)}`, `고도 ${g.alt.toFixed(1)} m`];
    }
    return [`x ${x.toFixed(2)}`, `y ${y.toFixed(2)}`, `z ${z.toFixed(2)}`];
  }

  function pickFromEvent(e) {
    return pickAt(e.clientX, e.clientY, {
      camera: viewer.camera,
      domElement: viewer.domElement,
      registry: viewer.pickableRegistry,
    });
  }

  let lastMoveAt = 0;
  const onPointerMove = (e) => {
    if (!layer || e.buttons) return; // 드래그 중에는 계산하지 않는다
    const now = performance.now();
    if (now - lastMoveAt < 80) return; // raycast 비용을 줄이기 위해 간격을 둔다
    lastMoveAt = now;
    const hit = pickFromEvent(e);
    if (!hit) return ui.setReadout('마우스 위치: -');
    ui.setReadout(describePoint(hit.point).join('  '));
  };
  const onPointerLeave = () => ui.setReadout('마우스 위치: -');
  viewer.domElement.addEventListener('pointermove', onPointerMove);
  viewer.domElement.addEventListener('pointerleave', onPointerLeave);

  // 메모 마커는 건물 뒤/위에 떠 있어서 일반 raycast(가장 가까운 면)로는 건물이 먼저 맞는다.
  // 그래서 클릭 정보에서는 메모 마커만 따로 먼저 검사한다.
  const memoRaycaster = new THREE.Raycaster();
  const memoNdc = new THREE.Vector2();
  function pickMemo(e) {
    if (!annotationLayer) return null;
    const sprites = annotationLayer.object3d.children.filter((c) => c.isSprite);
    const visible = sprites.filter((c) => c.visible);
    if (visible.length === 0) return null;
    const rect = viewer.domElement.getBoundingClientRect();
    memoNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    memoRaycaster.setFromCamera(memoNdc, viewer.camera);
    const hit = memoRaycaster.intersectObjects(visible, false)[0];
    if (!hit) return null;
    const saved = annotationLayer.getAll()[sprites.indexOf(hit.object)];
    return saved ?? null;
  }

  // 도구(측정/메모)가 꺼져 있을 때 표면을 클릭하면 그 지점의 정보를 보여준다.
  const removeClickInfo = onDragAwareClick(viewer.domElement, (e) => {
    if (tool || !layer) return;
    const memo = pickMemo(e);
    if (memo) {
      return ui.showPopup({ x: e.clientX, y: e.clientY }, [`메모: ${memo.text}`, ...describePoint(memo.position)]);
    }
    const hit = pickFromEvent(e);
    if (!hit) return ui.hidePopup();
    const lines = describePoint(hit.point);
    if (hit.metadata?.note) lines.unshift(`메모: ${hit.metadata.note}`);
    ui.showPopup({ x: e.clientX, y: e.clientY }, lines);
  });
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      ui.hidePopup();
      if (tool) api.setTool(null);
    } else if (e.key === 'Tab' && walkActive) {
      // 체험 모드 중 Tab = 1인칭 <-> 항공. 평소 Tab은 포커스 이동이라 이때만 가로챈다.
      e.preventDefault();
      experience.togglePersonMode();
      applyWalkUi();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  const statsTimer = setInterval(refreshLiveStats, 500);

  // ---------- 폴더 드래그앤드롭 ----------
  let dragDepth = 0;
  const onDragEnter = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    ui.setDragging(true);
  };
  const onDragOver = (e) => {
    if (hasFiles(e)) e.preventDefault();
  };
  const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) ui.setDragging(false);
  };
  const onDrop = async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    ui.setDragging(false);
    try {
      // 끌어다 놓은 것이 glb 파일 한 개면 모델로, 폴더면 타일셋으로 연다
      const glb = glbFromDropEvent(e);
      if (glb) {
        await api.loadModel(glb);
        return;
      }
      const source = await fromDropEvent(e, folderReadHooks());
      await api.loadTileset(source);
    } catch (err) {
      ui.setBusy(null);
      reportError(err);
    }
  };
  if (opts.enableDrop) {
    ui.root.addEventListener('dragenter', onDragEnter);
    ui.root.addEventListener('dragover', onDragOver);
    ui.root.addEventListener('dragleave', onDragLeave);
    ui.root.addEventListener('drop', onDrop);
  }
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');

  // ---------- 내부 동작 ----------
  /** 폴더를 읽는 동안의 로딩 표시 (고른 직후 시작, 읽은 파일 수 갱신) */
  function folderReadHooks() {
    return {
      onPicked: () => ui.setBusy('폴더를 읽는 중…'),
      onProgress: (n) => ui.setBusy(`폴더를 읽는 중… 파일 ${n.toLocaleString('ko-KR')}개`),
    };
  }

  function reportError(err) {
    const message = err?.message ?? String(err);
    ui.setStatus(`오류: ${message}`, 'error');
    emit('tileset-error', { error: err, message });
  }

  function ensureRig(mode) {
    const want = mode === 'geo' ? 'map' : 'orbit';
    if (rig && rigMode === want) return;
    rig?.dispose();
    rig = new CameraRig(viewer.camera, viewer.domElement, want);
    rigMode = want;
    rigHint =
      want === 'map'
        ? '좌클릭 드래그: 이동 · 우클릭 드래그: 회전 · 휠: 확대/축소'
        : '좌클릭 드래그: 회전 · 우클릭 드래그: 이동 · 휠: 확대/축소';
    ui.setHint(rigHint);
  }

  // ---------- 체험(걷기) 모드 ----------
  function applyWalkUi() {
    if (!walkActive) return;
    const first = experience.personMode === 'first';
    // 1인칭 포인터 락 중에는 clientX/Y가 고정되어 호버 강조가 엉뚱한 곳에서 깜빡이므로 끈다
    setHover(!first);
    ui.setHint(
      first
        ? '1인칭 · W/A/S/D: 이동 · 마우스: 시선 · Space: 점프 · Shift: 달리기 · R: 달리기 고정 · Tab: 항공 · Esc: 종료'
        : '항공 · 드래그: 시선 · W/A/S/D: 이동 · Space: 위 · Shift: 아래 · R: 가속 · 휠: 앞뒤 · Tab: 1인칭 · Esc: 종료'
    );
    ui.setStatus(first ? '체험 모드 (1인칭) — 화면을 클릭하면 시선 조작이 시작됩니다' : '체험 모드 (항공)', 'idle');
  }

  function startWalkPicking() {
    experience ??= new ExperienceControls(viewer.camera, viewer.domElement);
    picker ??= new StartPositionPicker();
    walkPicking = true;
    ui.setStatus('체험 시작 위치를 타일 위에서 클릭하세요 (Esc: 취소)', 'busy');
    picker.enable(viewer, (point) => {
      walkPicking = false;
      // 체험 컨트롤이 카메라를 잡는 동안 오빗/맵 컨트롤의 자체 입력 처리(마우스/휠 리스너)도 재운다.
      rig.controls.enabled = false;
      walkActive = true;
      experience.enable(viewer, point);
      applyWalkUi();
    });
  }

  function stopWalk() {
    if (walkPicking) {
      picker?.disable();
      walkPicking = false;
      ui.setStatus('준비됨', 'idle');
    }
    if (!walkActive) return;
    walkActive = false;
    experience.disable();
    if (rig) {
      // 지금 보고 있는 방향으로 target을 옮겨 둔다 (안 그러면 컨트롤이 걷기 전의 옛 target을 중심으로 돌아 엉뚱한 곳을 본다)
      const lookTarget = viewer.camera.position
        .clone()
        .add(viewer.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(50));
      rig.controls.target.copy(lookTarget);
      rig.controls.enabled = true;
      rig.controls.update();
    }
    setHover(true);
    ui.setHint(rigHint);
    ui.setStatus('준비됨', 'idle');
  }

  // ---------- 나침반 더블클릭: 북쪽 보기 ----------
  const FACE_NORTH_SECONDS = 0.6;
  let faceNorthAnim = null;
  function cancelFaceNorth() {
    if (faceNorthAnim) viewer.removeUpdateCallback(faceNorthAnim);
    faceNorthAnim = null;
  }

  // ---------- 배경 지도 ----------
  // (모듈 상수로 둔다: 아래 함수가 인스턴스 생성 도중 일찍 호출되므로 이 자리의 const는 아직 초기화 전일 수 있다)
  function loadBasemapPref() {
    if (opts.persistence !== 'localStorage') return null;
    try {
      const v = JSON.parse(globalThis.localStorage?.getItem(BM_STORAGE_KEY) ?? 'null');
      return v && typeof v.provider === 'string' ? v : null;
    } catch {
      return null;
    }
  }
  function saveBasemapPref() {
    if (opts.persistence !== 'localStorage') return;
    try {
      const v = bmSpec && typeof bmSpec.provider === 'string' ? { provider: bmSpec.provider, apiKey: bmSpec.apiKey ?? '' } : null;
      if (v) globalThis.localStorage?.setItem(BM_STORAGE_KEY, JSON.stringify(v));
      else globalThis.localStorage?.removeItem(BM_STORAGE_KEY);
    } catch {
      /* 저장소를 못 쓰는 환경이면 이번 방문에만 적용 */
    }
  }

  // ---------- glb 위치 선택 지도: 시작 위치와 마지막 선택 기억 ----------
  function loadLastPick() {
    if (opts.persistence !== 'localStorage') return null;
    try {
      const v = JSON.parse(globalThis.localStorage?.getItem('tvk.lastPick') ?? 'null');
      return v && Number.isFinite(v.lon) && Number.isFinite(v.lat) ? v : null;
    } catch {
      return null;
    }
  }
  function saveLastPick(ll) {
    if (opts.persistence !== 'localStorage') return;
    try {
      globalThis.localStorage?.setItem('tvk.lastPick', JSON.stringify({ lon: ll.lon, lat: ll.lat }));
    } catch {
      /* 저장소를 못 쓰는 환경이면 기억하지 않을 뿐이다 */
    }
  }
  /** 위치 선택 지도의 설정: 고른 배경 지도(있으면)와 같은 공급자, 없으면 OSM. 시작 위치는 열려 있는 데이터 > 지난번 선택 > 한국 전체. */
  function pickerMapOptions() {
    let provider;
    try {
      provider = bmSpec ? resolveProvider(bmSpec.provider, bmSpec.apiKey) : resolveProvider('osm');
    } catch {
      provider = resolveProvider('osm'); // 키가 없는 VWorld 등은 OSM으로
    }
    if (current?.origin) return { provider, center: { lon: current.origin.lon, lat: current.origin.lat }, zoom: 16 };
    const last = loadLastPick();
    if (last) return { provider, center: last, zoom: 15 };
    return { provider, center: { lon: 127.8, lat: 36.3 }, zoom: 7 };
  }

  /** 주소에 들어 있는 API 키를 가린다 (진단 정보를 남에게 보내도 키가 새지 않게) */
  function maskKey(url) {
    const key = bmSpec?.apiKey;
    return key ? String(url).split(key).join('***').split(encodeURIComponent(key)).join('***') : String(url);
  }

  /**
   * 화면이 이상할 때(예: 배경 지도가 까맣다) 원인을 좁히기 위한 정보. 개인 정보나 API 키는 담지 않는다.
   * @returns {object}
   */
  function collectDiagnostics() {
    const r = viewer.renderer;
    const gl = r?.getContext?.();
    const dbg = gl?.getExtension?.('WEBGL_debug_renderer_info');
    const box = (o) => {
      const b = new THREE.Box3().setFromObject(o);
      return b.isEmpty() ? null : { min: b.min.toArray().map((v) => +v.toFixed(2)), max: b.max.toArray().map((v) => +v.toFixed(2)) };
    };
    const tiles = basemapLayer ? basemapLayer.object3d.children : [];
    return {
      time: new Date().toISOString(),
      userAgent: navigator.userAgent,
      devicePixelRatio: globalThis.devicePixelRatio,
      performance: { pref: perf.pref, label: perf.label, antialias: viewer.antialias, maxPixelRatio: perf.maxPixelRatio, tileErrorTarget: layer?.getErrorTarget?.() ?? null },
      viewport: { w: ui.root.clientWidth, h: ui.root.clientHeight },
      webgl: {
        version: r?.capabilities?.isWebGL2 ? 2 : 1,
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
        maxTextureSize: r?.capabilities?.maxTextureSize,
        maxAnisotropy: r?.capabilities?.getMaxAnisotropy?.(),
      },
      data: current ? { kind: current.kind ?? 'tileset', name: current.name, mode: current.mode, origin: current.origin } : null,
      camera: { position: viewer.camera.position.toArray().map((v) => +v.toFixed(2)), near: viewer.camera.near, far: viewer.camera.far },
      layers: viewer.scene.children
        .filter((c) => c.name.startsWith('layer:'))
        .map((c) => ({ name: c.name, visible: c.visible, y: +c.position.y.toFixed(2), box: box(c) })),
      basemap: {
        provider: bmSpec ? (typeof bmSpec.provider === 'string' ? bmSpec.provider : 'custom') : null,
        apiKeyEntered: !!bmSpec?.apiKey,
        autoSet: bmAutoSet,
        userTurnedOff: bmUserOff,
        height: basemapLayer?.getHeight() ?? null,
        zoom: basemapLayer?.zoom ?? null,
        stats: basemapLayer ? { ...basemapLayer.getStats(), firstError: basemapLayer.getStats().firstError && { ...basemapLayer.getStats().firstError, url: maskKey(basemapLayer.getStats().firstError.url) } } : null,
        tilesWithTexture: tiles.filter((m) => m.material.map).length,
        tilesTotal: tiles.length,
        firstTileColor: tiles[0] ? tiles[0].material.color.getHexString() : null,
      },
    };
  }

  /** 진단 정보를 클립보드에 복사한다 (붙여 넣어 보낼 수 있게) */
  async function copyDiagnostics() {
    const text = JSON.stringify(collectDiagnostics(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      ui.showNotice('진단 정보를 복사했습니다. 붙여 넣어 보내 주세요. (API 키는 포함되지 않습니다)');
    } catch {
      // 클립보드 권한이 없으면 선택해서 복사할 수 있게 글상자로 보여 준다 (콘솔에도 남긴다)
      console.info('[gis-viewer-kit 진단]\n' + text);
      ui.showText({
        title: '진단 정보',
        text,
        note: '자동 복사가 막혀 있습니다. 아래 글을 전체 선택(Ctrl+A)해서 복사(Ctrl+C)한 뒤 붙여 넣어 보내 주세요. API 키는 포함되지 않습니다.',
      });
    }
  }

  function removeBasemap() {
    if (basemapLayer) {
      layerManager.remove(basemapLayer.id);
      basemapLayer = null;
    }
    ui.setAttribution('');
  }

  // 배경 지도의 범위/높이는 선언된 루트 bounding volume이 아니라 실제로 로드된 메시로 정한다
  // (루트 볼륨은 실제 데이터보다 훨씬 클 수 있다). 처음 로딩이 한 번 가라앉으면 그때 지도를 깐다.
  let bmContent = null; // computeContentBounds 결과 (없으면 아직 로드된 메시가 없음)
  let bmFitted = false; // 실제 메시 기준으로 한 번 깔았는지
  let bmFallbackTimer = null;

  /** 타일 로딩이 한 번 가라앉았을 때: 로드된 메시 기준으로 지도를 (처음이면) 깔고, 이후엔 높이만 따라간다. */
  function onTilesSettled() {
    if (!layer || !toGeo) return;
    const c = computeContentBounds(layer.object3d);
    if (!c) return;
    bmContent = c;
    clearTimeout(bmFallbackTimer);
    if (!bmSpec) return;
    if (!bmFitted) rebuildBasemap();
    else if (bmHeight == null) basemapLayer?.setHeight(c.groundY);
  }

  /** 타일 로딩 신호가 없어도(예: 실패) 일정 시간 뒤에는 선언된 범위로라도 지도를 깐다. */
  function scheduleBasemapFallback() {
    clearTimeout(bmFallbackTimer);
    bmFallbackTimer = setTimeout(() => {
      if (!disposed && bmSpec && !bmFitted) rebuildBasemap(true);
    }, 8000);
  }

  /**
   * 지금 타일셋 영역을 덮도록 배경 지도를 (다시) 만든다. geo 타일셋이 준비되기 전에는 아무것도 하지 않는다.
   * @param {boolean} [force] true면 로드된 메시가 없어도 선언된 범위로 깐다 (대기 시간 초과 시)
   */
  function rebuildBasemap(force = false) {
    removeBasemap();
    if (!bmSpec) return ui.setBasemapState({ message: '' });
    if (!toGeo || !homeBox || !current?.origin) {
      return ui.setBasemapState({
        message: current?.mode === 'model' ? 'model 모드(좌표 없음) 타일셋에는 지도를 깔 수 없습니다.' : '타일셋이 준비되면 지도를 깝니다.',
      });
    }
    let provider;
    try {
      provider = resolveProvider(bmSpec.provider, bmSpec.apiKey);
    } catch (e) {
      return ui.setBasemapState({ message: e.message });
    }
    if (!bmContent && !force) {
      // 아직 메시가 로드되지 않음: 로딩이 가라앉으면(onTilesSettled) 그때 깐다
      ui.setBasemapState({ message: '타일을 불러온 뒤 지도를 깝니다…' });
      return scheduleBasemapFallback();
    }
    // 실제 메시가 있으면 그 범위, 없으면 선언된 범위(homeBox)
    const area = (bmContent?.box ?? homeBox).clone();
    // 작은 모델(건물 한 채 등)은 지도가 모델 크기만큼만 깔리면 주변을 알아볼 수 없으므로 최소 범위를 둔다.
    const MIN_SPAN = 400; // m
    for (const axis of ['x', 'z']) {
      const span = area.max[axis] - area.min[axis];
      if (span < MIN_SPAN) {
        area.min[axis] -= (MIN_SPAN - span) / 2;
        area.max[axis] += (MIN_SPAN - span) / 2;
      }
    }
    const baseY = bmContent ? bmContent.groundY : homeBox.getCenter(new THREE.Vector3()).y;
    bmFitted = !!bmContent;
    bmBuiltCenter = area.getCenter(new THREE.Vector3()); // 모델을 옮겼을 때 지도를 다시 깔지 판단하는 기준
    const corners = [
      [area.min.x, area.min.z],
      [area.max.x, area.min.z],
      [area.min.x, area.max.z],
      [area.max.x, area.max.z],
    ].map(([x, z]) => toGeo(x, baseY, z));
    basemapLayer = new BasemapLayer({
      id: `basemap-${++bmSeq}`,
      provider,
      bbox: bboxFromPoints(corners),
      origin: current.origin,
      height: bmHeight ?? baseY, // 기본: 로드된 메시 바닥 높이의 낮은 백분위수
      maxTiles: bmSpec.maxTiles ?? 256,
    });
    layerManager.add(basemapLayer);
    basemapLayer.object3d.visible = visibility.basemap;
    ui.setAttribution(provider.attribution);
    ui.setBasemapState({ height: basemapLayer.getHeight() });
    updateBasemapMessage();
  }

  function updateBasemapMessage() {
    if (!basemapLayer) return;
    const s = basemapLayer.getStats();
    let msg = `줌 ${basemapLayer.zoom} · 타일 ${s.loaded}/${s.total}`;
    if (s.blank > 0) msg += ` · 빈 이미지 ${s.blank} (${s.firstError?.reason ?? '투명/검은 이미지'} — 지도 공급자의 키·도메인·지역 확인)`;
    if (s.failed > 0) msg += ` · 실패 ${s.failed} (API 키·허용 도메인·네트워크 확인)`;
    // 마우스를 올리면 첫 문제의 주소를 보여 준다 (키는 가린다)
    const detail = s.firstError ? `첫 문제: ${s.firstError.reason}\n${maskKey(s.firstError.url)}` : '';
    ui.setBasemapState({ message: msg, detail });
  }

  function disposeMinimap() {
    // 배경 렌더러가 먼저: 레이어에 등록했던 보조 카메라를 해제한다
    minimapBg?.dispose();
    minimap?.dispose();
    minimapBg = null;
    minimap = null;
  }

  /** 지금 로드된 레이어들 기준으로 미니맵을 (다시) 만든다. 꺼져 있거나 타일셋이 없으면 만들지 않는다. */
  function buildMinimap() {
    disposeMinimap();
    if (!minimapOn || !layer || !annotationLayer) return;
    minimapBg = createMinimapTileRenderer({ viewer, layerManager, size: MINIMAP_SIZE });
    minimap = createMinimap({ background: minimapBg, parent: ui.minimapSlot, inline: true });
  }

  function removeCurrentLayer() {
    if (tool === 'walk') api.setTool(null); // 체험 중이었다면 먼저 종료 (카메라/컨트롤 복구)
    clearModelEdit();
    cancelFaceNorth();
    removeBasemap();
    clearTimeout(bmFallbackTimer);
    bmContent = null;
    bmFitted = false;
    visibility.tileset = visibility.basemap = visibility.memos = true;
    for (const k of Object.keys(visibility)) ui.setLayerChecked(k, true);
    disposeMinimap();
    measure?.dispose();
    measure = null;
    annotationTool?.dispose();
    annotationTool = null;
    if (annotationLayer) {
      layerManager.remove(annotationLayer.id);
      annotationLayer = null;
    }
    annotationScope = null;
    toGeo = null;
    ui.hidePopup();
    if (layer) {
      layerManager.remove(layer.id);
      layer = null;
    }
    homeBox = null;
    failedMessages = [];
  }

  function fmt(n, digits = 1) {
    return Number.isFinite(n) ? n.toLocaleString('ko-KR', { maximumFractionDigits: digits }) : '-';
  }

  function decoderRow(label, needed, problem) {
    if (!needed) return [label, '사용 안 함', 'tvk-dim'];
    if (problem) return [label, '필요 · 파일 없음', 'tvk-bad'];
    return [label, '필요 · 디코드 가능', 'tvk-ok'];
  }

  /** 단독 glb를 열었을 때의 정보 패널 */
  function buildModelSections() {
    const { glb, placement, decoderProblems, mode, name, fileSize } = current;
    const sections = [];
    sections.push({
      title: '모델 (glb)',
      rows: [
        ['이름', name],
        ['파일 크기', fileSize == null ? '-' : fileSize < 1048576 ? `${fmt(fileSize / 1024, 1)} KB` : `${fmt(fileSize / 1048576, 2)} MB`],
        ['glTF 버전', glb.version ?? '-'],
        ['생성 도구', glb.generator ?? '-'],
        ['메시 / 재질 / 텍스처', `${glb.counts.meshes} / ${glb.counts.materials} / ${glb.counts.textures}`],
        ['삼각형', fmt(glb.triangles, 0)],
      ],
    });
    const modelBox = layer?.getBoundingBox?.();
    const placeRows = [['표시 모드', mode === 'geo' ? 'geo (좌표로 배치)' : 'model (단일 모델, 좌표 없음)'], ...placement.summary];
    if (modelBox) {
      placeRows.push(['대략 크기', modelBox.getSize(new THREE.Vector3()).toArray().map((v) => fmt(v, 1)).join(' × ') + (mode === 'geo' ? ' m' : '')]);
    }
    sections.push({ title: '좌표 / 배치', rows: placeRows });

    const contentRows = [
      decoderRow('Draco (메시 압축)', glb.needs.draco, decoderProblems.some((p) => p.startsWith('Draco'))),
      decoderRow('KTX2 (텍스처 압축)', glb.needs.ktx2, decoderProblems.some((p) => p.startsWith('KTX2'))),
      decoderRow('Meshopt', glb.needs.meshopt, false),
    ];
    const notes = [];
    if (!glb.needs.draco && !glb.needs.ktx2 && !glb.needs.meshopt) notes.push('압축 확장이 없는 파일이라 디코드 없이 그대로 표시합니다.');
    for (const p of decoderProblems) notes.push(p);
    sections.push({ title: '압축 / 디코더', rows: contentRows, notes });
    if (glb.warnings.length) sections.push({ title: '참고', notes: glb.warnings });
    return sections;
  }

  function buildSections() {
    if (!current) return [];
    if (current.kind === 'model') return buildModelSections();
    const { info, content, decoderProblems, mode, name, entry, profile } = current;
    const live = layer?.getStats?.();
    const sections = [];

    sections.push({
      title: '타일셋',
      rows: [
        ['이름', name],
        ['시작 파일', entry],
        ['3D Tiles 버전', info.assetVersion ?? '-'],
        ['데이터 버전', info.tilesetVersion ?? '-'],
        ['루트 refine', info.refine ?? '-'],
        ['geometricError', info.geometricError != null ? fmt(info.geometricError, 2) : '-'],
        ['루트 자식 타일', String(info.rootChildCount)],
      ],
    });

    const modeRows = [
      ['표시 모드', mode === 'geo' ? 'geo (지리참조)' : 'model (로컬 좌표)'],
      ['판별 근거', info.modeReason || '-', 'tvk-dim'],
    ];
    if (mode === 'geo' && current.origin) {
      modeRows.push(['기준 원점 (경도)', current.origin.lon.toFixed(6)]);
      modeRows.push(['기준 원점 (위도)', current.origin.lat.toFixed(6)]);
      if (info.centerAltitude != null) modeRows.push(['중심 고도', `${fmt(info.centerAltitude)} m`]);
    }
    if (info.size) modeRows.push(['대략 크기', info.size.map((v) => fmt(v, 0)).join(' × ') + (mode === 'geo' ? ' m' : '')]);
    if (profile?.errorTarget != null) modeRows.push(['errorTarget', String(profile.errorTarget)]);
    sections.push({ title: '좌표 / 모드', rows: modeRows });

    const contentRows = [
      ['콘텐츠 형식', content.formats.length ? content.formats.join(', ') : '확인 불가', content.formats.length ? null : 'tvk-warn'],
      ['검사한 파일', `${content.sampled}개`],
    ];
    const contentNotes = [];
    if (content.sampled > 0) {
      contentRows.push(decoderRow('Draco (메시 압축)', content.needs.draco, decoderProblems.some((p) => p.startsWith('Draco'))));
      contentRows.push(decoderRow('KTX2 (텍스처 압축)', content.needs.ktx2, decoderProblems.some((p) => p.startsWith('KTX2'))));
      contentRows.push(decoderRow('Meshopt', content.needs.meshopt, false));
      if (!content.needs.draco && !content.needs.ktx2 && !content.needs.meshopt) {
        contentNotes.push('압축 확장이 없는 데이터라 디코드 없이 그대로 표시합니다.');
      }
    } else {
      contentRows.push(['압축 여부', '확인 불가 (로드 시 자동 처리)', 'tvk-warn']);
    }
    if (content.notInspected.length) contentNotes.push(`내용을 열어보지 않은 형식: ${content.notInspected.join(', ')}`);
    for (const p of decoderProblems) contentNotes.push(p);
    for (const e of content.errors) contentNotes.push(`검사 오류: ${e}`);
    sections.push({ title: '압축 / 디코더', rows: contentRows, notes: contentNotes });

    sections.push({
      title: '로딩 현황',
      rows: [
        ['로드된 타일', live ? String(live.loaded) : '-'],
        ['받는 중 / 대기', live ? `${live.downloading + live.parsing} / ${live.queued}` : '-'],
        ['실패', live ? String(live.failed) : '-', live && live.failed > 0 ? 'tvk-bad' : null],
        ['화면에 표시', live && live.visible != null ? String(live.visible) : '-'],
      ],
      notes: failedMessages.slice(-2),
    });

    if (info.warnings.length) sections.push({ title: '참고', notes: info.warnings });
    return sections;
  }

  function refreshLiveStats() {
    if (disposed || !current) return;
    ui.renderInfo(buildSections());
    updateBasemapMessage();
  }

  // ---------- 모델 편집: 배치한 glb의 위치·높이·각도·크기를 즉시 고친다 ----------
  /** @type {null|{origin:object|null, geo:boolean, base:import('./modelPlacement.js').ModelEdit, cur:import('./modelPlacement.js').ModelEdit}} */
  let editState = null;
  let dragMoveOn = false;
  let dragSession = null;
  let editTimer = null;
  let bmBuiltCenter = null;

  /** 모델을 올린 직후 편집 상태를 만든다. 지구 좌표(ECEF)로 구워진 모델은 위치 편집이 의미가 없어 편집을 끈다. */
  function startModelEdit(plan, spec) {
    if (spec.type === 'ecef') {
      editState = null;
      ui.setEditAvailable(false);
      return;
    }
    const geo = plan.mode === 'geo';
    const base = {
      lon: plan.lonLat?.lon,
      lat: plan.lonLat?.lat,
      height: plan.lonLat?.height ?? 0,
      headingDeg: spec.headingDeg ?? 0,
      pitchDeg: spec.pitchDeg ?? 0,
      rollDeg: spec.rollDeg ?? 0,
      upAxis: spec.upAxis ?? 'Y',
      scale: spec.scale ?? 1,
      pivot: plan.pivot ?? null, // 파일 안 좌표로 배치한 모델은 바닥 중심 기준으로 돌고 옮겨진다
    };
    editState = { origin: plan.origin, geo, base, cur: { ...base } };
    ui.setEditAvailable(true, { geo });
    ui.setEditValues(editState.cur);
  }

  function clearModelEdit() {
    editState = null;
    dragSession = null;
    dragMoveOn = false;
    clearTimeout(editTimer);
    bmBuiltCenter = null;
    ui.setEditAvailable(false);
    ui.setEditDragPressed(false);
  }

  /** 편집 값을 행렬로 바꿔 모델에 적용한다. light면 정보 패널 갱신을 미룬다 (끌어서 옮기는 동안) */
  function applyEdit({ light = false } = {}) {
    if (!editState || !(layer instanceof ModelLayer)) return;
    const e = editState.cur;
    const matrix = editState.geo
      ? editedMatrix(editState.origin, e)
      : buildLocalMatrix({ headingDeg: e.headingDeg, pitchDeg: e.pitchDeg, rollDeg: e.rollDeg, upAxis: e.upAxis, scale: e.scale });
    layer.setMatrix(matrix);
    ui.setEditValues(e);
    if (current?.kind === 'model') {
      current.placement = {
        ...current.placement,
        matrix,
        lonLat: editState.geo ? { lon: e.lon, lat: e.lat, height: e.height } : null,
        summary: describeEdit(e, { geo: editState.geo }),
      };
      if (!light) ui.renderInfo(buildSections());
    }
    scheduleBasemapRefit();
  }

  /** 편집이 잠깐 멈추면 배경 지도 범위·높이를 모델의 새 위치에 맞춘다 (매번 다시 받지 않도록 지연) */
  function scheduleBasemapRefit() {
    clearTimeout(editTimer);
    editTimer = setTimeout(() => {
      if (disposed || !editState?.geo || !(layer instanceof ModelLayer)) return;
      const c = computeContentBounds(layer.object3d);
      if (!c) return;
      bmContent = c;
      const box = layer.getBoundingBox();
      if (box) {
        homeBox = box.clone();
        rig?.setBounds(homeBox);
      }
      if (!bmSpec) return;
      const center = c.box.getCenter(new THREE.Vector3());
      const moved = bmBuiltCenter ? Math.hypot(center.x - bmBuiltCenter.x, center.z - bmBuiltCenter.z) : Infinity;
      if (!basemapLayer || moved > 80) rebuildBasemap();
      else if (bmHeight == null) basemapLayer.setHeight(c.groundY);
    }, 600);
  }

  function editChange(patch) {
    if (!editState) return;
    const next = { ...editState.cur, ...patch };
    if (!(next.scale > 0) || !Number.isFinite(next.scale)) return;
    for (const k of ['height', 'headingDeg', 'pitchDeg', 'rollDeg']) if (!Number.isFinite(next[k])) return;
    editState.cur = next;
    applyEdit();
  }

  /** 동서(+동)/남북(+북) 미터만큼 옮긴다 (나침반 방향 기준 — 모델의 방향과 무관) */
  function editNudge(dEast, dNorth) {
    if (!editState?.geo || !toGeo) return;
    const e = editState.cur;
    const p = createGeodeticToLocal(editState.origin)(e.lon, e.lat, e.height);
    const g = toGeo(p.x + dEast, p.y, p.z - dNorth); // 로컬: x=동, z=-북
    editState.cur = { ...e, lon: g.lon, lat: g.lat };
    applyEdit();
  }

  async function editPickOnMap() {
    if (!editState?.geo) return;
    const e = editState.cur;
    const ll = await ui.askLocation({
      map: { ...pickerMapOptions(), center: { lon: e.lon, lat: e.lat }, zoom: 17 },
      marker: { lon: e.lon, lat: e.lat },
    });
    if (!ll || !editState) return;
    editState.cur = { ...editState.cur, lon: ll.lon, lat: ll.lat };
    applyEdit();
  }

  function editReset() {
    if (!editState) return;
    editState.cur = { ...editState.base };
    applyEdit();
  }

  /** "모델을 끌어서 이동" 켜기/끄기. 다른 도구(측정·메모·체험)와는 같이 쓰지 않는다. */
  function setDragMove(on) {
    dragMoveOn = !!on && !!editState?.geo && !tool;
    ui.setEditDragPressed(dragMoveOn);
    if (dragMoveOn) ui.setStatus('모델을 끌어서 옮길 수 있습니다 (모델 밖을 끌면 지도 이동)', 'idle');
  }

  const dragRay = new THREE.Raycaster();
  const dragNdc = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const dragHit = new THREE.Vector3();
  /** 포인터 위치에서 쏜 광선이 수평면(dragPlane)과 만나는 점 */
  function rayToPlane(e) {
    const r = viewer.domElement.getBoundingClientRect();
    dragNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    dragRay.setFromCamera(dragNdc, viewer.camera);
    return dragRay.ray.intersectPlane(dragPlane, dragHit) ? dragHit.clone() : null;
  }
  const onModelPointerDown = (e) => {
    if (!dragMoveOn || e.button !== 0 || !editState?.geo || tool || walkActive) return;
    const hit = pickFromEvent(e);
    if (!hit || hit.metadata?.layerId !== layer?.id) return; // 모델 위에서만 시작
    dragPlane.set(new THREE.Vector3(0, 1, 0), -hit.point.y);
    const p0 = rayToPlane(e);
    if (!p0) return;
    const ec = editState.cur;
    const anchor = createGeodeticToLocal(editState.origin)(ec.lon, ec.lat, ec.height);
    dragSession = { grabDx: p0.x - anchor.x, grabDz: p0.z - anchor.z, anchorY: anchor.y, pointerId: e.pointerId };
    if (rig) rig.controls.enabled = false; // 지도/회전 컨트롤이 같은 드래그를 가져가지 않게
    viewer.domElement.setPointerCapture?.(e.pointerId);
    viewer.domElement.style.cursor = 'move';
    e.stopImmediatePropagation();
    e.preventDefault();
  };
  const onModelPointerMove = (e) => {
    if (!dragSession) return;
    const p = rayToPlane(e);
    if (!p || !toGeo) return;
    const g = toGeo(p.x - dragSession.grabDx, dragSession.anchorY, p.z - dragSession.grabDz);
    editState.cur = { ...editState.cur, lon: g.lon, lat: g.lat };
    applyEdit({ light: true });
    e.stopImmediatePropagation();
  };
  const onModelPointerUp = (e) => {
    if (!dragSession) return;
    viewer.domElement.releasePointerCapture?.(dragSession.pointerId);
    dragSession = null;
    if (rig && !walkActive) rig.controls.enabled = true;
    viewer.domElement.style.cursor = tool ? 'crosshair' : '';
    applyEdit(); // 끝나면 정보 패널도 갱신
    e.stopImmediatePropagation();
  };
  // 캡처 단계에서 먼저 받아야 지도/회전 컨트롤보다 앞서 가로챌 수 있다
  viewer.domElement.addEventListener('pointerdown', onModelPointerDown, { capture: true });
  viewer.domElement.addEventListener('pointermove', onModelPointerMove, { capture: true });
  viewer.domElement.addEventListener('pointerup', onModelPointerUp, { capture: true });

  // ---------- 타일셋/모델 공통: 데이터를 화면에 올릴 때의 단계 ----------
  /**
   * 새 데이터가 정상으로 확인된 뒤, 이전 것을 지우기 *전에* 호출한다. 메모가 있고 다른 데이터로 바꾸는 거라면 먼저 묻는다.
   * 취소하거나 묻는 동안 더 새로운 로드가 시작되면 null (이전 화면은 그대로 남는다).
   * @returns {Promise<{prevScope:string|null, prevMemoCount:number, askedFirst:boolean}|null>}
   */
  async function confirmReplace(token, displayName, nextScope) {
    const prevScope = annotationScope;
    const prevMemoCount = annotationLayer?.getAll().length ?? 0;
    let askedFirst = false;
    if (prevScope != null && prevScope !== nextScope && prevMemoCount > 0 && opts.confirmSwitch) {
      ui.setStatus('데이터를 바꿀지 확인해 주세요', 'busy');
      const ok = await ui.confirm({
        message: `지금 화면에 메모 ${prevMemoCount}개가 있습니다.\n"${displayName}"을(를) 열면 이 메모가 모두 삭제됩니다.\n계속할까요?`,
        okLabel: '메모 삭제하고 열기',
        cancelLabel: '취소',
      });
      if (token !== loadToken || disposed) return null; // 묻는 동안 더 새로운 로드가 시작됨
      if (!ok) {
        ui.setStatus(layer ? '준비됨' : '변경을 취소했습니다', 'idle');
        emit('tileset-cancelled', { name: displayName });
        return null;
      }
      askedFirst = true;
    }
    return { prevScope, prevMemoCount, askedFirst };
  }

  /**
   * 이전 데이터를 치우고 모드에 맞는 카메라 컨트롤을 준비한다.
   * 미니맵의 기본값도 여기서 정한다: 단독 glb는 좁은 범위라 미니맵이 쓸모가 적어 기본으로 꺼 두고,
   * 타일셋은 옵션(기본 켜짐)을 따른다. 사용자가 직접 켜고 끈 적이 있으면 그 선택을 유지한다.
   * @param {'model'|'geo'} mode
   * @param {'tileset'|'model'} [kind]
   */
  function beginScene(mode, kind = 'tileset') {
    removeCurrentLayer();
    ensureRig(mode);
    minimapOn = minimapChoice ?? (kind === 'model' ? false : !!opts.minimap);
    ui.setMinimapPressed(minimapOn);
    if (kind === 'tileset' && bmAutoSet) {
      // glb를 위해 자동으로 켠 배경 지도는 타일셋에는 이어 쓰지 않는다
      bmSpec = null;
      bmAutoSet = false;
      ui.setBasemapState({ provider: 'none', apiKey: '' });
    }
  }

  /**
   * 데이터 레이어(`layer`)를 올린 직후 공통 설정: 측정, 좌표 표시, 나침반, 메모, 미니맵, 메모 복원/초기화.
   * @param {{mode:'model'|'geo', origin:object|null|undefined, scope:string, maxDim:number,
   *          gate:{prevScope:string|null, prevMemoCount:number, askedFirst:boolean}}} o
   */
  function setupScene({ mode, origin, scope, maxDim, gate }) {
    measure = new MeasureTool({ unitLabel: mode === 'geo' ? 'm' : '단위' });
    if (tool === 'measure') measure.enable(viewer);

    // 마우스 위치/클릭 좌표 표시용 변환, 나침반 (geo 모드만)
    toGeo = mode === 'geo' ? createLocalToGeodetic(origin) : null;
    ui.setCompassVisible(mode === 'geo');
    ui.setReadout('마우스 위치: -');
    ui.setBasemapState({
      supported: mode === 'geo',
      message: mode === 'geo' ? '' : '좌표가 없는 데이터(model 모드)에는 지도를 깔 수 없습니다.',
    });

    // 메모: 아이콘 크기를 데이터 크기에 맞춘다 (미터 단위 geo 기준 20m였던 고정값을 일반화).
    const iconSize = maxDim > 0 ? Math.min(Math.max(maxDim / 400, 0.5), 40) : 20;
    annotationLayer = new AnnotationLayer({
      id: `annotations-${layerSeq}`,
      iconSize,
      floatHeight: iconSize * 1.25,
    });
    layerManager.add(annotationLayer);
    annotationScope = scope;
    const thisAnnotationLayer = annotationLayer;
    annotationTool = new AnnotationTool(thisAnnotationLayer, {
      onAdded: () => persistence?.save(annotationScope, thisAnnotationLayer.getAll()),
    });
    if (tool === 'annotate') annotationTool.enable(viewer);
    buildMinimap();

    // 다른 데이터로 바꾸는 경우: 메모는 초기화한다 (화면 + 저장소). 메모 저장 키가 이름이라
    // 이름이 같은 다른 데이터의 메모가 섞이는 문제도 이렇게 없앤다. 같은 데이터를 다시 여는 경우는 그대로 복원한다.
    const { prevScope, prevMemoCount, askedFirst } = gate;
    const switching = prevScope != null && prevScope !== scope;
    if (switching) {
      for (const s of [prevScope, scope]) {
        try {
          Promise.resolve(persistence?.save(s, [])).catch(() => {});
        } catch {
          /* 저장소 오류가 로드를 막지 않게 */
        }
      }
      if (prevMemoCount > 0 && !askedFirst) {
        // 미리 묻지 않은 경우(confirmSwitch: false 등)에만 사후 알림
        ui.showNotice(`데이터를 바꿔서 이전 메모 ${prevMemoCount}개가 삭제되었습니다. (메모는 데이터마다 초기화됩니다)`);
      }
    }
    if (persistence && !switching) {
      Promise.resolve(persistence.load(scope)).then((saved) => {
        if (annotationLayer !== thisAnnotationLayer) return; // 그 사이 다른 데이터로 바뀜
        for (const a of saved ?? []) thisAnnotationLayer.addAnnotation(a.position, a.text);
      });
    }
  }

  // ---------- 공개 API ----------
  const api = {
    /** 내부 접근용 (디버깅/고급 사용) */
    viewer,

    /**
     * @param {{kind:'url', url:string, name?:string}|{kind:'files', files:Map<string,File>, entry?:string, name?:string}|{kind:'backend', apiUrl:string, id:string}} source
     * @param {{mode?:'model'|'geo', errorTarget?:number, enableFade?:boolean, origin?:{lon:number,lat:number,alt?:number}}} [profile]
     */
    async loadTileset(source, profile = {}) {
      ui.dismissConfirm(); // 아직 답하지 않은 "타일셋을 바꿀까요?"가 있으면 새 로드가 우선하므로 닫는다
      const token = ++loadToken;
      ui.setStatus('타일셋 확인 중…', 'busy');
      ui.setBusy('타일셋 확인 중…');
      try {
        if (source?.kind === 'backend') {
          if (!BACKEND_ENABLED) throw new Error('이 빌드(<script> 번들)는 서버 연결을 포함하지 않습니다. { kind: "url" } 또는 폴더 열기를 사용하세요.');
          // 서버가 알려준 entry 주소를 일반 URL처럼 로드하고, 서버 프로필은 호출자가 준 값보다 낮은 우선순위로 적용한다.
          const t = await getBackendTileset(source.apiUrl, source.id);
          profile = { ...t.profile, ...profile };
          source = { kind: 'url', url: t.url, name: t.name };
        }
        const src = resolveSource(source);
        const rootJson = await src.readJson(src.rootUrl);
        const info = analyzeTileset(rootJson);

        ui.setStatus('타일 내용 검사 중 (압축 여부)…', 'busy');
        ui.setBusy('타일 내용 검사 중 (압축 여부)…');
        const content = await inspectContent(src, rootJson);
        ui.setBusy('디코더 확인 중…');
        const decoderProblems = await checkDecoders(content.needs, opts.decoderBaseUrl);
        if (token !== loadToken || disposed) return null; // 더 새로운 로드가 시작됨 (로딩 표시는 새 로드가 이어받는다)
        // 준비 단계 끝. 이제 화면이 바뀌거나(타일 로딩은 상태줄로 보인다) 확인창이 뜬다.
        ui.setBusy(null);

        let mode = profile.mode ?? (opts.mode === 'auto' ? info.detectedMode : opts.mode);
        let origin = profile.origin ?? info.origin;
        if (mode === 'geo' && !origin) {
          info.warnings.push('geo 모드지만 기준 원점을 정할 수 없어 model 모드로 표시합니다.');
          mode = 'model';
        }

        // 지금 화면의 메모가 있고 다른 데이터로 바꾸는 거라면 먼저 확인한다 (취소하면 이전 것이 그대로 남는다)
        const nextScope = `${source.name ?? src.name}|${mode}`;
        const gate = await confirmReplace(token, source.name ?? src.name, nextScope);
        if (!gate) return null;
        beginScene(mode, 'tileset');

        layer = new Tiles3DLayer({
          id: `tileset-${++layerSeq}`,
          tilesetUrl: src.rootUrl,
          placement: mode,
          origin: mode === 'geo' ? origin : undefined,
          errorTarget: profile.errorTarget,
          errorScale: perf.tileQualityScale,
          enableFade: profile.enableFade ?? true,
          decoderBaseUrl: opts.decoderBaseUrl,
          plugins: src.plugins,
        });
        const thisLayer = layer;
        layerManager.add(thisLayer);

        setupScene({
          mode,
          origin,
          scope: nextScope,
          maxDim: info.size ? Math.max(...info.size) : 0,
          gate,
        });

        thisLayer.onReady((box) => {
          if (thisLayer !== layer) return;
          homeBox = box.clone();
          rig.fitTo(homeBox);
          if (mode === 'geo') rig.setBounds(homeBox);
          // 선택해 둔 배경 지도는 첫 로딩이 가라앉아 실제 메시 범위를 알게 되면 깐다 (onTilesSettled)
          if (bmSpec) {
            ui.setBasemapState({ message: '타일을 불러온 뒤 지도를 깝니다…' });
            scheduleBasemapFallback();
          }
          emit('tileset-ready', { name: src.name, mode, info });
        });
        thisLayer.onLoadingChange((loading) => {
          if (thisLayer !== layer) return;
          ui.setStatus(loading ? '타일 불러오는 중…' : '준비됨', loading ? 'busy' : 'idle');
          if (!loading) onTilesSettled();
        });
        thisLayer.onLoadError(({ url, error }) => {
          if (thisLayer !== layer) return;
          const tail = String(url).split('/').slice(-2).join('/');
          failedMessages.push(`${tail}: ${error?.message ?? error}`);
          ui.setStatus(`일부 타일을 불러오지 못했습니다 (${tail})`, 'error');
        });

        current = {
          name: source.name ?? src.name,
          entry: src.entry,
          info,
          content,
          decoderProblems,
          mode,
          origin,
          profile,
        };
        ui.hideEmpty();
        ui.renderInfo(buildSections());
        if (decoderProblems.length) ui.setStatus(decoderProblems[0], 'error');
        return current;
      } catch (err) {
        if (token === loadToken) {
          ui.setBusy(null);
          reportError(err);
        }
        throw err;
      }
    },

    /**
     * glb 모델 파일 한 개를 연다.
     *
     * 위치는 `placement`로 정하고, 주지 않으면 화면의 "위치 정하기" 대화상자에서 사용자가 고른다
     * (파일에 위치 정보가 있으면 그것을 기본 후보로 보여 준다). "좌표 없이 단일 모델로 보기"는
     * 사용자가 그 버튼을 눌렀을 때(= 동의)만 쓰인다.
     *
     * @param {File|Blob|string} input glb 파일 또는 주소
     * @param {import('./modelPlacement.js').PlacementSpec|{type:'auto'}} [placement]
     *   {type:'single'} 단일 모델 · {type:'coords', crs, x, y, height, headingDeg, upAxis, scale} 좌표 입력 ·
     *   {type:'auto'} 파일 안의 위치(CESIUM_RTC/ECEF) 사용
     * @returns {Promise<object|null>} 취소되면 null
     */
    async loadModel(input, placement) {
      ui.dismissConfirm();
      const token = ++loadToken;
      ui.setStatus('glb 읽는 중…', 'busy');
      ui.setBusy('glb 읽는 중…');
      try {
        // 1) 바이트 읽기와 파일 검사 (압축 여부, 범위, 좌표 후보)
        let buffer;
        let name;
        if (typeof input === 'string') {
          const res = await fetch(input, { mode: 'cors' });
          if (!res.ok) throw new Error(`가져오지 못했습니다 (HTTP ${res.status}): ${input}`);
          buffer = await res.arrayBuffer();
          name = decodeURIComponent(input.split('?')[0].split('/').pop() || 'model.glb');
        } else {
          buffer = await input.arrayBuffer();
          name = input.name || 'model.glb';
        }
        const glb = inspectGlb(buffer);
        if (!glb) throw new Error('glb 파일이 아닙니다 (.gltf나 다른 형식은 읽을 수 없습니다. 하나로 합친 .glb를 사용하세요).');
        ui.setBusy('디코더 확인 중…');
        const decoderProblems = await checkDecoders(glb.needs, opts.decoderBaseUrl);
        if (token !== loadToken || disposed) return null;
        ui.setBusy(null);

        // 2) 위치 정하기
        let spec = placement;
        if (!spec) {
          let detected = glb.detected
            ? [{
                label: glb.detected.kind === 'rtc' ? 'CESIUM_RTC 좌표(지구 좌표)' : '정점이 지구 좌표(ECEF)로 저장됨',
                spec: { type: glb.detected.kind },
              }]
            : [];
          const embeddedWarnings = [];
          if (!glb.detected) {
            // 파일 안에 실제 좌표(투영 좌표)가 들어 있는 모델이면 위치를 추천한다. 대부분의 glb는 해당하지 않아 아무것도 나오지 않는다.
            const found = findEmbeddedPlacements(glb);
            detected = found.suggestions;
            embeddedWarnings.push(...found.warnings);
          }
          if (!detected.length) detected = null;
          const details = [`삼각형 ${fmt(glb.triangles, 0)}`];
          if (glb.size) details.push(`크기 ${glb.size.map((v) => fmt(v, 1)).join(' × ')}`);
          const zipped = ['Draco', 'KTX2', 'Meshopt'].filter((_, i) => Object.values(glb.needs)[i]);
          if (zipped.length) details.push(`압축 ${zipped.join('+')}`);
          ui.setStatus('모델 위치를 정해 주세요', 'busy');
          spec = await ui.askPlacement({
            fileName: name,
            details,
            warnings: [...glb.warnings, ...embeddedWarnings, ...decoderProblems],
            detected,
            map: pickerMapOptions(),
          });
          if (token !== loadToken || disposed) return null;
          if (!spec) {
            ui.setStatus(layer ? '준비됨' : 'glb 열기를 취소했습니다', 'idle');
            emit('model-cancelled', { name });
            return null;
          }
        } else if (spec.type === 'auto') {
          if (!glb.detected) throw new Error('이 파일에는 위치 정보가 없어 자동 배치할 수 없습니다.');
          spec = { type: glb.detected.kind };
        }
        const plan = planPlacement(spec, glb);
        if ((spec.type === 'coords' || spec.type === 'projected') && plan.lonLat) saveLastPick(plan.lonLat); // 다음에 지도가 이 근처에서 시작한다

        // 3) 모델 해석 (압축 해제 등으로 오래 걸릴 수 있다). 실패하면 이전 화면은 그대로 둔다.
        ui.setStatus('모델 해석 중…', 'busy');
        ui.setBusy('모델 해석 중… (압축 해제)');
        const gltf = await parseGlb(buffer, { decoderBaseUrl: opts.decoderBaseUrl, renderer: viewer.renderer });
        if (token !== loadToken || disposed) return null;
        ui.setBusy(null);

        // 4) 이전 화면 교체 (메모가 있으면 먼저 확인)
        const nextScope = `${name}|${plan.mode}`;
        const gate = await confirmReplace(token, name, nextScope);
        if (!gate) return null;
        beginScene(plan.mode, 'model');

        const thisLayer = new ModelLayer({ id: `model-${++layerSeq}`, scene: gltf.scene, matrix: plan.matrix, name });
        layer = thisLayer;
        layerManager.add(thisLayer);
        const box = thisLayer.getBoundingBox();
        const maxDim = box ? Math.max(...box.getSize(new THREE.Vector3()).toArray()) : 0;
        setupScene({ mode: plan.mode, origin: plan.origin, scope: nextScope, maxDim, gate });

        if (box) {
          homeBox = box.clone();
          rig.fitTo(homeBox);
          if (plan.mode === 'geo') rig.setBounds(homeBox);
        }
        current = {
          kind: 'model',
          name,
          entry: name,
          fileSize: typeof input === 'string' ? buffer.byteLength : input.size,
          glb,
          placement: plan,
          decoderProblems,
          mode: plan.mode,
          origin: plan.origin,
          profile: {},
        };
        startModelEdit(plan, spec); // 배치한 뒤 고칠 수 있게 "모델 편집" 버튼을 켠다
        ui.hideEmpty();
        ui.renderInfo(buildSections());
        ui.setStatus(decoderProblems[0] ?? '준비됨', decoderProblems.length ? 'error' : 'idle');
        // 좌표로 배치했는데 배경 지도를 고른 적이 없으면 OSM을 기본으로 깐다 (사용자가 "쓰지 않음"을 골랐다면 그대로 둔다)
        if (plan.mode === 'geo' && !bmSpec && !bmUserOff) {
          bmSpec = { provider: 'osm', apiKey: '' };
          bmAutoSet = true;
          ui.setBasemapState({ provider: 'osm', apiKey: '' });
        }
        // 선택해 둔 배경 지도: 모델은 이미 메모리에 있으므로 바로 범위를 알 수 있다
        if (plan.mode === 'geo') onTilesSettled();
        emit('model-ready', { name, mode: plan.mode, placement: plan, info: glb });
        return current;
      } catch (err) {
        if (token === loadToken) {
          ui.setBusy(null);
          reportError(err);
        }
        throw err;
      }
    },

    /** 지금 적용 중인 성능 설정 ({pref, lowEnd, antialias, maxPixelRatio, tileQualityScale, label, reason, ...}) */
    getPerformance() {
      return { ...perf };
    },

    /**
     * 성능 모드를 바꾼다: 'auto'(이 PC 사양으로 판단) | 'low' | 'normal'. 선택은 저장된다.
     * 화면 배율과 타일 품질은 바로 적용되고, 안티앨리어싱은 렌더러를 만들 때만 정할 수 있어서 새로고침 후 적용된다.
     */
    setPerformance(pref) {
      perf = resolvePerf(pref, readEnv());
      savePref(perf.pref);
      viewer.setMaxPixelRatio(perf.maxPixelRatio);
      layer?.setErrorScale?.(perf.tileQualityScale);
      ui.setPerf(perf);
      if (perf.antialias !== viewer.antialias) ui.setStatus('선 부드럽게(안티앨리어싱) 설정은 페이지를 새로고침하면 적용됩니다.');
      return { ...perf };
    },

    /** 화면이 이상할 때 원인을 좁히기 위한 정보 (GPU, 카메라, 레이어, 배경 지도 상태). API 키는 들어 있지 않다. */
    getDiagnostics() {
      return collectDiagnostics();
    },

    /** 지금 열려 있는 단독 glb의 편집 값(위치·높이·각도·크기). 편집할 수 없으면 null. */
    getModelEdit() {
      return editState ? { ...editState.cur } : null;
    },

    /**
     * 열려 있는 단독 glb를 고친다. 화면의 "모델 편집" 패널과 같다.
     * @param {Partial<{lon:number, lat:number, height:number, headingDeg:number, pitchDeg:number, rollDeg:number, scale:number}>} patch
     */
    setModelEdit(patch) {
      if (!editState) return null;
      if (!editState.geo) patch = { ...patch, lon: undefined, lat: undefined, height: undefined };
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      editChange(clean);
      return { ...editState.cur };
    },

    /** 처음 시점(타일셋 전체가 보이는 위치)으로 되돌린다. */
    resetView() {
      if (rig && homeBox) rig.fitTo(homeBox);
    },

    /**
     * 로컬 좌표의 한 지점을 가운데 두고 가까이 보여준다 (메모/관심 지점으로 이동용).
     * @param {{x:number,y:number,z:number}} point
     * @param {number} [size=80] 화면에 담을 영역의 한 변 길이 (로컬 단위)
     */
    focusLocal(point, size = 80) {
      if (!rig) return;
      const box = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(point.x, point.y, point.z),
        new THREE.Vector3(size, size, size)
      );
      rig.fitTo(box);
    },

    /** 저장된/추가한 메모 목록 ({position, text}) */
    getAnnotations() {
      return annotationLayer ? [...annotationLayer.getAll()] : [];
    },

    /**
     * 클릭으로 동작하는 도구를 하나만 켠다. null이면 모두 끄고 "클릭 지점 정보" 모드로 돌아간다.
     * @param {'measure'|'annotate'|null} next
     */
    setTool(next) {
      if (next !== 'measure' && next !== 'annotate' && next !== 'walk') next = null;
      if (next === 'walk' && !(layer && rig && homeBox)) {
        ui.setStatus('체험 모드는 타일셋이 준비된 뒤에 시작할 수 있습니다.', 'error');
        next = null;
      }
      stopWalk(); // 체험 중이거나 시작 위치를 고르던 중이면 정리 (다른 도구로 바꾸는 경우 포함)
      if (next) setDragMove(false); // 측정/메모/체험을 켜면 모델 끌기는 끈다 (클릭의 뜻이 겹치지 않게)
      measure?.disable();
      annotationTool?.disable();
      tool = next;
      if (tool === 'measure') measure?.enable(viewer);
      if (tool === 'annotate') annotationTool?.enable(viewer);
      if (tool === 'walk') startWalkPicking();
      ui.setMeasurePressed(tool === 'measure');
      ui.setAnnotatePressed(tool === 'annotate');
      ui.setWalkPressed(tool === 'walk');
      viewer.domElement.style.cursor = tool ? 'crosshair' : '';
      if (tool) ui.hidePopup();
    },

    setMeasureEnabled(on) {
      api.setTool(on ? 'measure' : tool === 'measure' ? null : tool);
    },

    clearMeasurements() {
      measure?.clearAll();
    },

    /** 이 타일셋에 남긴 메모를 모두 지운다 (저장소에도 반영). */
    clearAnnotations() {
      if (!annotationLayer) return;
      annotationLayer.clear();
      persistence?.save(annotationScope, []);
    },

    /**
     * 카메라가 보는 방향을 부드럽게 북쪽으로 돌린다 (위아래 기울기와 위치는 유지). geo 타일셋에서만 의미가 있다.
     * 화면의 나침반을 더블클릭하는 것과 같다.
     */
    faceNorth() {
      if (!toGeo) return;
      cancelFaceNorth();
      const camera = viewer.camera;
      camera.updateMatrixWorld();
      const startDir = camera.getWorldDirection(new THREE.Vector3());
      // 위/아래 기울기(y 성분)는 그대로 두고 수평 성분만 정북(-z)으로
      const dy = THREE.MathUtils.clamp(startDir.y, -1, 1);
      const endDir = new THREE.Vector3(0, dy, -Math.sqrt(Math.max(0, 1 - dy * dy)));
      const rotToEnd = new THREE.Quaternion().setFromUnitVectors(startDir, endDir);
      const inWalk = walkActive;
      const startQuat = camera.quaternion.clone();
      const endQuat = new THREE.Quaternion().multiplyQuaternions(rotToEnd, startQuat);
      const position = camera.position.clone();
      const distance = inWalk || !rig ? 0 : camera.position.distanceTo(rig.controls.target);
      const identity = new THREE.Quaternion();
      const tmpQuat = new THREE.Quaternion();
      const tmpDir = new THREE.Vector3();
      let elapsed = 0;
      faceNorthAnim = (_cam, dt) => {
        if (walkActive !== inWalk) return cancelFaceNorth(); // 도중에 모드가 바뀌면 중단
        elapsed += dt;
        const t = Math.min(elapsed / FACE_NORTH_SECONDS, 1);
        const eased = 1 - (1 - t) ** 3;
        if (inWalk) {
          // 체험 모드: 컨트롤이 없으므로 카메라 회전을 직접 보간
          camera.quaternion.slerpQuaternions(startQuat, endQuat, eased);
        } else if (rig) {
          // 오빗/맵: 컨트롤이 매 프레임 target을 보고 시선을 다시 계산하므로 target을 같은 회전으로 보간
          tmpQuat.slerpQuaternions(identity, rotToEnd, eased);
          tmpDir.copy(startDir).applyQuaternion(tmpQuat);
          rig.controls.target.copy(position).addScaledVector(tmpDir, distance);
        }
        if (t >= 1) cancelFaceNorth();
      };
      viewer.addUpdateCallback(faceNorthAnim);
    },

    /**
     * 레이어를 화면에서 켜고 끈다 (타일 다운로드는 계속될 수 있다).
     * @param {'tileset'|'basemap'|'memos'} key
     */
    setLayerVisible(key, on) {
      if (!(key in visibility)) return;
      visibility[key] = !!on;
      ui.setLayerChecked(key, on);
      if (key === 'tileset' && layer) layer.object3d.visible = !!on;
      if (key === 'basemap' && basemapLayer) basemapLayer.object3d.visible = !!on;
      if (key === 'memos' && annotationLayer) annotationLayer.object3d.visible = !!on;
    },

    /**
     * 배경 지도를 바꾼다. geo 모드 타일셋에서만 보이며, 타일셋을 바꿔도 유지된다.
     * 위치는 3D Tiles와 같은 변환(WGS84 -> 원점 접평면)으로 맞춘다.
     * @param {null|string|{provider:string|{urlTemplate:string,maxZoom?:number,attribution?:string}, apiKey?:string, height?:number, maxTiles?:number}} spec
     *   null이면 끈다. 문자열이면 공급자 이름 (OSM 등 키가 필요 없는 것).
     */
    setBasemap(spec) {
      bmAutoSet = false; // 사용자가 직접 정했으니 더는 "자동으로 켠 것"이 아니다
      bmUserOff = spec == null; // 직접 끈 경우에는 이후 glb를 열어도 자동으로 켜지 않는다
      if (spec == null) {
        bmSpec = null;
      } else {
        const s = typeof spec === 'string' ? { provider: spec } : spec;
        if (s.height != null) bmHeight = s.height;
        bmSpec = { provider: s.provider, apiKey: s.apiKey ?? '', maxTiles: s.maxTiles };
      }
      saveBasemapPref();
      ui.setBasemapState({
        provider: bmSpec && typeof bmSpec.provider === 'string' ? bmSpec.provider : bmSpec ? undefined : 'none',
        apiKey: bmSpec?.apiKey ?? '',
      });
      rebuildBasemap();
    },

    /** 배경 지도 높이(m, 원점 기준 로컬 y)를 지정한다. 지정하지 않으면 타일셋의 가장 낮은 지점에 맞춘다. */
    setBasemapHeight(meters) {
      if (!Number.isFinite(meters)) return;
      bmHeight = meters;
      basemapLayer?.setHeight(meters);
    },

    /** 미니맵을 켜고 끈다. 끄면 보조 카메라도 해제되어 먼 구역 타일을 미리 받지 않는다. */
    setMinimapEnabled(on) {
      minimapOn = !!on;
      minimapChoice = minimapOn; // 사용자가 직접 정했으니 이후 데이터를 열어도 이 선택을 유지한다
      ui.setMinimapPressed(minimapOn);
      buildMinimap();
    },

    /** 현재 화면을 PNG로 저장한다. */
    saveScreenshot() {
      const base = (current?.name ?? 'tile-viewer').replace(/[\\/:*?"<>|\s]+/g, '_');
      viewer.saveScreenshot(`${base}.png`);
    },

    /** 마지막으로 불러온 타일셋의 분석 결과 */
    getInfo() {
      return current;
    },

    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    off(type, fn) {
      listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(statsTimer);
      ui.root.removeEventListener('dragenter', onDragEnter);
      ui.root.removeEventListener('dragover', onDragOver);
      ui.root.removeEventListener('dragleave', onDragLeave);
      ui.root.removeEventListener('drop', onDrop);
      viewer.domElement.removeEventListener('pointermove', onPointerMove);
      viewer.domElement.removeEventListener('pointerleave', onPointerLeave);
      removeClickInfo();
      window.removeEventListener('keydown', onKeyDown);
      stopWalk();
      cancelFaceNorth();
      clearModelEdit();
      viewer.domElement.removeEventListener('pointerdown', onModelPointerDown, { capture: true });
      viewer.domElement.removeEventListener('pointermove', onModelPointerMove, { capture: true });
      viewer.domElement.removeEventListener('pointerup', onModelPointerUp, { capture: true });
      clearTimeout(bmFallbackTimer);
      experience?.dispose();
      picker?.disable();
      setHover(false);
      disposeMinimap();
      measure?.dispose();
      measure = null;
      annotationTool?.dispose();
      annotationTool = null;
      layerManager.disposeAll();
      rig?.dispose();
      rig = null;
      viewer.dispose();
      ui.destroy();
      listeners.clear();
    },
  };

  return api;
}

export { pickFolder, fromDropEvent };
