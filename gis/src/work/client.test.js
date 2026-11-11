import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeArrayBuffer } from 'geotiff';
import { afterEach, describe, expect, it } from 'vitest';
import { planSources } from '../vectorNames.js';
import { buildCollection, collectGroups, readRaw } from '../vectorParse.js';
import { readDemText } from '../demText.js';
import { openVectorFiles, poolInfo, readDemTextParallel, readDemTiff, resetPool, workerCountFor } from './client.js';
import { heldCount } from './vectorJobs.js';

// Node에는 Worker가 없어서 같은 코드가 그 자리에서(inline) 돈다 — 워커 쪽 로직을 그대로 시험한다.
const SAMPLES = path.join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'test-data');
const sample = (name) => {
  const buf = fs.readFileSync(path.join(SAMPLES, name));
  const blob = new Blob([buf]);
  return Object.assign(blob, { name });
};
const fakeFile = (name) => ({ name, arrayBuffer: () => sample(name).arrayBuffer() });

afterEach(() => resetPool());

describe('workerCountFor', () => {
  it('코어 수 - 1 (화면 몫 한 개 남김), 1~4개', () => {
    expect(workerCountFor(1)).toBe(1);
    expect(workerCountFor(2)).toBe(1);
    expect(workerCountFor(4)).toBe(3);
    expect(workerCountFor(16)).toBe(4);
    expect(workerCountFor(undefined)).toBe(3);
  });
});

describe('planSources: 파일 이름만 보고 나누기', () => {
  it('같은 이름의 SHP 부품은 한 묶음, zip·GeoJSON은 각각 한 묶음, sld는 따로, 나머지는 건너뜀', () => {
    const files = ['a/pt.shp', 'a/pt.dbf', 'a/pt.prj', 'a/line.shp', 'a/line.dbf', 'x.zip', 'y.geojson', 'z.sld', 'readme.txt', 'A/PT.SHX'].map((name) => ({ name }));
    const p = planSources(files);
    expect(p.sources.map((s) => [s.label, s.files.map((f) => f.name)])).toEqual([
      ['pt', ['a/pt.shp', 'a/pt.dbf', 'a/pt.prj', 'A/PT.SHX']], // 이름은 대소문자를 가리지 않고 묶는다 (collectGroups와 같은 규칙)
      ['line', ['a/line.shp', 'a/line.dbf']],
      ['x.zip', ['x.zip']],
      ['y.geojson', ['y.geojson']],
    ]);
    expect(p.styles.map((s) => s.name)).toEqual(['z.sld']);
    expect(p.skipped).toEqual(['readme.txt']);
  });
});

describe('openVectorFiles (워커와 같은 경로)', () => {
  it('워커 없이 돌 때는 inline 이라고 알려 준다', () => {
    expect(poolInfo().mode).toBe('inline');
  });

  it('SHP 부품들을 읽어 예전 방식(collectGroups+readRaw+buildCollection)과 같은 결과를 낸다', async () => {
    const names = ['pt_5179.shp', 'pt_5179.dbf', 'pt_5179.prj', 'pt_5179.shx'];
    const r = await openVectorFiles(names.map(sample));
    expect(r.errors).toEqual([]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ name: 'pt_5179', kind: 'shp', hasDbf: true });
    const viaWorker = await r.items[0].build({});
    const { groups } = await collectGroups(names.map(fakeFile));
    const direct = buildCollection(await readRaw(groups[0]));
    expect(viaWorker).toEqual(direct);
    r.release();
  });

  it('설정(좌표계·인코딩)을 바꿔 다시 계산해도 원본은 한 번만 읽는다', async () => {
    const before = heldCount();
    const r = await openVectorFiles(['pt_5179_euckr.shp', 'pt_5179_euckr.dbf'].map(sample));
    expect(heldCount()).toBe(before + 1);
    const a = await r.items[0].build({ encoding: 'euc-kr', crs: 'EPSG:5179' });
    const b = await r.items[0].build({ encoding: 'utf-8', crs: 'EPSG:5179' });
    expect(a.info.encoding.encoding).toBe('euc-kr');
    expect(b.info.encoding.encoding).toBe('utf-8');
    expect(heldCount()).toBe(before + 1);
    r.release();
    // release는 기다리지 않고 보내므로 한 번 비운 뒤 확인
    await new Promise((res) => setTimeout(res, 0));
    expect(heldCount()).toBe(before);
  });

  it('여러 묶음을 한꺼번에 읽고, GeoJSON·SHP를 섞어도 이름순서를 지킨다', async () => {
    const r = await openVectorFiles([sample('poly_5179.shp'), sample('poly_5179.dbf'), sample('square.geojson'), sample('line_5186.shp'), sample('line_5186.dbf'), sample('line_5186.prj')]);
    expect(r.items.map((i) => [i.name, i.kind])).toEqual([
      ['poly_5179', 'shp'],
      ['square.geojson', 'geojson'],
      ['line_5186', 'shp'],
    ]);
    expect((await r.items[1].build({})).info.count).toBeGreaterThan(0);
    r.release();
  });

  it('{name, arrayBuffer, blob} 모양(폴더 끌어놓기)도 읽는다', async () => {
    const f = sample('square.geojson');
    const r = await openVectorFiles([{ name: 'dir/square.geojson', arrayBuffer: () => f.arrayBuffer(), blob: f }]);
    expect(r.items).toHaveLength(1);
    r.release();
  });

  it('Blob이 아닌 파일 모양은 버퍼로 읽어 넘긴다', async () => {
    const r = await openVectorFiles([fakeFile('square.geojson')]);
    expect(r.items).toHaveLength(1);
    r.release();
  });

  it('SLD는 화면에서 글자로 읽어 돌려주고, 읽지 못하는 묶음은 오류 목록에 담는다', async () => {
    const sld = { name: 'dir/s.sld', arrayBuffer: async () => new TextEncoder().encode('<sld/>').buffer };
    const bad = { name: 'broken.geojson', arrayBuffer: async () => new TextEncoder().encode('{nope').buffer };
    const r = await openVectorFiles([sld, bad, sample('square.geojson')]);
    expect(r.styles).toEqual([{ name: 's.sld', text: '<sld/>' }]);
    expect(r.errors.join('\n')).toMatch(/broken/);
    expect(r.items.map((i) => i.name)).toEqual(['square.geojson']);
    r.release();
  });

  it('닫은 뒤 build 하면 알아듣기 쉬운 오류', async () => {
    const r = await openVectorFiles([sample('square.geojson')]);
    const item = r.items[0];
    r.release();
    await new Promise((res) => setTimeout(res, 0));
    await expect(item.build({})).rejects.toThrow(/이미 닫힌/);
  });
});

