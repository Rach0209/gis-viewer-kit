import { describe, expect, it } from 'vitest';
import { VIRTUAL_HOST, createVirtualFolders, findEntry, gunzipIfNeeded, normalizePath, readAs } from './virtualFiles.js';
import { gzipSync } from 'node:zlib';

const fakeFile = (text) => ({ text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer });

describe('normalizePath', () => {
  it('역슬래시·앞의 ./ 와 /·중복 슬래시를 정리한다', () => {
    expect(normalizePath('.' + String.fromCharCode(92) + 'tiles' + String.fromCharCode(92) + 'a.glb')).toBe('tiles/a.glb');
    expect(normalizePath('/tiles//a.glb')).toBe('tiles/a.glb');
    expect(normalizePath('./././a.json')).toBe('a.json');
  });
});

describe('findEntry', () => {
  it('tileset.json 중 가장 얕은 것을 고른다', () => {
    expect(findEntry(['a/b/tileset.json', 'tileset.json', 'x/tileset.json'])).toBe('tileset.json');
    expect(findEntry(['a/b/TILESET.JSON', 'a/other.json'])).toBe('a/b/TILESET.JSON');
  });
  it('없으면 undefined', () => {
    expect(findEntry(['a.glb'])).toBeUndefined();
  });
});

describe('createVirtualFolders', () => {
  const files = new Map([
    ['tileset.json', fakeFile('{"root":1}')],
    ['Tiles/한글 폴더/a b.glb', fakeFile('glb')],
  ]);

  it('등록하면 가짜 주소와 진입 주소를 준다', () => {
    const f = createVirtualFolders();
    const r = f.register(files);
    expect(r.entry).toBe('tileset.json');
    expect(r.entryUrl).toBe(`${VIRTUAL_HOST}1/tileset.json`);
    expect(r.urlFor('Tiles/한글 폴더/a b.glb')).toBe(`${VIRTUAL_HOST}1/Tiles/${encodeURIComponent('한글 폴더')}/${encodeURIComponent('a b.glb')}`);
  });

  it('가짜 주소를 파일로 되돌린다 (한글·공백, 쿼리·해시 무시)', async () => {
    const f = createVirtualFolders();
    const r = f.register(files);
    const hit = f.resolve(r.urlFor('Tiles/한글 폴더/a b.glb') + '?v=1#x');
    expect(await hit.file.text()).toBe('glb');
    expect((await readAs(f.resolve(r.entryUrl).file, 'json')).root).toBe(1);
  });

  it('대소문자만 다른 경로도 찾는다', () => {
    const f = createVirtualFolders();
    f.register(files);
    expect(f.resolve(`${VIRTUAL_HOST}1/TILESET.JSON`).file).toBeTruthy();
  });

  it('가짜 주소가 아니면 null, 가짜 주소인데 파일이 없으면 file:null', () => {
    const f = createVirtualFolders();
    f.register(files);
    expect(f.resolve('https://example.com/a.json')).toBeNull();
    expect(f.resolve(`${VIRTUAL_HOST}1/없음.json`)).toEqual({ file: null, rel: '없음.json' });
    expect(f.resolve(`${VIRTUAL_HOST}9/tileset.json`).file).toBeNull();
  });

  it('폴더마다 번호가 다르고 release 하면 더는 읽히지 않는다', () => {
    const f = createVirtualFolders();
    const a = f.register(files);
    const b = f.register(files);
    expect(a.id).not.toBe(b.id);
    f.release(a.id);
    expect(f.resolve(a.entryUrl).file).toBeNull();
    expect(f.resolve(b.entryUrl).file).toBeTruthy();
  });
});

describe('readAs', () => {
  it('요청 형식에 맞게 읽는다', async () => {
    const file = fakeFile('{"a":2}');
    expect(await readAs(file, 'text')).toBe('{"a":2}');
    expect((await readAs(file, 'json')).a).toBe(2);
    expect((await readAs(file, 'arraybuffer')).byteLength).toBe(7);
    expect(await readAs(file, 'blob')).toBeInstanceOf(Blob);
  });
});

describe('gzip 풀기', () => {
  const gz = (text) => new Blob([gzipSync(Buffer.from(text))]);
  it('gzip이면 풀고, 아니면 그대로 둔다', async () => {
    const buf = await gunzipIfNeeded(await gz('hello 지형').arrayBuffer());
    expect(new TextDecoder().decode(buf)).toBe('hello 지형');
    const plain = new TextEncoder().encode('plain').buffer;
    expect(await gunzipIfNeeded(plain)).toBe(plain);
  });
  it('readAs: gzip으로 압축된 json / text / arraybuffer', async () => {
    const f = gz('{"tiles":["{z}/{x}/{y}.terrain"]}');
    expect((await readAs(f, 'json')).tiles[0]).toBe('{z}/{x}/{y}.terrain');
    expect(await readAs(f, 'text')).toContain('terrain');
    expect((await readAs(f, 'arraybuffer')).byteLength).toBe('{"tiles":["{z}/{x}/{y}.terrain"]}'.length);
  });
  it('손상된 gzip은 분명한 오류', async () => {
    const bad = new Blob([new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3, 1, 2, 3, 4])]);
    await expect(readAs(bad, 'arraybuffer')).rejects.toThrow(/gzip/);
  });
  it('BOM이 있는 json도 읽는다', async () => {
    const f = new Blob([new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"a":1}')])]);
    expect((await readAs(f, 'json')).a).toBe(1);
  });
});
