import * as THREE from 'three';
import { computeMinimapProjection } from './Minimap.js';

// 미니맵 용도로는 실시간이되 "부드럽게 살짝 지연"이면 충분하다 -- 매 프레임 렌더+픽셀
// 읽기(readRenderTargetPixels는 GPU->CPU 동기화라 특히 비용이 있다)를 피하려고 쓰로틀한다.
const THROTTLE_SECONDS = 0.25; // 초당 4번

/**
 * 미니맵 배경으로 쓸 "위에서 내려다본" 타일 스냅샷을 실시간으로 렌더링한다.
 * (2026-08-19, "미니맵에 실제 타일도 보이면 좋겠다"는 요청에 대한 3가지 방안 중
 * 옵션 1을 선택: 실시간 탑다운 렌더. 옵션 3(배경 래스터/WMS를 그대로 그리기)은 그
 * 데이터가 아직 없어서 보류 -- 아래 "스왑 지점" 참고.)
 *
 * 직교(orthographic) 카메라를 데이터 범위 위에 두고 씬을 작은 렌더타겟에 찍은 뒤,
 * CPU로 읽어(readRenderTargetPixels) 평범한 2D <canvas>에 그려 넣는다. Minimap.js는
 * 이 <canvas>를 배경 이미지처럼 drawImage()만 하면 되므로 "배경이 무엇으로 만들어지는지"를
 * 전혀 몰라도 된다.
 *
 * ## 옵션 3으로 바꿀 여지(스왑 지점)
 * 나중에 배경 래스터(WMS/항공사진 등) 레이어가 생기면, 이 모듈 대신 그 타일 이미지를
 * 같은 크기의 <canvas>에 그려 넣는 다른 provider로 통째로 교체하면 된다 -- Minimap.js는
 * `background.canvas`만 알면 되니 손댈 필요가 없고, main.js도 이 파일을 생성하는
 * 한 줄(`createMinimapTileRenderer(...)` -> `createMinimapRasterBackground(...)` 같은)만
 * 바꾸면 된다. 두 provider가 지켜야 할 인터페이스는 `{ canvas, update(bounds, dt), dispose() }`.
 *
 * ## 비용 트레이드오프(중요, 호출하는 쪽도 알고 있어야 함)
 * 3d-tiles-renderer는 등록된 모든 카메라의 요구사항을 합쳐 로드할 타일을 정한다
 * (Tiles3DLayer.registerAuxCamera 참고). 이 카메라를 등록하는 순간부터, 메인 카메라가
 * 지금 안 보고 있는 먼 구역의 타일도 (낮은 해상도로) 미리 받아오기 시작한다. 렌더타겟이
 * 작아 요구 해상도가 낮으므로 저LOD로 충분하지만, 공짜는 아니다.
 */
