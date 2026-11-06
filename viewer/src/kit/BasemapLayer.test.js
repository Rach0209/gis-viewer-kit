import { describe, expect, it, vi } from 'vitest';
import { BasemapLayer } from './BasemapLayer.js';
import { createGeodeticToLocal } from './geoMath.js';
import { tileUrl } from './rasterProviders.js';
import { lonToTileX, latToTileY, tileXToLon, tileYToLat } from '../layers/tileMath.js';

const ORIGIN = { lon: 126.978, lat: 37.5665, alt: 0 };
const PROVIDER = { urlTemplate: 'https://t.example/{z}/{x}/{y}.png', maxZoom: 19, attribution: '© test' };
const BBOX = { west: 126.937, east: 127.023, south: 37.54, north: 37.592 };

function fakeLoader() {
  const calls = [];
  return { calls, load: (url, ok, _p, err) => calls.push({ url, ok, err }) };
}

function build(opts = {}) {
  const loader = fakeLoader();
  const layer = new BasemapLayer({ id: 'b', provider: PROVIDER, bbox: BBOX, origin: ORIGIN, textureLoader: loader, probeImage: () => ({ alpha: 1, luma: 200 }), retries: 0, ...opts });
  layer.onAdd();
  return { layer, loader };
}

describe('BasemapLayer', () => {
  it('영역을 덮는 타일을 한도 안에서 만들고 각각 주소를 요청한다', () => {
    const { layer, loader } = build({ maxTiles: 64 });
    expect(layer.getStats().total).toBe(layer.object3d.children.length);
    expect(layer.object3d.children.length).toBeLessThanOrEqual(64);
    expect(loader.calls.length).toBe(layer.object3d.children.length);
    for (const c of loader.calls) expect(c.url).toMatch(/^https:\/\/t\.example\/\d+\/\d+\/\d+\.png$/);
  });

  it('타일 모서리가 3D Tiles와 같은 변환으로 놓인다 (꼭짓점 = 위경도 -> 로컬)', () => {
    const { layer } = build({ grid: 4, height: 0 });
    const toLocal = createGeodeticToLocal(ORIGIN);
    const mesh = layer.object3d.children[0];
    const { x, y, z } = mesh.userData.tile;
    const pos = mesh.geometry.getAttribute('position');
    // 첫 꼭짓점 = 북서쪽 모서리, 마지막 꼭짓점 = 남동쪽 모서리
    const nw = toLocal(tileXToLon(x, z), tileYToLat(y, z), 0);
    const last = pos.count - 1;
    const se = toLocal(tileXToLon(x + 1, z), tileYToLat(y + 1, z), 0);
    expect(pos.getX(0)).toBeCloseTo(nw.x, 2);
    expect(pos.getY(0)).toBeCloseTo(nw.y, 2);
    expect(pos.getZ(0)).toBeCloseTo(nw.z, 2);
    expect(pos.getX(last)).toBeCloseTo(se.x, 2);
    expect(pos.getZ(last)).toBeCloseTo(se.z, 2);
  });

  it('북쪽이 -z, 동쪽이 +x 이며 이미지 위쪽이 북쪽이다', () => {
    const { layer } = build({ grid: 2 });
    const g = layer.object3d.children[0].geometry;
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    expect(pos.getX(2)).toBeGreaterThan(pos.getX(0)); // 같은 행에서 오른쪽(i 증가) = 동쪽
    expect(pos.getZ(6)).toBeGreaterThan(pos.getZ(0)); // 아래 행(j 증가) = 남쪽 = +z
    expect(uv.getY(0)).toBe(1); // 북쪽 가장자리 = 이미지 위
    expect(uv.getY(6)).toBe(0);
  });

  it('이 좌표 위경도에 해당하는 타일이 영역 중심 근처에 있다', () => {
    const { layer } = build();
    const cx = lonToTileX((BBOX.west + BBOX.east) / 2, layer.zoom);
    const cy = latToTileY((BBOX.south + BBOX.north) / 2, layer.zoom);
    const tiles = layer.object3d.children.map((m) => m.userData.tile);
    expect(tiles.some((t) => t.x === cx && t.y === cy)).toBe(true);
  });

  it('높이 조정은 레이어 전체를 위아래로 옮긴다', () => {
    const { layer } = build({ height: 12 });
    expect(layer.getHeight()).toBe(12);
    layer.setHeight(-30);
    expect(layer.object3d.position.y).toBe(-30);
  });

  it('텍스처가 오면 입히고, 실패하면 표시하고 집계한다', () => {
    const { layer, loader } = build({ maxTiles: 4 });
    const fakeTexture = { dispose() {} };
    loader.calls[0].ok(fakeTexture);
    loader.calls[1].err(new Error('404'));
    expect(layer.getStats().loaded).toBe(1);
    expect(layer.getStats().failed).toBe(1);
    expect(layer.object3d.children[0].material.map).toBe(fakeTexture);
    expect(layer.object3d.children[1].material.color.getHex()).toBe(0xd9a3a3);
  });

  it('제거된 뒤에 도착한 텍스처는 버린다', () => {
    const { layer, loader } = build({ maxTiles: 4 });
    let disposed = false;
    layer.dispose();
    loader.calls[0].ok({ dispose: () => (disposed = true) });
    expect(disposed).toBe(true);
    expect(layer.getStats().loaded).toBe(0);
  });

  it('타일 주소 순서를 공급자 템플릿대로 만든다', () => {
    const { loader } = build({ provider: { ...PROVIDER, urlTemplate: 'https://v/{z}/{y}/{x}.png' }, maxTiles: 1 });
    expect(loader.calls[0].url).toMatch(/^https:\/\/v\/\d+\/\d+\/\d+\.png$/);
    expect(tileUrl('https://v/{z}/{y}/{x}.png', { z: 1, x: 2, y: 3 })).toBe('https://v/1/3/2.png');
  });

  it('받았지만 투명한 이미지는 입히지 않고(까맣게 그려지므로) 눈에 띄는 색으로 표시하고 이유를 남긴다', () => {
    let disposed = false;
    const { layer, loader } = build({ maxTiles: 4, probeImage: () => ({ alpha: 0, luma: 0 }) });
    loader.calls[0].ok({ dispose: () => (disposed = true), image: {} });
    expect(layer.object3d.children[0].material.map).toBeNull();
    expect(layer.object3d.children[0].material.color.getHex()).toBe(0xd9a3a3);
    expect(disposed).toBe(true);
    const s = layer.getStats();
    expect(s.blank).toBe(1);
    expect(s.loaded).toBe(0);
    expect(s.firstError.reason).toMatch(/투명/);
    expect(s.firstError.url).toMatch(/^https:\/\/t\.example\//);
  });

  it('검사할 수 없는 이미지(null)는 정상으로 본다', () => {
    const { layer, loader } = build({ maxTiles: 4, probeImage: () => null });
    loader.calls[0].ok({ dispose() {}, image: {} });
    expect(layer.getStats().loaded).toBe(1);
    expect(layer.getStats().blank).toBe(0);
  });

  it('받기에 실패하면 한 번 다시 시도하고, 다시 실패해야 실패로 센다', () => {
    vi.useFakeTimers();
    try {
      const { layer, loader } = build({ maxTiles: 4, retries: 1, retryDelayMs: 100 });
      const before = loader.calls.length;
      loader.calls[0].err(new Error('x'));
      expect(layer.getStats()).toMatchObject({ failed: 0, retried: 1 });
      vi.advanceTimersByTime(150);
      expect(loader.calls.length).toBe(before + 1); // 같은 주소로 재요청
      expect(loader.calls[before].url).toBe(loader.calls[0].url);
      loader.calls[before].err(new Error('again'));
      const s = layer.getStats();
      expect(s.failed).toBe(1);
      expect(s.firstError.reason).toMatch(/받지 못함/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('재시도가 성공하면 정상 타일로 센다', () => {
    vi.useFakeTimers();
    try {
      const { layer, loader } = build({ maxTiles: 4, retries: 1, retryDelayMs: 100 });
      const before = loader.calls.length;
      loader.calls[0].err(new Error('x'));
      vi.advanceTimersByTime(150);
      loader.calls[before].ok({ dispose() {}, image: {} });
      expect(layer.getStats()).toMatchObject({ loaded: 1, failed: 0, retried: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('제거되면 대기 중인 재시도를 취소한다', () => {
    vi.useFakeTimers();
    try {
      const { layer, loader } = build({ maxTiles: 4, retries: 1, retryDelayMs: 100 });
      const before = loader.calls.length;
      loader.calls[0].err(new Error('x'));
      layer.dispose();
      vi.advanceTimersByTime(500);
      expect(loader.calls.length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
