import { describe, it, expect } from 'vitest';
import { LocalFilesPlugin, normalizePath } from './LocalFilesPlugin.js';
import { resolveSource, findEntry } from './sources.js';

const BASE = 'http://local-files.invalid/1/';
const file = (text) => new File([text], 'x');

describe('normalizePath', () => {
  it('역슬래시와 앞의 ./ , / 를 정리한다', () => {
    expect(normalizePath('.\\tiles\\0\\a.glb')).toBe('tiles/0/a.glb');
    expect(normalizePath('/tiles/a.glb')).toBe('tiles/a.glb');
    expect(normalizePath('./././a.json')).toBe('a.json');
  });
});

describe('LocalFilesPlugin.fetchData', () => {
  const plugin = new LocalFilesPlugin({
    baseUrl: BASE,
    files: new Map([
      ['tileset.json', file('{"a":1}')],
      ['tiles\\0\\Sub.glb', file('GLB')], // Windows 경로 + 대소문자
      ['한글 폴더/a b.glb', file('KR')],
    ]),
  });

  it('가짜 주소의 파일을 Response로 돌려준다', async () => {
    const res = await plugin.fetchData(BASE + 'tileset.json');
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ a: 1 });
  });

  it('대소문자·역슬래시 차이를 흡수한다', async () => {
    const res = await plugin.fetchData(BASE + 'tiles/0/sub.glb');
    expect(res.ok).toBe(true);
    expect(await res.text()).toBe('GLB');
  });

  it('퍼센트 인코딩된 경로를 풀어서 찾는다', async () => {
    const res = await plugin.fetchData(BASE + encodeURI('한글 폴더/a b.glb'));
    expect(res.ok).toBe(true);
    expect(await res.text()).toBe('KR');
  });

  it('쿼리/해시는 무시한다', async () => {
    const res = await plugin.fetchData(BASE + 'tileset.json?v=2#x');
    expect(res.ok).toBe(true);
  });

  it('폴더에 없으면 404 Response (사유 포함)', async () => {
    const res = await plugin.fetchData(BASE + 'missing.glb');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(res.statusText).toMatch(/missing\.glb/);
  });

  it('한글 경로의 파일이 없어도 예외 없이 404 (statusText는 ASCII만 허용)', async () => {
    const res = await plugin.fetchData(BASE + encodeURI('없는폴더/없는파일.glb'));
    expect(res.status).toBe(404);
    expect(decodeURI(res.statusText)).toMatch(/없는파일\.glb/);
  });

  it('가짜 주소가 아니면 처리하지 않는다 (undefined -> 기본 fetch)', () => {
    expect(plugin.fetchData('https://example.com/a.glb')).toBeUndefined();
  });
});

describe('resolveSource (url)', () => {
  it('상대 주소도 절대 주소로 바꿔 둔다 (자식 URI 해석용)', () => {
    const src = resolveSource({ kind: 'url', url: '/tiles-real/tileset.json' });
    expect(src.rootUrl).toMatch(/^https?:\/\/.+\/tiles-real\/tileset\.json$/);
    expect(new URL('tiles/0/a.glb', src.rootUrl).pathname).toBe('/tiles-real/tiles/0/a.glb');
    expect(src.name).toBe('tiles-real');
  });
});

describe('resolveSource (files)', () => {
  it('tileset.json이 하위 폴더에 있어도 가장 얕은 것을 찾는다', () => {
    const files = new Map([
      ['data/site/tileset.json', file('{}')],
      ['data/site/deep/tileset.json', file('{}')],
      ['readme.txt', file('x')],
    ]);
    expect(findEntry(files)).toBe('data/site/tileset.json');
    const src = resolveSource({ kind: 'files', files });
    expect(src.entry).toBe('data/site/tileset.json');
    expect(src.rootUrl.endsWith('/data/site/tileset.json')).toBe(true);
  });

  it('tileset.json이 없으면 안내 메시지와 함께 예외', () => {
    expect(() => resolveSource({ kind: 'files', files: new Map([['a.txt', file('x')]]) })).toThrow(/tileset\.json/);
  });

  it('readJson/readRange가 폴더 파일을 읽는다', async () => {
    const files = new Map([['tileset.json', file('{"root":{}}')], ['a.bin', new File([new Uint8Array([1, 2, 3, 4, 5])], 'a.bin')]]);
    const src = resolveSource({ kind: 'files', files });
    expect(await src.readJson(src.rootUrl)).toEqual({ root: {} });
    const buf = await src.readRange(src.rootUrl.replace('tileset.json', 'a.bin'), 1, 3);
    expect([...new Uint8Array(buf)]).toEqual([2, 3, 4]);
  });
});