export function createMinimapTileRenderer({ viewer, layerManager, size }) {
  const renderTarget = new THREE.WebGLRenderTarget(size, size);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  // 정확히 수직으로 내려다보게 X축으로 -90도 회전시킨다. 이렇게 하면 카메라의 로컬
  // +Y(화면 위쪽)가 월드 -Z(crs.js 규칙상 북쪽)를 향하고, 로컬 +X(화면 오른쪽)는
  // 월드 +X 그대로 유지된다 -- Minimap.js의 toMinimapXY()가 가정하는 좌표 방향
  // (x는 안 뒤집고, z가 클수록 캔버스 아래쪽)과 정확히 맞아떨어진다.
  camera.rotation.set(-Math.PI / 2, 0, 0);

  // "이 레이어가 카메라 기반 LOD를 지원하나?"를 매번 검사하지 않아도 되도록
  // LayerBase에 기본 no-op을 만들어뒀다 -- 여기서는 그냥 전부에 호출한다.
  // 실제 등록은 update()에서 매 프레임 하므로(아래 주석 참고) 여기서는 목록만 잡아둔다.
  const layers = layerManager.getAll();

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // readRenderTargetPixels가 쓸 버퍼와, putImageData가 쓸 ImageData가 같은
  // ArrayBuffer를 공유하게 해서(Uint8Array/Uint8ClampedArray는 같은 바이트 레이아웃)
  // 매 프레임 복사를 한 번 더 하지 않아도 되게 한다.
  const pixels = new Uint8Array(size * size * 4);
  const imageData = new ImageData(new Uint8ClampedArray(pixels.buffer), size, size);

  let sinceLastRender = Infinity; // 첫 update()에서 바로 한 번 렌더되도록 크게 시작

  return {
    canvas,

    /**
     * @param {THREE.Box3} bounds 지금까지 로드된 데이터의 전체 범위(main.js의 lastKnownBounds)
     * @param {number} dt 초 단위 프레임 델타
     */
    update(bounds, dt) {
      if (bounds.isEmpty()) return;

      // Tiles3DLayer.update()가 메인 카메라 해상도를 매 프레임 다시 지정하는 것과 같은
      // 이유로, 우리 카메라도 매 프레임 다시 등록한다(registerAuxCamera는 멱등적).
      // 그렇지 않으면: 처음 생성될 때 렌더러 캔버스가 아직 레이아웃되기 전이라 크기가
      // 0일 수 있고("resolution for camera error calculation is not set" 경고의 원인),
      // 나중에 창 크기가 바뀌어도 반영이 안 돼 화면 공간 오차 계산이 오래된 값으로 굳는다.
      for (const layer of layers) {
        layer.registerAuxCamera(camera, viewer.renderer);
      }

      // Minimap.js가 사각형/점/화살표를 그릴 때 쓰는 것과 정확히 같은 계산(중심,
      // 스케일)을 그대로 가져다 쓴다 -- 배경 이미지와 오버레이가 어긋나지 않게 하는
      // 핵심이다. 정사각 렌더타겟에 맞춰 절두체도 정사각으로(가로/세로 같은 스케일).
      const proj = computeMinimapProjection(bounds, size);
      const halfExtent = size / 2 / proj.scale;
      const boundsSize = bounds.getSize(new THREE.Vector3());
      const halfY = Math.max(boundsSize.y, 1) / 2 + 50; // 위/아래 여유(카메라가 절두체 안에 다 담기게)

      camera.left = -halfExtent;
      camera.right = halfExtent;
      camera.top = halfExtent;
      camera.bottom = -halfExtent;
      camera.near = 0.1;
      camera.far = halfY * 2 + 100;
      camera.position.set(proj.centerX, bounds.max.y + halfY + 10, proj.centerZ);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();

      sinceLastRender += dt;
      if (sinceLastRender < THROTTLE_SECONDS) return;
      sinceLastRender = 0;

      const renderer = viewer.renderer;
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(renderTarget);
      renderer.render(viewer.scene, camera);
      renderer.readRenderTargetPixels(renderTarget, 0, 0, size, size, pixels);
      renderer.setRenderTarget(prevTarget);

      // WebGL 렌더타겟은 원점이 좌하단이라(readPixels 관례) 위/아래가 이미지 좌표계와
      // 뒤집혀 있다 -- putImageData 전에 행 순서를 뒤집어야 화면과 같은 방향이 된다.
      flipRowsVertically(pixels, size);
      ctx.putImageData(imageData, 0, 0);
    },

    dispose() {
      for (const layer of layers) {
        layer.unregisterAuxCamera(camera);
      }
      renderTarget.dispose();
    },
  };
}

/** @param {Uint8Array} pixels RGBA, size*size*4 길이 @param {number} size */
function flipRowsVertically(pixels, size) {
  const rowBytes = size * 4;
  const tmpRow = new Uint8Array(rowBytes);
  for (let y = 0; y < size / 2; y++) {
    const top = y * rowBytes;
    const bottom = (size - 1 - y) * rowBytes;
    tmpRow.set(pixels.subarray(top, top + rowBytes));
    pixels.copyWithin(top, bottom, bottom + rowBytes);
    pixels.set(tmpRow, bottom);
  }
}
