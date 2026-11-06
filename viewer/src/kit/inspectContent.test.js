import { describe, it, expect } from 'vitest';
import { EXT, readGlbHeader, parseGlbExtensions, b3dmGlbOffset, inspectContent } from './inspectContent.js';
import { resolveSource } from './sources.js';

/** 테스트용 최소 glb: 헤더 + JSON 청크 + (크기 흉내용) 이진 청크 */
function makeGlb(json, binBytes = 2000) {
  const raw = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = raw.length + ((4 - (raw.length % 4)) % 4);
  const jsonBytes = new Uint8Array(jsonLen).fill(0x20);
  jsonBytes.set(raw);
  const total = 12 + 8 + jsonLen + 8 + binBytes;
  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, jsonLen, true);
  v.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buf, 20, jsonLen).set(jsonBytes);
  v.setUint32(20 + jsonLen, binBytes, true);
  v.setUint32(24 + jsonLen, 0x004e4942, true);
  return new Uint8Array(buf);
}

function makeB3dm(glb, ft = 0, bt = 0) {
  const total = 28 + ft + bt + glb.length;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x6d643362, true);
  v.setUint32(4, 1, true);
  v.setUint32(8, total, true);
  v.setUint32(12, ft, true); // featureTable JSON
  v.setUint32(16, 0, true);
  v.setUint32(20, bt, true); // batchTable JSON
  v.setUint32(24, 0, true);
  out.set(glb, 28 + ft + bt);
  return out;
}

const DRACO_KTX = { extensionsUsed: [EXT.DRACO, EXT.KTX2, 'KHR_materials_unlit'], extensionsRequired: [EXT.DRACO, EXT.KTX2], images: [{ mimeType: 'image/ktx2' }] };
const PLAIN = { asset: { version: '2.0' }, images: [{ mimeType: 'image/jpeg' }] };

describe('glb 헤더/확장 파싱', () => {
  it('glb 헤더와 확장 목록을 읽는다', () => {
    const glb = makeGlb(DRACO_KTX);
    expect(readGlbHeader(glb.buffer.slice(0, 20)).jsonLength).toBeGreaterThan(0);
    const head = readGlbHeader(glb.buffer);
    const parsed = parseGlbExtensions(glb.buffer.slice(0, 20 + head.jsonLength));
    expect(parsed.extensionsRequired).toEqual([EXT.DRACO, EXT.KTX2]);
    expect(parsed.imageMimeTypes).toEqual(['image/ktx2']);
  });

  it('glb가 아니면 null', () => {
    expect(readGlbHeader(new ArrayBuffer(64))).toBeNull();
    expect(parseGlbExtensions(new ArrayBuffer(8))).toBeNull();
  });

  it('b3dm 안의 glb 시작 위치를 계산한다', () => {
    const glb = makeGlb(PLAIN);
    const b3dm = makeB3dm(glb, 20, 8);
    expect(b3dmGlbOffset(b3dm.buffer)).toBe(28 + 20 + 8);
    expect(b3dmGlbOffset(new ArrayBuffer(10))).toBeNull();
  });
});

