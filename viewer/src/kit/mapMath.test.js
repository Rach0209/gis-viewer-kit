import { describe, expect, it } from 'vitest';
import { clampCenter, lonLatToWorld, visibleTiles, worldSize, worldToLonLat, zoomAround } from './mapMath.js';
import { latToTileY, lonToTileX } from '../layers/tileMath.js';

describe('lonLatToWorld / worldToLonLat', () => {
  it('(0E, 0N)은 세계의 한가운데 (줌 0: 128,128 / 줌 1: 256,256)', () => {
    expect(lonLatToWorld(0, 0, 0)).toEqual({ x: 128, y: 128 });
    const p = lonLatToWorld(0, 0, 1);
    expect(p.x).toBeCloseTo(256, 9);
    expect(p.y).toBeCloseTo(256, 9);
  });

  it('왼쪽 끝 경도 -180은 x=0, 오른쪽 끝 180은 x=세계 크기', () => {
    expect(lonLatToWorld(-180, 0, 3).x).toBe(0);
    expect(lonLatToWorld(180, 0, 3).x).toBeCloseTo(worldSize(3), 6);
  });

  it('최대 위도(85.05)는 맨 위 y≈0', () => {
    expect(lonLatToWorld(0, 85.0511287798, 4).y).toBeCloseTo(0, 3);
  });

  it('위도가 한계를 넘어도 터지지 않는다', () => {
    expect(Number.isFinite(lonLatToWorld(0, 90, 5).y)).toBe(true);
  });

  it('경위도 -> 월드 -> 경위도 왕복 (여러 줌)', () => {
    for (const z of [3, 10, 15, 19]) {
      const w = lonLatToWorld(126.978, 37.5665, z);
      const g = worldToLonLat(w.x, w.y, z);
      expect(g.lon).toBeCloseTo(126.978, 8);
      expect(g.lat).toBeCloseTo(37.5665, 8);
    }
  });

  it('지도를 가로로 여러 바퀴 끌어도 경도는 -180~180으로 돌아온다', () => {
    const size = worldSize(5);
    const g = worldToLonLat(size * 2.5, size / 2, 5); // 두 바퀴 반
    expect(g.lon).toBeCloseTo(0, 6);
    // 왼쪽으로 지도 1/4 바퀴 더: 경도 -180 - 90 = -270 은 +90 과 같은 지점
    expect(worldToLonLat(-size * 0.25, size / 2, 5).lon).toBeCloseTo(90, 6);
  });

  it('타일 번호는 기존 tileMath와 일치한다 (같은 지도 규칙)', () => {
    const z = 15;
    const w = lonLatToWorld(126.978, 37.5665, z);
    expect(Math.floor(w.x / 256)).toBe(lonToTileX(126.978, z));
    expect(Math.floor(w.y / 256)).toBe(latToTileY(37.5665, z));
  });
});

describe('zoomAround', () => {
  it('커서 아래의 경위도는 줌을 바꿔도 같다', () => {
    const z = 12;
    const center = lonLatToWorld(126.98, 37.57, z);
    const offset = { x: 120, y: -70 }; // 커서가 화면 중심의 오른쪽 위
    const before = worldToLonLat(center.x + offset.x, center.y + offset.y, z);
    for (const newZ of [13, 14, 10, 8]) {
      const c2 = zoomAround(center, offset, z, newZ);
      const after = worldToLonLat(c2.x + offset.x, c2.y + offset.y, newZ);
      expect(after.lon).toBeCloseTo(before.lon, 7);
      expect(after.lat).toBeCloseTo(before.lat, 7);
    }
  });

  it('커서가 화면 중심이면 중심 경위도가 그대로다', () => {
    const center = lonLatToWorld(127, 37, 7);
    const c2 = zoomAround(center, { x: 0, y: 0 }, 7, 9);
    const g = worldToLonLat(c2.x, c2.y, 9);
    expect(g.lon).toBeCloseTo(127, 8);
    expect(g.lat).toBeCloseTo(37, 8);
  });
});

describe('visibleTiles', () => {
  it('뷰포트를 덮는 타일을 주고, 타일 위치(px)가 중심 기준으로 맞다', () => {
    const z = 10;
    const center = lonLatToWorld(126.98, 37.57, z);
    const tiles = visibleTiles(center, z, 600, 400);
    expect(tiles.length).toBeGreaterThanOrEqual(6);
    // 모든 타일 조각의 합이 뷰포트를 완전히 덮는다 (가장자리 확인)
    const lefts = tiles.map((t) => t.left);
    const tops = tiles.map((t) => t.top);
    expect(Math.min(...lefts)).toBeLessThanOrEqual(0);
    expect(Math.max(...lefts) + 256).toBeGreaterThanOrEqual(600);
    expect(Math.min(...tops)).toBeLessThanOrEqual(0);
    expect(Math.max(...tops) + 256).toBeGreaterThanOrEqual(400);
    // 뷰포트 중심 픽셀이 속한 타일이 중심 경위도의 타일과 같다
    const cx = lonToTileX(126.98, z);
    const cy = latToTileY(37.57, z);
    const hit = tiles.find((t) => t.left <= 300 && 300 < t.left + 256 && t.top <= 200 && 200 < t.top + 256);
    expect(hit.x).toBe(cx);
    expect(hit.y).toBe(cy);
  });

  it('세계 가장자리를 넘어가면 x를 감싸고 y는 범위 밖 타일을 만들지 않는다', () => {
    const z = 2; // 4x4 타일
    const center = { x: 4, y: 40 }; // 왼쪽 위 모서리 근처
    const tiles = visibleTiles(center, z, 600, 400);
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(4);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(4);
    }
    // 왼쪽으로 넘친 부분은 오른쪽 끝 타일(x=3)로 감싼다
    expect(tiles.some((t) => t.key.startsWith('2/-1/') && t.x === 3)).toBe(true);
  });

  it('같은 타일이 화면에 두 번 나와도 key는 달라 둘 다 그린다', () => {
    const tiles = visibleTiles({ x: 0, y: 128 }, 0, 600, 256); // 줌 0은 타일이 1장
    const keys = new Set(tiles.map((t) => t.key));
    expect(keys.size).toBe(tiles.length);
    expect(tiles.length).toBeGreaterThanOrEqual(2);
  });
});

describe('clampCenter', () => {
  it('세로로 세계 밖을 보지 않게 y를 제한한다', () => {
    const c = clampCenter({ x: 1000, y: -500 }, 5, 400);
    expect(c.y).toBe(200);
    expect(c.x).toBe(1000);
    expect(clampCenter({ x: 0, y: 99999 }, 5, 400).y).toBe(worldSize(5) - 200);
  });
});
