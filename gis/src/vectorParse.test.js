import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCollection, collectGroups, detectEncoding, guessCrs, isVectorFileName, normalizeEncoding, readRaw } from './vectorParse.js';

const SAMPLES = path.join(fileURLToPath(new URL('.', import.meta.url)), '..', 'test-data');
const file = (name) => {
  const buf = fs.readFileSync(path.join(SAMPLES, name));
  return { name, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
const fromBytes = (name, bytes) => ({ name, arrayBuffer: async () => new Uint8Array(bytes).buffer });
const text = (name, s) => fromBytes(name, new TextEncoder().encode(s));

/** 압축 없이(stored) 묶는 아주 작은 ZIP 만들기 (시험용) */
function makeZip(entries) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const u16 = (n) => [n & 255, (n >> 8) & 255];
  const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  for (const [name, data] of entries) {
    const nameB = enc.encode(name);
    const crc = crc32(data);
    const local = [...u32(0x04034b50), ...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameB.length), ...u16(0), ...nameB];
    chunks.push(Uint8Array.from(local), data);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameB.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameB]));
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

describe('인코딩', () => {
  it('.cpg 이름을 정규화한다 (CP949/949/EUC-KR -> euc-kr)', () => {
    for (const l of ['CP949', '949', 'EUC-KR', 'ms949', 'windows-949', 'KS_C_5601-1987', ' cp949\n']) expect(normalizeEncoding(l)).toBe('euc-kr');
    for (const l of ['UTF-8', 'utf8', '65001']) expect(normalizeEncoding(l)).toBe('utf-8');
    expect(normalizeEncoding('1252')).toBe('windows-1252');
    expect(normalizeEncoding('')).toBeNull();
    expect(normalizeEncoding('ANSI')).toBeNull();
    expect(normalizeEncoding('이상한값')).toBeNull();
  });

  it('.cpg가 없으면 내용으로 판단한다: EUC-KR 한글 dbf는 euc-kr', async () => {
    const dbf = await file('pt_5179_euckr.dbf').arrayBuffer();
    expect(detectEncoding(dbf, null)).toEqual({ encoding: 'euc-kr', source: 'euc-kr-guess' });
  });

  it('영문·숫자만 있으면 utf-8(ascii), UTF-8 한글이면 utf-8, EUC-KR 한글이면 euc-kr', () => {
    const ab = (bytes) => Uint8Array.from(bytes).buffer;
    expect(detectEncoding(ab(new TextEncoder().encode('ID,NAME 123')), '')).toEqual({ encoding: 'utf-8', source: 'ascii' });
    expect(detectEncoding(ab(new TextEncoder().encode('한글')), '')).toEqual({ encoding: 'utf-8', source: 'utf8' });
    expect(detectEncoding(ab([0xc7, 0xd1, 0xb1, 0xdb]), '')).toEqual({ encoding: 'euc-kr', source: 'euc-kr-guess' }); // EUC-KR로 쓴 "한글"
  });

  it('.cpg가 있으면 그대로 따른다', async () => {
    const dbf = await file('pt_5179_euckr.dbf').arrayBuffer();
    expect(detectEncoding(dbf, 'CP949')).toEqual({ encoding: 'euc-kr', source: 'cpg' });
  });
});

describe('좌표계 추정', () => {
  it('도 단위 범위면 4326', () => {
    expect(guessCrs([126.9, 37.5, 127.1, 37.6])).toBe('EPSG:4326');
  });

  it('5179 범위(백만 단위)는 5179, 5186 범위(수십만)는 5186', () => {
    expect(guessCrs([953000, 1951000, 954000, 1953000])).toBe('EPSG:5179');
    expect(guessCrs([197000, 551000, 199000, 553000])).toBe('EPSG:5186');
  });

  it('한국 밖으로 읽히는 값은 null', () => {
    expect(guessCrs([5, 5, 500, 500])).toBeNull();
  });
});

