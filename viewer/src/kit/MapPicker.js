import { TILE_SIZE, clampCenter, lonLatToWorld, visibleTiles, worldSize, worldToLonLat, zoomAround } from './mapMath.js';
import { tileUrl } from './rasterProviders.js';

/**
 * 위치를 지도에서 클릭해서 고르는 작은 지도 (웹 메르카토르 타일, 3D 화면과 무관한 일반 DOM 컴포넌트).
 *
 * 끌어서 이동 · 휠(커서 기준)·버튼·키보드로 확대/축소 · 클릭하면 핀을 꽂고 onPick 호출.
 * 타일은 <img>로 그린다 (CORS 불필요). 스타일(.tvk-map*)은 ui.js의 CSS가 가진다.
 *
 * @param {Object} o
 * @param {{urlTemplate:string, maxZoom?:number, attribution?:string}} o.provider
 * @param {{lon:number, lat:number}} o.center 처음 가운데
 * @param {number} [o.zoom=7]
 * @param {number} [o.minZoom=3]
 * @param {(p:{lon:number, lat:number}) => void} [o.onPick]
 * @param {{lon:number, lat:number}|null} [o.marker] 처음 핀
 */
export function createMapPicker({ provider, center, zoom = 7, minZoom = 3, onPick, marker = null }) {
  const maxZoom = provider.maxZoom ?? 19;
  const el = document.createElement('div');
  el.className = 'tvk-map';
  el.tabIndex = 0;
  el.setAttribute('role', 'application');
  el.setAttribute('aria-label', '위치 선택 지도: 끌어서 이동, 휠로 확대/축소, 클릭해서 위치 지정. 방향키로 이동, +/-로 확대/축소');

  const tilesEl = document.createElement('div');
  tilesEl.className = 'tvk-map-tiles';
  const pin = document.createElement('div');
  pin.className = 'tvk-map-pin';
  pin.hidden = true;
  const zoomBox = document.createElement('div');
  zoomBox.className = 'tvk-map-zoom';
  const plus = document.createElement('button');
  const minus = document.createElement('button');
  plus.type = minus.type = 'button';
  plus.textContent = '+';
  minus.textContent = '−';
  plus.setAttribute('aria-label', '확대');
  minus.setAttribute('aria-label', '축소');
  zoomBox.append(plus, minus);
  const hint = document.createElement('div');
  hint.className = 'tvk-map-hint';
  hint.textContent = '끌어서 이동 · 휠로 확대/축소 · 클릭해서 위치 지정';
  const attrib = document.createElement('div');
  attrib.className = 'tvk-map-attrib';
  attrib.textContent = provider.attribution ?? '';
  el.append(tilesEl, pin, zoomBox, hint, attrib);

  let z = Math.max(minZoom, Math.min(maxZoom, Math.round(zoom)));
  let c = lonLatToWorld(center.lon, center.lat, z);
  let markerLL = marker;
  /** @type {Map<string, HTMLImageElement>} */
  const imgs = new Map();
  let destroyed = false;

  const size = () => ({ w: el.clientWidth || 560, h: el.clientHeight || 280 });

  function placePin() {
    if (!markerLL) {
      pin.hidden = true;
      return;
    }
    const { w, h } = size();
    const m = lonLatToWorld(markerLL.lon, markerLL.lat, z);
    const ws = worldSize(z);
    // 지도가 가로로 반복되므로 가장 가까운 반복에 그린다
    let dx = m.x - c.x;
    dx = ((((dx + ws / 2) % ws) + ws) % ws) - ws / 2;
    pin.style.left = `${w / 2 + dx}px`;
    pin.style.top = `${h / 2 + (m.y - c.y)}px`;
    pin.hidden = false;
  }

  function render() {
    if (destroyed) return;
    const { w, h } = size();
    c = clampCenter(c, z, h);
    const want = visibleTiles(c, z, w, h);
    const keep = new Set();
    for (const t of want) {
      keep.add(t.key);
      let img = imgs.get(t.key);
      if (!img) {
        img = document.createElement('img');
        img.className = 'tvk-map-tile';
        img.alt = '';
        img.draggable = false;
        img.width = img.height = TILE_SIZE;
        img.addEventListener('error', () => {
          img.style.opacity = '0'; // 못 받은 타일(키 오류, 범위 밖 등)은 빈 칸으로
        });
        img.src = tileUrl(provider.urlTemplate, t);
        tilesEl.appendChild(img);
        imgs.set(t.key, img);
      }
      img.style.transform = `translate(${t.left}px, ${t.top}px)`;
    }
    for (const [key, img] of imgs) {
      if (!keep.has(key)) {
        img.remove();
        imgs.delete(key);
      }
    }
    placePin();
  }

  function setZoom(newZ, offset = { x: 0, y: 0 }) {
    newZ = Math.max(minZoom, Math.min(maxZoom, newZ));
    if (newZ === z) return;
    c = zoomAround(c, offset, z, newZ);
    z = newZ;
    // 줌이 바뀌면 이전 줌의 타일은 모두 버린다 (좌표계가 달라서 재사용 불가)
    for (const img of imgs.values()) img.remove();
    imgs.clear();
    render();
  }

  function lonLatAt(clientX, clientY) {
    const r = el.getBoundingClientRect();
    const { w, h } = size();
    return worldToLonLat(c.x + (clientX - r.left - w / 2), c.y + (clientY - r.top - h / 2), z);
  }

  // ---- 끌기 / 클릭 ----
  let drag = null;
  const onDown = (e) => {
    if (e.button !== 0 || e.target.closest('.tvk-map-zoom')) return;
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
    el.setPointerCapture?.(e.pointerId);
    el.focus();
  };
  const onMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    c = { x: c.x - dx, y: c.y - dy };
    el.classList.toggle('tvk-map-dragging', drag.moved > 4);
    render();
  };
  const onUp = (e) => {
    if (!drag) return;
    const wasClick = drag.moved < 5;
    drag = null;
    el.classList.remove('tvk-map-dragging');
    el.releasePointerCapture?.(e.pointerId);
    if (wasClick) {
      const ll = lonLatAt(e.clientX, e.clientY);
      markerLL = ll;
      placePin();
      onPick?.(ll);
    }
  };
  const onCancel = () => {
    drag = null;
    el.classList.remove('tvk-map-dragging');
  };

  // ---- 휠 (트랙패드의 잔 이벤트를 모아서 한 단계씩) ----
  let wheelAcc = 0;
  const onWheel = (e) => {
    e.preventDefault();
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) < 60) return;
    const dir = wheelAcc < 0 ? 1 : -1;
    wheelAcc = 0;
    const r = el.getBoundingClientRect();
    const { w, h } = size();
    setZoom(z + dir, { x: e.clientX - r.left - w / 2, y: e.clientY - r.top - h / 2 });
  };

  // ---- 키보드 ----
  const onKey = (e) => {
    const step = 80;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      c = { x: c.x + moves[e.key][0], y: c.y + moves[e.key][1] };
      render();
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setZoom(z + 1);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      setZoom(z - 1);
    }
  };

  plus.addEventListener('click', () => setZoom(z + 1));
  minus.addEventListener('click', () => setZoom(z - 1));
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('keydown', onKey);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => render()) : null;
  ro?.observe(el);
  render();

  return {
    element: el,
    /** 핀을 옮기거나(경위도) 지운다(null). 핀이 화면 밖이면 지도 가운데를 핀으로 옮긴다. */
    setMarker(ll, { recenter = true } = {}) {
      markerLL = ll;
      if (ll && recenter) {
        const { w, h } = size();
        const m = lonLatToWorld(ll.lon, ll.lat, z);
        const inside = Math.abs(m.x - c.x) < w / 2 - 20 && Math.abs(m.y - c.y) < h / 2 - 20;
        if (!inside) c = m;
      }
      render();
    },
    /** 가운데와 줌을 바꾼다 */
    setView(ll, newZoom) {
      if (newZoom != null && newZoom !== z) {
        z = Math.max(minZoom, Math.min(maxZoom, Math.round(newZoom)));
        for (const img of imgs.values()) img.remove();
        imgs.clear();
      }
      c = lonLatToWorld(ll.lon, ll.lat, z);
      render();
    },
    getView() {
      return { ...worldToLonLat(c.x, c.y, z), zoom: z };
    },
    getMarker() {
      return markerLL;
    },
    /** 화면에 붙인 뒤(크기를 알 수 있을 때) 다시 그리고 싶을 때 */
    refresh: render,
    destroy() {
      destroyed = true;
      ro?.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKey);
      for (const img of imgs.values()) img.remove();
      imgs.clear();
      el.remove();
    },
  };
}
