import { describe, expect, it } from 'vitest';
import { classifyDrop } from './dropClassify.js';
import { buildCollection, collectGroups, isVectorFileName, readRaw } from './vectorParse.js';
import { planSources } from './vectorNames.js';

const enc = new TextEncoder();
const fromBytes = (name, bytes) => ({ name, arrayBuffer: async () => Uint8Array.from(bytes).buffer });
const text = (name, s) => fromBytes(name, enc.encode(s));

/** 압축 없이(stored) 묶는 아주 작은 ZIP (KMZ 시험용) */
function makeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const u16 = (n) => [n & 255, (n >> 8) & 255];
  const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8);
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

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>시험</name>
  <Placemark><name>점 하나</name><description>설명입니다</description><Point><coordinates>127.1,37.5,30</coordinates></Point></Placemark>
  <Placemark><name>선</name><LineString><coordinates>127.1,37.5,0 127.2,37.6,0</coordinates></LineString></Placemark>
  <Placemark><name>면</name><Polygon><outerBoundaryIs><LinearRing><coordinates>127,37,0 127.1,37,0 127.1,37.1,0 127,37,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;

const GPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="37.5" lon="127.1"><name>출발</name></wpt>
  <trk><name>산책</name><trkseg>
    <trkpt lat="37.5" lon="127.1"><ele>10</ele></trkpt>
    <trkpt lat="37.51" lon="127.11"><ele>12</ele></trkpt>
    <trkpt lat="37.52" lon="127.12"><ele>14</ele></trkpt>
  </trkseg></trk>
