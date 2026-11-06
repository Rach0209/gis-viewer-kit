export const SIZE = 150;

/**
 * bounds(데이터 전체 범위)를 SIZE x SIZE 정사각 캔버스에 맞추는 투영 계수.
 * toMinimapXY()뿐 아니라 MinimapTileRenderer.js(실시간 탑다운 배경 렌더)의 직교
 * 카메라 절두체 크기도 반드시 이 값과 정확히 같은 식으로 계산해야 한다 -- 그래야
 * 배경 이미지와 이 위에 그리는 사각형/점/화살표가 어긋나지 않는다. 그래서 여기서만
 * 계산하고 export해서 공유한다(각자 따로 계산하면 나중에 값이 갈릴 위험이 있다).
 * @param {import('three').Box3} bounds
 * @param {number} size
 */
export function computeMinimapProjection(bounds, size) {
  const sizeX = Math.max(bounds.max.x - bounds.min.x, 1);
  const sizeZ = Math.max(bounds.max.z - bounds.min.z, 1);
  return {
    centerX: (bounds.min.x + bounds.max.x) / 2,
    centerZ: (bounds.min.z + bounds.max.z) / 2,
    scale: Math.min(size / sizeX, size / sizeZ) * 0.85, // 85%로 가장자리 여백
  };
}

/**
 * 우측 하단(SharePanel 위)에 데이터 전체 범위 대비 지금 카메라 위치/방향을 보여주는
 * 위에서 내려다본 2D 미니맵.
 *
 * 기본은 사각형(데이터 범위) + 점(POI) + 화살표(카메라 위치/heading)만 그리는 가벼운
 * 2D canvas 오버레이다. 여기에 더해 실제 타일이 보이길 원하면(2026-08-19 요청) 배경
 * 이미지를 만들어주는 provider를 `background`로 넘길 수 있다 -- 지금은
 * MinimapTileRenderer.js(실시간 탑다운 렌더)를 쓰지만, 나중에 배경 래스터(WMS 등)
 * provider로 통째로 바꿔도 이 파일은 손댈 필요 없다(아래 update() 참고).
 * @param {{ background?: { canvas: HTMLCanvasElement }, parent?: HTMLElement }} [options]
 *   inline: true면 위치를 직접 정하지 않고(position:relative) parent 안의 흐름에 놓인다 -- 우측 하단에 나침반·안내문과 세로로 쌓을 때(kit).
 *   parent: 주면 document.body 대신 이 요소 안(position:absolute)에 붙는다 -- 임베드된
 *   뷰어(kit)가 자기 컨테이너 밖으로 UI를 흘리지 않게 하기 위함. 생략하면 기존 동작(body, fixed).
 */
export function createMinimap({ background, parent, inline = false } = {}) {
  const container = document.createElement('div');
  container.className = 'minimap';
  const placement = inline
    ? { position: 'relative', flex: 'none' }
    : {
        position: parent ? 'absolute' : 'fixed',
        // SharePanel(체크박스+버튼 두 줄, bottom:12px)이 세로로 약 66px를 차지하므로
        // 그 위에 여유를 두고 띄운다 (52px로는 겹쳤음). parent(kit) 안에서는 하단 안내문 위.
        bottom: parent ? '40px' : '96px',
        right: '12px',
        zIndex: parent ? '6' : '20',
      };
  Object.assign(container.style, placement, {
    width: `${SIZE}px`,
    height: `${SIZE}px`,
    borderRadius: '4px',
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.3)',
    background: 'rgba(20,22,26,0.85)',
  });

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  container.appendChild(canvas);
  (parent ?? document.body).appendChild(container);
  const ctx = canvas.getContext('2d');

  /** @param {number} x @param {number} z @param {{centerX:number, centerZ:number, scale:number}} proj */
  function toMinimapXY(x, z, proj) {
    return {
      // three.js z는 남쪽이 +라서, 화면 아래로 갈수록 z가 커지는 미니맵(y 아래로 증가)과
      // 방향이 이미 맞는다 -- 뒤집을 필요가 없다.
      x: SIZE / 2 + (x - proj.centerX) * proj.scale,
      y: SIZE / 2 + (z - proj.centerZ) * proj.scale,
    };
  }

  return {
    element: container,
    /** DOM에서 제거한다 (타일셋을 바꾸거나 뷰어를 dispose할 때). */
    dispose() {
      container.remove();
    },
    /**
     * @param {{
     *   bounds: import('three').Box3,
     *   cameraPosition: {x:number, z:number},
     *   headingRad: number,
     *   pois?: Array<{x:number, z:number}>,
     * }} state
     */
    update({ bounds, cameraPosition, headingRad, pois = [] }) {
      ctx.clearRect(0, 0, SIZE, SIZE);
      if (bounds.isEmpty()) return;

      // 배경(실시간 탑다운 타일 렌더 등)이 있으면 그 위에 사각형/점/화살표를 얹는다.
      // 배경이 없으면(옵션 미전달) 예전처럼 빈 배경에 도형만 그려서 항상 동작한다.
      if (background) {
        ctx.drawImage(background.canvas, 0, 0, SIZE, SIZE);
      }

      const proj = computeMinimapProjection(bounds, SIZE);

      // 데이터 범위 사각형
      const topLeft = toMinimapXY(bounds.min.x, bounds.min.z, proj);
      const bottomRight = toMinimapXY(bounds.max.x, bounds.max.z, proj);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);

      // POI 점
      ctx.fillStyle = '#ffaa00';
      for (const poi of pois) {
        const p = toMinimapXY(poi.x, poi.z, proj);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // 카메라 위치 + heading 화살표(위쪽=북쪽 기준, headingRad만큼 회전)
      const camPoint = toMinimapXY(cameraPosition.x, cameraPosition.z, proj);
      ctx.save();
      ctx.translate(camPoint.x, camPoint.y);
      ctx.rotate(headingRad);
      ctx.fillStyle = '#3aa0ff';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 5);
      ctx.lineTo(-4, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  };
}
