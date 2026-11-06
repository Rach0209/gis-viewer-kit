import { describe, expect, it } from 'vitest';
import { getBackendTileset, listBackendTilesets, pickProfile, resolveEntry } from './backend.js';

const json = (body, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body });

describe('resolveEntry', () => {
  it('서버 루트 기준 경로를 절대 주소로 만든다', () => {
    expect(resolveEntry('http://h:8080', '/tiles/a/tileset.json')).toBe('http://h:8080/tiles/a/tileset.json');
    expect(resolveEntry('http://h:8080/', 'tiles/a/tileset.json')).toBe('http://h:8080/tiles/a/tileset.json');
  });
  it('apiUrl에 경로 접두사가 있어도 유지한다', () => {
    expect(resolveEntry('https://h/app/', '/tiles/a/tileset.json')).toBe('https://h/app/tiles/a/tileset.json');
  });
  it('절대 URL(CDN 등)은 그대로 쓴다', () => {
    expect(resolveEntry('http://h:8080', 'https://cdn.example/x/tileset.json')).toBe('https://cdn.example/x/tileset.json');
  });
  it('apiUrl이 없으면 오류', () => {
    expect(() => resolveEntry('', '/x')).toThrow(/apiUrl/);
  });
});

describe('pickProfile', () => {
  it('뷰어가 아는 항목만 통과시킨다', () => {
    expect(pickProfile({ mode: 'geo', errorTarget: 32, enableFade: false, junk: 1, origin: { lon: 1, lat: 2 } })).toEqual({
      mode: 'geo', errorTarget: 32, enableFade: false, origin: { lon: 1, lat: 2 },
    });
  });
  it('알 수 없는 mode와 null은 버린다', () => {
    expect(pickProfile({ mode: 'weird', errorTarget: null })).toEqual({});
    expect(pickProfile(undefined)).toEqual({});
  });
});

describe('listBackendTilesets / getBackendTileset', () => {
  const item = {
    id: 'site-a', name: '현장 A', description: 'd', entry: '/tiles/site-a/tileset.json',
    profile: { mode: 'geo' }, sizeBytes: 10, updatedAt: '2026-01-01T00:00:00Z',
  };

  it('목록을 절대 주소로 정규화한다', async () => {
    const calls = [];
    const list = await listBackendTilesets('http://h:8080/', (url) => { calls.push(url); return json([item]); });
    expect(calls).toEqual(['http://h:8080/api/tilesets']);
    expect(list).toEqual([{
      id: 'site-a', name: '현장 A', description: 'd', url: 'http://h:8080/tiles/site-a/tileset.json',
      profile: { mode: 'geo' }, sizeBytes: 10, updatedAt: '2026-01-01T00:00:00Z',
    }]);
  });

  it('단건 조회는 id를 인코딩한다', async () => {
    const calls = [];
    await getBackendTileset('http://h', 'a b', (url) => { calls.push(url); return json(item); });
    expect(calls).toEqual(['http://h/api/tilesets/a%20b']);
  });

  it('problem+json의 detail을 오류 메시지에 담는다', async () => {
    await expect(getBackendTileset('http://h', 'x', () => json({ detail: "tileset 'x' not found" }, 404)))
      .rejects.toThrow(/404.*not found/);
  });

  it('연결 실패를 알아보기 쉬운 메시지로 바꾼다', async () => {
    await expect(listBackendTilesets('http://h', () => Promise.reject(new TypeError('Failed to fetch'))))
      .rejects.toThrow(/연결하지 못했습니다/);
  });

  it('배열이 아니면 오류', async () => {
    await expect(listBackendTilesets('http://h', () => json({ a: 1 }))).rejects.toThrow(/배열/);
  });
});