</gpx>`;

const build = async (file, opts) => {
  const { groups } = await collectGroups([file]);
  return buildCollection(await readRaw(groups[0]), opts);
};

describe('KML', () => {
  it('점·선·면을 읽고 좌표계는 늘 경위도(규격)', async () => {
    const { collection, info } = await build(text('시험.kml', KML));
    expect(info).toMatchObject({ source: 'KML', count: 3, crs: { code: 'EPSG:4326', source: 'format' } });
    expect(info.geometryTypes.sort()).toEqual(['LineString', 'Point', 'Polygon']);
    const point = collection.features.find((f) => f.geometry.type === 'Point');
    expect(point.geometry.coordinates.slice(0, 2)).toEqual([127.1, 37.5]);
    expect(point.properties.name).toBe('점 하나');
    expect(info.center.lon).toBeGreaterThan(127);
    expect(info.warnings).toEqual([]);
  });

  it('해외 KML도 그대로 (한국 밖 안내만)', async () => {
    const kml = KML.replace(/127(\.\d)?/g, '2$1').replace(/37(\.\d)?/g, '48$1');
    const { info } = await build(text('paris.kml', kml));
    expect(info.warnings.join('')).toContain('한국 밖입니다');
  });

  it('깨진 파일은 알아듣기 쉬운 오류', async () => {
    const { groups } = await collectGroups([text('bad.kml', '이건 XML이 아님')]);
    await expect(readRaw(groups[0])).rejects.toThrow(/bad\.kml: KML을 읽을 수 없습니다/);
  });
});

describe('KMZ (KML을 담은 ZIP)', () => {
  it('doc.kml 을 읽고 이름은 KMZ 파일 이름으로 보이며, 아이콘 그림은 건너뛴 목록에 오르지 않는다', async () => {
    const kmz = fromBytes('여행.kmz', makeZip([['doc.kml', enc.encode(KML)], ['files/icon.png', Uint8Array.from([1, 2, 3])]]));
    const { groups, skipped } = await collectGroups([kmz]);
    expect(groups.map((g) => [g.name, g.kind])).toEqual([['여행.kmz', 'kml']]);
    expect(skipped).toEqual([]);
    const out = buildCollection(await readRaw(groups[0]));
    expect(out.info.count).toBe(3);
  });
});

describe('GPX', () => {
  it('웨이포인트와 트랙(선)을 읽는다', async () => {
    const { collection, info } = await build(text('walk.gpx', GPX));
    expect(info).toMatchObject({ source: 'GPX', crs: { code: 'EPSG:4326', source: 'format' } });
    const types = collection.features.map((f) => f.geometry.type).sort();
    expect(types).toEqual(['LineString', 'Point']);
    const line = collection.features.find((f) => f.geometry.type === 'LineString');
    expect(line.geometry.coordinates.length).toBe(3);
    expect(line.geometry.coordinates[0].slice(0, 2)).toEqual([127.1, 37.5]);
  });
});

describe('CSV', () => {
  const csv = (s) => text('점.csv', s);

  it('경위도 열을 이름으로 찾아 점을 만든다 (WGS84 로 보이면 기본값)', async () => {
    const { collection, info } = await build(csv('이름,lon,lat,수량\n가,127.1,37.5,10\n나,127.2,37.6,20\n'));
    expect(info).toMatchObject({ source: 'CSV', count: 2, crs: { code: 'EPSG:4326', source: 'default' } });
    expect(info.csv).toMatchObject({ columns: ['이름', 'lon', 'lat', '수량'], xCol: 1, yCol: 2, delimiter: ',', header: true, rows: 2 });
    expect(collection.features[0].properties).toEqual({ 이름: '가', 수량: 10 });
  });

  it('EUC-KR(한글 윈도우 엑셀 CSV)도 자동으로 읽는다', async () => {
    const bytes = [0xc0, 0xcc, 0xb8, 0xa7, ...enc.encode(',lon,lat\n'), 0xb0, 0xa1, ...enc.encode(',127.1,37.5\n')];
    const { collection, info } = await build(fromBytes('한글.csv', bytes));
    expect(info.encoding.encoding).toBe('euc-kr');
    expect(info.csv.columns[0]).toBe('이름');
    expect(collection.features[0].properties['이름']).toBe('가');
  });

  it('투영 좌표(5186 같은 큰 숫자)는 범위로 좌표계를 추정하고, 직접 고를 수도 있다', async () => {
    const { info } = await build(csv('id,X,Y\n1,200000,600000\n2,200100,600100\n'));
    expect(info.crs.source).toBe('guess');
    expect(info.warnings.join('')).toContain('추정');
    const fixed = await build(csv('id,X,Y\n1,200000,600000\n'), { crs: 'EPSG:5186' });
    expect(fixed.info.crs).toMatchObject({ code: 'EPSG:5186', source: 'user' });
    expect(fixed.info.center.lon).toBeCloseTo(127, 4);
    expect(fixed.info.center.lat).toBeCloseTo(38, 4);
  });

  it('열을 직접 고르고 구분자를 바꿀 수 있다', async () => {
    const { info, collection } = await build(csv('a;b;c\n1;127.1;37.5\n'), { delimiter: ';', xCol: 1, yCol: 2 });
    expect(info.csv.delimiter).toBe(';');
    expect(collection.features[0].geometry.coordinates).toEqual([127.1, 37.5]);
  });

  it('좌표 열을 못 찾으면 0개 + 안내(열 목록은 돌려준다)', async () => {
    const { info } = await build(csv('이름,주소\n가,서울\n'));
    expect(info.count).toBe(0);
    expect(info.csv.columns).toEqual(['이름', '주소']);
    expect(info.warnings.join('')).toContain('직접 고르세요');
    expect(info.warnings.join('')).not.toContain('피처가 없습니다');
  });

  it('좌표를 다른 나라 좌표계로 직접 입력(등록)해서 쓸 수 있다', async () => {
    const def = '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs';
    const { registerCrs } = await import('../../viewer/src/kit/crsList.js');
    registerCrs({ code: 'EPSG:2154', def, label: 'Lambert-93' });
    const { info } = await build(csv('id,x,y\n1,700000,6600000\n'), { crs: 'EPSG:2154' });
    expect(info.center.lon).toBeCloseTo(3, 6);
    expect(info.center.lat).toBeCloseTo(46.5, 6);
  });
});

describe('파일 이름 규칙과 분류', () => {
  it.each(['a.kml', 'a.KMZ', 'a.gpx', 'a.csv', 'a.shp', 'a.geojson'])('%s 는 벡터 파일', (n) => {
    expect(isVectorFileName(n)).toBe(true);
  });

  it('planSources: KML·KMZ·GPX·CSV 는 파일 하나가 한 묶음', () => {
    const p = planSources(['a.kml', 'b.kmz', 'c.gpx', 'd.csv', 'e.txt'].map((name) => ({ name })));
    expect(p.sources.map((s) => s.label)).toEqual(['a.kml', 'b.kmz', 'c.gpx', 'd.csv']);
    expect(p.skipped).toEqual(['e.txt']);
  });

  it('classifyDrop: 새 형식도 벡터로 분류하고 이름 옆에 종류를 적는다', () => {
    const plan = classifyDrop(['x/a.kml', 'x/b.kmz', 'x/c.gpx', 'x/d.csv']);
    expect(plan.vectors.map((v) => [v.label, v.kind])).toEqual([
      ['a.kml', 'KML'],
      ['b.kmz', 'KMZ'],
      ['c.gpx', 'GPX'],
      ['d.csv', 'CSV'],
    ]);
    expect(plan.ignored).toEqual([]);
  });
});

describe('높이 표시 (info.hasHeights)', () => {
  it('KML·GPX 처럼 높이가 있으면 true, 높이가 없는 자료는 false', async () => {
    expect((await build(text('시험.kml', KML))).info.hasHeights).toBe(true);
    expect((await build(text('walk.gpx', GPX))).info.hasHeights).toBe(true); // 트랙 점의 고도
    expect((await build(text('점.csv', '이름,lon,lat\n가,127.1,37.5\n'))).info.hasHeights).toBe(false);
  });
  it('투영 좌표에서 경위도로 바꿔도 높이는 남는다', async () => {
    const gj = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [200000, 600000, 55] } }] });
    const { collection, info } = await build(text('h.geojson', gj), { crs: 'EPSG:5186' });
    expect(info.hasHeights).toBe(true);
    expect(collection.features[0].geometry.coordinates[2]).toBe(55);
  });
});