describe('SHP 읽기', () => {
  it('.prj가 있으면 그것으로 변환한다 (5179 점 -> 기준 경위도)', async () => {
    const { groups } = await collectGroups([file('pt_5179.shp'), file('pt_5179.dbf'), file('pt_5179.prj'), file('pt_5179.shx')]);
    expect(groups).toHaveLength(1);
    const { collection, info } = buildCollection(await readRaw(groups[0]));
    expect(info.crs.source).toBe('prj');
    expect(info.count).toBe(2);
    const [lon, lat] = collection.features[0].geometry.coordinates;
    expect(lon).toBeCloseTo(126.978, 5);
    expect(lat).toBeCloseTo(37.5665, 5);
    expect(info.warnings).toEqual([]);
  });

  it('.prj가 없으면 좌표 범위로 5179를 추정하고 알려 준다', async () => {
    const { groups } = await collectGroups([file('pt_5179.shp'), file('pt_5179.dbf')]);
    const { collection, info } = buildCollection(await readRaw(groups[0]));
    expect(info.crs).toMatchObject({ code: 'EPSG:5179', source: 'guess' });
    expect(info.warnings.join(' ')).toMatch(/추정/);
    expect(collection.features[0].geometry.coordinates[0]).toBeCloseTo(126.978, 5);
  });

  it('좌표계를 직접 고르면 그것을 쓴다 (엉뚱한 5186을 고르면 경고)', async () => {
    const { groups } = await collectGroups([file('pt_5179.shp'), file('pt_5179.dbf'), file('pt_5179.prj')]);
    const wrong = buildCollection(await readRaw(groups[0]), { crs: 'EPSG:5186' });
    expect(wrong.info.crs.source).toBe('user');
    expect(wrong.info.warnings.length).toBeGreaterThan(0);
  });

  it('한글 속성: .cpg 없이도 EUC-KR로 자동 판단해 읽고, 인코딩을 utf-8로 고르면 깨진다', async () => {
    const { groups } = await collectGroups([file('pt_5179_euckr.shp'), file('pt_5179_euckr.dbf'), file('pt_5179_euckr.prj')]);
    const raw = await readRaw(groups[0]);
    const auto = buildCollection(raw);
    expect(auto.info.encoding).toEqual({ encoding: 'euc-kr', source: 'euc-kr-guess' });
    expect(auto.collection.features[0].properties).toEqual({ 이름: '기준점 원점', 번호: 1 });
    const forced = buildCollection(raw, { encoding: 'utf-8' });
    expect(forced.collection.features[0].properties['이름']).toBeUndefined();
  });

  it('면·선도 변환된다 (5179 면, 5186 선)', async () => {
    for (const stem of ['poly_5179', 'line_5186']) {
      const { groups } = await collectGroups([file(`${stem}.shp`), file(`${stem}.dbf`), file(`${stem}.prj`)]);
      const { collection, info } = buildCollection(await readRaw(groups[0]));
      expect(info.crs.source).toBe('prj');
      expect(info.center.lon).toBeCloseTo(126.978, 2);
      expect(info.center.lat).toBeCloseTo(37.5665, 1);
      expect(collection.features[0].geometry.type).toBe(info.geometryTypes[0]);
    }
  });

  it('shp 없이 dbf만 있으면 건너뛴 파일로 알려 준다', async () => {
    const { groups, skipped } = await collectGroups([file('pt_5179.dbf')]);
    expect(groups).toEqual([]);
    expect(skipped).toEqual(['pt_5179.dbf']);
  });
});