describe('글자 DEM: 파일마다 읽고 합쳐도 예전 결과와 같다', () => {
  const xyz = (x0, y0, w, h, base) => {
    const lines = [];
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) lines.push(`${x0 + c * 90} ${y0 - r * 90} ${base + r * 10 + c}`);
    return lines.join('\n');
  };
  const blob = (text, name) => Object.assign(new Blob([text]), { name });

  it('도엽 두 개', async () => {
    const files = [blob(xyz(200000, 550000, 4, 3, 10), 'a.txt'), blob(xyz(200360, 550000, 4, 3, 50), 'b.txt')];
    const viaPool = await readDemTextParallel(files);
    const direct = await readDemText(files);
    expect(viaPool.name).toBe(direct.name);
    expect(viaPool.source).toBe(direct.source);
    expect(viaPool.bbox).toEqual(direct.bbox);
    expect(viaPool.stats).toEqual(direct.stats);
    expect(viaPool.tiles).toHaveLength(2);
    expect(Array.from(viaPool.tiles[1].data)).toEqual(Array.from(direct.tiles[1].data));
  });

  it('오류 메시지는 파일 이름과 함께 그대로', async () => {
    await expect(readDemTextParallel([blob('hello world\n', 'bad.txt')])).rejects.toThrow(/bad\.txt/);
  });
});

describe('readDemTiff (워커와 같은 경로)', () => {
  it('GeoTIFF를 읽고 높이 배열을 돌려준다', async () => {
    const meta = { width: 3, height: 2, ModelPixelScale: [0.001, 0.001, 0], ModelTiepoint: [0, 0, 0, 127, 37.5, 0], GTRasterTypeGeoKey: 1, GTModelTypeGeoKey: 2, GeographicTypeGeoKey: 4326 };
    const file = Object.assign(new Blob([writeArrayBuffer(Float32Array.from([1, 2, 3, 4, 5, 6]), meta)]), { name: 'd.tif' });
    const dem = await readDemTiff(file);
    expect(dem.width).toBe(3);
    expect(Array.from(dem.data)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(dem.stats.max).toBe(6);
  });
});

describe('직접 추가한 좌표계를 워커로 (withCrsDef)', () => {
  it('목록의 좌표계·auto 는 그대로, 직접 추가한 것만 정의를 붙인다', async () => {
    const { registerCrs } = await import('../../../viewer/src/kit/crsList.js');
    const { withCrsDef } = await import('./client.js');
    const def = '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs';
    registerCrs({ code: 'EPSG:2154', def, label: 'L93' });
    expect(withCrsDef({ crs: 'auto' })).toEqual({ crs: 'auto' });
    expect(withCrsDef({ crs: 'EPSG:5179' })).toEqual({ crs: 'EPSG:5179' });
    expect(withCrsDef({ crs: 'EPSG:2154', encoding: 'utf-8' })).toEqual({ crs: 'EPSG:2154', encoding: 'utf-8', crsDef: { code: 'EPSG:2154', def, label: 'L93' } });
    expect(withCrsDef(undefined)).toBeUndefined();
  });

  it('워커 쪽은 정의를 받아 모르는 좌표계로도 계산한다 (프랑스 Lambert-93 점)', async () => {
    const geojson = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [700000, 6600000] } }] };
    const f = Object.assign(new Blob([JSON.stringify(geojson)]), { name: 'fr.geojson' });
    const r = await openVectorFiles([f]);
    const def = '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs';
    const out = await r.items[0].build({ crs: 'EPSG:2154', crsDef: { code: 'EPSG:2154', def, label: 'L93' } });
    const [lon, lat] = out.collection.features[0].geometry.coordinates;
    expect(lon).toBeCloseTo(3, 6);
    expect(lat).toBeCloseTo(46.5, 6);
    expect(out.info.crs.code).toBe('EPSG:2154');
    r.release();
  });
});
