import { describe, expect, it } from 'vitest';
import { filesFromFileList, filesFromHandle, glbFromDropEvent } from './folderPicker.js';

/** 가짜 폴더 핸들: entries()가 비동기 이터레이터를 준다. getFile()이 동시에 몇 개 불렸는지 추적한다. */
function fakeDir(spec, tracker) {
  return {
    kind: 'directory',
    async *entries() {
      for (const [name, value] of Object.entries(spec)) {
        if (typeof value === 'object') yield [name, fakeDir(value, tracker)];
        else {
          yield [
            name,
            {
              kind: 'file',
              async getFile() {
                tracker.inflight++;
                tracker.maxInflight = Math.max(tracker.maxInflight, tracker.inflight);
                await new Promise((r) => setTimeout(r, 1));
                tracker.inflight--;
                return { name, content: value };
              },
            },
          ];
        }
      }
    },
  };
}

const newTracker = () => ({ inflight: 0, maxInflight: 0 });

describe('filesFromHandle', () => {
  it('하위 폴더까지 모든 파일을 상대 경로로 모은다', async () => {
    const dir = fakeDir({ 'tileset.json': 'a', tiles: { '0': { 'a.glb': 'b' }, 'b.glb': 'c' } }, newTracker());
    const out = await filesFromHandle(dir);
    expect([...out.keys()].sort()).toEqual(['tiles/0/a.glb', 'tiles/b.glb', 'tileset.json'].sort());
    expect(out.get('tiles/0/a.glb').content).toBe('b');
  });

  it('파일을 한 번에 여러 개 읽되 동시 읽기 수에 상한이 있다', async () => {
    const spec = {};
    for (let i = 0; i < 200; i++) spec[`f${i}.glb`] = String(i);
    const t = newTracker();
    const out = await filesFromHandle(fakeDir(spec, t));
    expect(out.size).toBe(200);
    expect(t.maxInflight).toBeGreaterThan(1); // 하나씩이 아니라 병렬
    expect(t.maxInflight).toBeLessThanOrEqual(32);
  });

  it('진행 콜백이 읽은 파일 수와 함께 불린다', async () => {
    const spec = { a: '1', b: '2', c: '3' };
    const counts = [];
    const out = await filesFromHandle(fakeDir(spec, newTracker()), '', new Map(), (n) => counts.push(n));
    expect(counts.length).toBe(3);
    expect(Math.max(...counts)).toBe(out.size);
  });

  it('파일 하나가 실패하면 전체가 실패한다 (조용히 빠뜨리지 않는다)', async () => {
    const bad = {
      kind: 'directory',
      async *entries() {
        yield ['x.glb', { kind: 'file', getFile: () => Promise.reject(new Error('권한 없음')) }];
      },
    };
    await expect(filesFromHandle(bad)).rejects.toThrow('권한 없음');
  });
});

describe('filesFromFileList', () => {
  it('선택한 폴더 이름을 떼고 상대 경로로 만든다', () => {
    const f = (p) => ({ webkitRelativePath: p, name: p.split('/').pop() });
    const { files, name } = filesFromFileList([f('site/tileset.json'), f('site/tiles/a.glb')]);
    expect(name).toBe('site');
    expect([...files.keys()]).toEqual(['tileset.json', 'tiles/a.glb']);
  });
});

describe('glbFromDropEvent', () => {
  const item = (file, isFile = true) => ({
    kind: 'file',
    webkitGetAsEntry: () => ({ isFile }),
    getAsFile: () => file,
  });
  const ev = (...items) => ({ dataTransfer: { items } });

  it('glb 파일 한 개를 놓으면 그 파일을 준다 (대소문자 무관)', () => {
    const f = { name: 'Model.GLB' };
    expect(glbFromDropEvent(ev(item(f)))).toBe(f);
  });

  it('폴더를 놓으면 null (폴더 열기 경로로)', () => {
    expect(glbFromDropEvent(ev(item({ name: 'x.glb' }, false)))).toBeNull();
  });

  it('glb가 아닌 파일, 여러 개, 아무것도 없는 경우는 null', () => {
    expect(glbFromDropEvent(ev(item({ name: 'a.txt' })))).toBeNull();
    expect(glbFromDropEvent(ev(item({ name: 'a.glb' }), item({ name: 'b.glb' })))).toBeNull();
    expect(glbFromDropEvent({ dataTransfer: { items: [] } })).toBeNull();
    expect(glbFromDropEvent({})).toBeNull();
  });
});