describe('GeoJSON 읽기', () => {
  it('경위도 GeoJSON은 그대로 (좌표계 기본 4326)', async () => {
    const { groups } = await collectGroups([file('square.geojson')]);
    const { info } = buildCollection(await readRaw(groups[0]));
    expect(info.crs.code).toBe('EPSG:4326');
    expect(info.center.lon).toBeCloseTo(126.978, 2);
    expect(info.warnings).toEqual([]);
  });

  it('crs 항목(EPSG:5179)이 있으면 그 좌표계로 변환한다', async () => {
    const gj = { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::5179' } }, features: [{ type: 'Feature', properties: { a: 1 }, geometry: { type: 'Point', coordinates: [953901.17, 1952032.08] } }] };
    const { groups } = await collectGroups([text('a.geojson', JSON.stringify(gj))]);
    const { collection, info } = buildCollection(await readRaw(groups[0]));
    expect(info.crs).toMatchObject({ code: 'EPSG:5179', source: 'geojson-crs' });
    expect(collection.features[0].geometry.coordinates[0]).toBeCloseTo(126.978, 5);
  });

  it('crs 없이 투영 좌표가 들어 있으면 추정한다', async () => {
    const gj = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[953901, 1952032], [954401, 1952032]] } };
    const { groups } = await collectGroups([text('b.json', JSON.stringify(gj))]);
    const { info } = buildCollection(await readRaw(groups[0]));
    expect(info.crs).toMatchObject({ code: 'EPSG:5179', source: 'guess' });
  });

  it('지오메트리 하나만 있어도 FeatureCollection으로 만든다', async () => {
    const { groups } = await collectGroups([text('c.geojson', JSON.stringify({ type: 'Point', coordinates: [127, 37.5] }))]);
    const { collection } = buildCollection(await readRaw(groups[0]));
    expect(collection.features).toHaveLength(1);
  });

  it('깨진 JSON은 파일 이름이 든 오류', async () => {
    const { groups } = await collectGroups([text('bad.geojson', '{not json')]);
    await expect(readRaw(groups[0])).rejects.toThrow(/bad\.geojson/);
  });
});

describe('ZIP', () => {
  it('zip 안의 shp 묶음을 풀어서 읽는다 (폴더 안에 있어도, __MACOSX 무시)', async () => {
    const read = (n) => new Uint8Array(fs.readFileSync(path.join(SAMPLES, n)));
    const zip = makeZip([
      ['data/pt_5179_euckr.shp', read('pt_5179_euckr.shp')],
      ['data/pt_5179_euckr.dbf', read('pt_5179_euckr.dbf')],
      ['data/pt_5179_euckr.prj', read('pt_5179_euckr.prj')],
      ['__MACOSX/data/._pt_5179_euckr.shp', new Uint8Array([1, 2, 3])],
    ]);
    const { groups, skipped } = await collectGroups([fromBytes('upload.zip', zip)]);
    expect(groups).toHaveLength(1);
    expect(skipped).toEqual([]);
    const { collection, info } = buildCollection(await readRaw(groups[0]));
    expect(info.name).toBe('pt_5179_euckr');
    expect(collection.features[0].properties['이름']).toBe('기준점 원점');
  });
});

it('벡터 파일 이름 판별', () => {
  for (const n of ['a.shp', 'A.DBF', 'a.prj', 'a.cpg', 'a.geojson', 'a.json', 'a.zip']) expect(isVectorFileName(n)).toBe(true);
  for (const n of ['a.glb', 'a.txt', 'tileset.jsonx']) expect(isVectorFileName(n)).toBe(false);
});

describe('SLD 파일 함께 선택', () => {
  it('.sld는 데이터 묶음과 이름이 달라도 스타일 목록으로 따로 모으고, 건너뛴 파일에 넣지 않는다', async () => {
    const { groups, skipped, styles } = await collectGroups([file('pt_5179.shp'), file('pt_5179.dbf'), text('other.sld', '<StyledLayerDescriptor/>')]);
    expect(groups).toHaveLength(1);
    expect(skipped).toEqual([]);
    expect(styles.map((s) => s.name)).toEqual(['other.sld']);
    expect(new TextDecoder().decode(await styles[0].read())).toBe('<StyledLayerDescriptor/>');
  });

  it('isVectorFileName: sld도 끌어놓기 대상', () => {
    expect(isVectorFileName('x.sld')).toBe(true);
  });
});

describe('GeoJSON과 SHP를 한꺼번에 선택', () => {
  it('종류별로 나뉘어 각각 읽히고, 하나가 깨져도 나머지는 읽힌다', async () => {
    const { groups } = await collectGroups([file('square.geojson'), file('pt_5179.shp'), file('pt_5179.dbf'), file('pt_5179.prj'), text('bad.geojson', '{not json')]);
    expect(groups.map((g) => `${g.kind}:${g.name}`).sort()).toEqual(['geojson:bad.geojson', 'geojson:square.geojson', 'shp:pt_5179']);
    const results = [];
    for (const g of groups) {
      try {
        results.push(buildCollection(await readRaw(g)).info.name);
      } catch {
        results.push(`오류:${g.name}`);
      }
    }
    expect(results.sort()).toEqual(['pt_5179', 'square.geojson', '오류:bad.geojson']);
  });
});