describe('inspectContent (폴더 소스)', () => {
  const asFile = (bytes, name) => new File([bytes], name);

  function sourceWith(rootJson, entries) {
    const files = new Map([['tileset.json', new File([JSON.stringify(rootJson)], 'tileset.json')], ...entries]);
    return resolveSource({ kind: 'files', files });
  }

  it('Draco + KTX2 필수 확장을 찾아 디코더 필요로 판단 (외부 tileset.json도 따라감)', async () => {
    const root = { root: { content: { uri: 'sub/ext.json' }, children: [] } };
    const ext = { root: { content: { uri: 'a.glb' }, children: [{ content: { uri: 'b.glb' } }] } };
    const src = sourceWith(root, [
      ['sub/ext.json', new File([JSON.stringify(ext)], 'ext.json')],
      ['sub/a.glb', asFile(makeGlb(DRACO_KTX), 'a.glb')],
      ['sub/b.glb', asFile(makeGlb(DRACO_KTX), 'b.glb')],
    ]);
    const report = await inspectContent(src, root);
    expect(report.sampled).toBe(2);
    expect(report.formats).toEqual(['glb']);
    expect(report.needs).toEqual({ draco: true, ktx2: true, meshopt: false });
    expect(report.errors).toEqual([]);
  });

  it('외부 tileset.json이 여러 단계로 넓게 중첩돼도 콘텐츠까지 도달한다 (실데이터 구조)', async () => {
    // root -> 4개 자식(각각 외부 json) -> 각 json에 4개 자식(또 외부 json) -> glb
    const root = { root: { children: [0, 1, 2, 3].map((i) => ({ content: { uri: `main_${i}.json` } })) } };
    const entries = [];
    for (let i = 0; i < 4; i++) {
      const mid = { root: { children: [0, 1, 2, 3].map((j) => ({ content: { uri: `sub_${i}_${j}.json` } })) } };
      entries.push([`main_${i}.json`, new File([JSON.stringify(mid)], 'm.json')]);
      for (let j = 0; j < 4; j++) {
        const leaf = { root: { content: { uri: `tiles/${i}/${j}.glb` } } };
        entries.push([`sub_${i}_${j}.json`, new File([JSON.stringify(leaf)], 's.json')]);
        entries.push([`tiles/${i}/${j}.glb`, asFile(makeGlb(DRACO_KTX), 'x.glb')]);
      }
    }
    const src = sourceWith(root, entries);
    const report = await inspectContent(src, root);
    expect(report.sampled).toBeGreaterThan(0);
    expect(report.needs.draco).toBe(true);
  });

  it('압축 없는 glb는 디코더 불필요', async () => {
    const root = { root: { content: { uri: 'plain.glb' } } };
    const src = sourceWith(root, [['plain.glb', asFile(makeGlb(PLAIN), 'plain.glb')]]);
    const report = await inspectContent(src, root);
    expect(report.sampled).toBe(1);
    expect(report.needs).toEqual({ draco: false, ktx2: false, meshopt: false });
  });

  it('Meshopt만 쓰는 경우를 구분한다', async () => {
    const root = { root: { content: { uri: 'm.glb' } } };
    const glb = makeGlb({ extensionsUsed: [EXT.MESHOPT], extensionsRequired: [EXT.MESHOPT] });
    const src = sourceWith(root, [['m.glb', asFile(glb, 'm.glb')]]);
    const report = await inspectContent(src, root);
    expect(report.needs).toEqual({ draco: false, ktx2: false, meshopt: true });
  });

  it('b3dm 안의 glb도 검사한다', async () => {
    const root = { root: { content: { uri: 'x.b3dm' } } };
    const b3dm = makeB3dm(makeGlb(DRACO_KTX), 16, 12);
    const src = sourceWith(root, [['x.b3dm', asFile(b3dm, 'x.b3dm')]]);
    const report = await inspectContent(src, root);
    expect(report.formats).toEqual(['b3dm']);
    expect(report.needs.draco).toBe(true);
  });

  it('pnts 등 열어보지 않는 형식은 notInspected로 알린다', async () => {
    const root = { root: { content: { uri: 'cloud.pnts' } } };
    const src = sourceWith(root, [['cloud.pnts', asFile(new Uint8Array(64), 'cloud.pnts')]]);
    const report = await inspectContent(src, root);
    expect(report.sampled).toBe(0);
    expect(report.notInspected).toEqual(['pnts']);
  });

  it('깨진 파일이 있어도 예외 대신 errors에 담는다', async () => {
    const root = { root: { content: { uri: 'bad.glb' } } };
    const src = sourceWith(root, [['bad.glb', asFile(new Uint8Array(100), 'bad.glb')]]);
    const report = await inspectContent(src, root);
    expect(report.sampled).toBe(0);
    expect(report.errors.length).toBe(1);
  });
});
