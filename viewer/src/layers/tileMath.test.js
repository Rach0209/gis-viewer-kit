import { describe, it, expect } from 'vitest';
import {
  lonToTileX,
  latToTileY,
  tileXToLon,
  tileYToLat,
  computeTileRange,
  enumerateTiles,
} from './tileMath.js';

describe('lonToTileX / latToTileY', () => {
  it('maps the (0,0) lon/lat origin to the center-ish tile at a given zoom', () => {
    // 잘 알려진 기준점: zoom=1에서 지도는 2x2 타일로 나뉘고, 경도/위도 0은
    // 그 경계 바로 다음 타일인 (1,1)에 속한다. 직접 계산해 검증할 수 있는
    // 몇 안 되는 "손으로 풀 수 있는" 값이라 회귀 방지용으로 고정해둔다.
    expect(lonToTileX(0, 1)).toBe(1);
    expect(latToTileY(0, 1)).toBe(1);
  });

  it('places the west edge of the world at tile x=0', () => {
    expect(lonToTileX(-180, 3)).toBe(0);
  });

  it('increases tile x as longitude increases (west -> east)', () => {
    const west = lonToTileX(-10, 10);
    const east = lonToTileX(10, 10);
    expect(east).toBeGreaterThan(west);
  });

  it('decreases tile y as latitude increases (south -> north) -- the sign flip that is easy to get backwards', () => {
    const south = latToTileY(-10, 10);
    const north = latToTileY(10, 10);
    expect(north).toBeLessThan(south);
  });
});

describe('tileXToLon / tileYToLat (inverse of lonToTileX / latToTileY)', () => {
  it('round-trips: converting a tile edge to lon/lat and back gives the same tile index', () => {
    // tileXToLon(x)은 타일의 서쪽 "경계"를 주므로, 경계에서 아주 살짝 동쪽으로 들어간
    // 지점을 lonToTileX에 넣어야 부동소수점 오차로 경계에 걸려 옆 타일로 새지 않는다.
    const zoom = 12;
    for (const x of [0, 5, 100, 2 ** zoom - 1]) {
      const lon = tileXToLon(x, zoom);
      expect(lonToTileX(lon + 1e-9, zoom)).toBe(x);
    }
    for (const y of [0, 5, 100, 2 ** zoom - 1]) {
      const lat = tileYToLat(y, zoom);
      expect(latToTileY(lat - 1e-9, zoom)).toBe(y);
    }
  });

  it('produces a decreasing lat as the tile y index increases (south -> north sign flip, mirrored from latToTileY)', () => {
    const north = tileYToLat(0, 5);
    const south = tileYToLat(10, 5);
    expect(north).toBeGreaterThan(south);
  });
});

describe('computeTileRange', () => {
  it('returns a single tile range for a bbox that stays within one tile at low zoom', () => {
    // west/east 1도 차이가 zoom=1의 타일 경계(경도 0, 위도 0)를 넘지 않도록
    // 원점에서 떨어진 bbox를 사용한다 (경계를 걸치면 xMin/xMax가 달라짐).
    const range = computeTileRange({ west: 100, south: 30, east: 101, north: 31 }, 1);
    expect(range).toEqual({ zoom: 1, xMin: 1, xMax: 1, yMin: 0, yMax: 0 });
  });

  it('keeps xMin <= xMax and yMin <= yMax for a well-formed bbox', () => {
    const range = computeTileRange(
      { west: 126.975, south: 37.564, east: 126.985, north: 37.572 },
      15
    );
    expect(range.xMin).toBeLessThanOrEqual(range.xMax);
    expect(range.yMin).toBeLessThanOrEqual(range.yMax);
  });
});

describe('enumerateTiles', () => {
  it('expands a range into every {z,x,y} combination', () => {
    const tiles = enumerateTiles({ zoom: 5, xMin: 1, xMax: 2, yMin: 9, yMax: 10 });
    expect(tiles).toHaveLength(4);
    expect(tiles).toEqual(
      expect.arrayContaining([
        { z: 5, x: 1, y: 9 },
        { z: 5, x: 1, y: 10 },
        { z: 5, x: 2, y: 9 },
        { z: 5, x: 2, y: 10 },
      ])
    );
  });

  it('handles a single-tile range', () => {
    const tiles = enumerateTiles({ zoom: 0, xMin: 0, xMax: 0, yMin: 0, yMax: 0 });
    expect(tiles).toEqual([{ z: 0, x: 0, y: 0 }]);
  });
});
