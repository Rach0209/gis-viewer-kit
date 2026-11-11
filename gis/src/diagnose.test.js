import { describe, expect, it } from 'vitest';
import { dataDiagnostics, explainNoItems, explainSkipped, looksGarbled, looksSwapped, problem, sanitizeFeatures, splitProblem } from './diagnose.js';
import { buildCollection, collectGroups, readRaw } from './vectorParse.js';
import { openVectorFiles, resetPool } from './work/client.js';

const enc = new TextEncoder();
const fromBytes = (name, bytes) => ({ name, arrayBuffer: async () => Uint8Array.from(bytes).buffer });
const text = (name, s) => fromBytes(name, enc.encode(s));
const read = async (file) => {
  const { groups } = await collectGroups([file]);
  return readRaw(groups[0]);
};
const fc = (...geometries) => ({ type: 'FeatureCollection', features: geometries.map((geometry, i) => ({ type: 'Feature', properties: { i }, geometry })) });

describe('problem / splitProblem', () => {
  it('원인과 해결을 나누었다가 다시 가른다', () => {
    const p = problem('원인입니다.', '이렇게 하세요.');
    expect(splitProblem(p)).toEqual({ text: '원인입니다.', hint: '이렇게 하세요.' });
    expect(splitProblem('해결 없는 문장')).toEqual({ text: '해결 없는 문장', hint: '' });
    expect(problem('원인만', '')).toBe('원인만');
  });
});

describe('explainSkipped (열지 못한 파일의 이유)', () => {
  it('형식마다 이유와 해결 방법을 준다', () => {
    const out = explainSkipped(['a.gpkg', 'b.xlsx', 'c.dxf', 'd.7z']);
    expect(out).toHaveLength(4);
    expect(out[0]).toMatch(/a\.gpkg: GeoPackage/);
    expect(out[0]).toMatch(/→ .*GeoJSON/);
    expect(splitProblem(out[1]).hint).toMatch(/CSV/);
    expect(out[2]).toMatch(/CAD/);
    expect(out[3]).toMatch(/압축/);
  });

  it('같은 종류는 한 안내로 묶고 파일 이름은 3개까지만 보여 준다', () => {
    const out = explainSkipped(['1.gpkg', '2.gpkg', '3.gpkg', '4.gpkg', '5.gpkg']);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('1.gpkg, 2.gpkg, 3.gpkg 외 2개');
  });

  it('.shp 없이 남은 .dbf/.prj 는 .shp 를 같이 고르라고 알려 준다', () => {
    const out = explainSkipped(['x/a.dbf', 'x/a.prj']);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/속성 파일\(\.dbf\)만 있고 도형 파일\(\.shp\)이 없습니다/);
    expect(splitProblem(out[0]).hint).toMatch(/\.shp 파일도 함께/);
  });

  it('.gdb 폴더 안 파일은 지오데이터베이스 안내 하나로 모은다', () => {
    const out = explainSkipped(['land.gdb/a00000001.gdbtable', 'land.gdb/a00000001.gdbtablx', 'land.gdb/gdb']);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('land.gdb');
    expect(out[0]).toMatch(/지오데이터베이스/);
  });

  it('보조 파일(.sbn)은 해결 방법 없이 건너뛴다고만, 그림은 월드파일·이미지 열기를 안내', () => {
    const [aux] = explainSkipped(['a.sbn']);
    expect(splitProblem(aux).hint).toBe('');
    const [img] = explainSkipped(['photo.png']);
    expect(img).toMatch(/월드파일/);
    const [tif] = explainSkipped(['dem.tif']);
    expect(tif).toMatch(/지형\(DEM\) 열기/);
  });

  it('모르는 확장자와 확장자 없는 파일', () => {
    expect(explainSkipped(['a.abc'])[0]).toMatch(/\.abc.*지원하지 않습니다/);
    expect(explainSkipped(['README'])[0]).toMatch(/확장자가 없는/);
  });
});

describe('explainNoItems', () => {
  it('오류와 건너뛴 파일의 이유를 모두 모으고, 아무것도 없으면 기본 안내', () => {
    const out = explainNoItems({ errors: [problem('a.json: 읽을 수 없습니다.', '확인하세요.')], skipped: ['b.gpkg'] });
    expect(out).toHaveLength(2);
    expect(explainNoItems()[0]).toMatch(/열 수 있는 벡터 자료를 찾지 못했습니다/);
  });
});

describe('looksGarbled / looksSwapped', () => {
  it('깨진 글자(대체 문자, 占, Ã…)를 알아차리고 정상 한글·영문은 통과시킨다', () => {
    expect(looksGarbled([{ 이름: '서울시청', code: 'A1' }])).toBe(false);
    expect(looksGarbled([{ name: '��' }])).toBe(true);
    expect(looksGarbled([{ name: '占쏙옙' }])).toBe(true);
    expect(looksGarbled([{ name: 'SeoulÃ©' }])).toBe(true);
    expect(looksGarbled([{ '�키': 1 }])).toBe(true); // 열 이름이 깨진 경우
    expect(looksGarbled([null, undefined, {}])).toBe(false);
  });

  it('X=위도, Y=경도로 뒤바뀐 범위만 잡는다', () => {
    expect(looksSwapped([37.4, 126.9, 37.6, 127.1])).toBe(true);
    expect(looksSwapped([126.9, 37.4, 127.1, 37.6])).toBe(false);
    expect(looksSwapped([200000, 550000, 201000, 551000])).toBe(false); // 투영 좌표
    expect(looksSwapped(null)).toBe(false);
  });
});

describe('sanitizeFeatures (그릴 수 없는 도형 빼기)', () => {
  it('문제 없으면 같은 배열을 돌려준다', () => {
    const f = fc({ type: 'Point', coordinates: [127, 37] }).features;
    expect(sanitizeFeatures(f).features).toBe(f);
  });

  it('도형이 없는 피처는 세기만 하고 그대로 둔다', () => {
    const f = fc({ type: 'Point', coordinates: [127, 37] }, null).features;
    const r = sanitizeFeatures(f);
    expect(r.empty).toBe(1);
    expect(r.broken).toBe(0);
    expect(r.features[1].geometry).toBeNull();
  });

  it('NaN 좌표, 점 하나뿐인 선, 닫히지 않은 짧은 면은 도형을 뺀다', () => {
    const f = fc(
      { type: 'Point', coordinates: [NaN, 37] },
      { type: 'LineString', coordinates: [[127, 37]] },
      { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] },
      { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    ).features;
    const r = sanitizeFeatures(f);
    expect(r.broken).toBe(3);
    expect(r.features.map((x) => x.geometry === null)).toEqual([true, true, true, false]);
    expect(r.features[0].properties.i).toBe(0); // 속성은 남는다
  });

  it('멀티 도형은 깨진 조각만 빼고 나머지는 살린다', () => {
    const f = fc({ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[0, 0], [NaN, 0], [1, 1], [0, 0]]]] }).features;
    const r = sanitizeFeatures(f);
    expect(r.broken).toBe(1);
    expect(r.features[0].geometry.coordinates).toHaveLength(1);
  });

  it('구멍 고리가 깨졌으면 구멍만 뺀다', () => {
    const outer = [[0, 0], [4, 0], [4, 4], [0, 0]];
    const f = fc({ type: 'Polygon', coordinates: [outer, [[1, 1], [2, 1]]] }).features;
    const r = sanitizeFeatures(f);
    expect(r.features[0].geometry.coordinates).toEqual([outer]);
  });
});

describe('dataDiagnostics', () => {
  const base = { kind: 'shp', count: 3, features: [], rawBbox: [126.9, 37.4, 127.1, 37.6], bbox: [126.9, 37.4, 127.1, 37.6], center: { lon: 127, lat: 37.5 }, crs: { code: 'EPSG:4326', source: 'default' }, nearKorea: true, canPickEncoding: true, suggestCrs: null, empty: 0, broken: 0, swapped: false };

  it('문제가 없으면 아무 말도 하지 않는다', () => {
    expect(dataDiagnostics(base)).toEqual([]);
  });

  it('깨진 글자는 인코딩을 바꿔 보라고 하되, 인코딩을 고를 수 없는 형식에서는 말하지 않는다', () => {
    const features = [{ properties: { n: '�' } }];
    expect(dataDiagnostics({ ...base, features })[0]).toMatch(/한글이 깨져 보입니다.*\n→ .*EUC-KR/s);
    expect(dataDiagnostics({ ...base, features, canPickEncoding: false })).toEqual([]);
  });

  it('X·Y 뒤바뀜: CSV 에는 열 바꾸기, 그 밖에는 순서 바꾸기 칸을 알려 준다', () => {
    const swapped = { ...base, swapped: true, rawBbox: [37.4, 126.9, 37.6, 127.1] };
    expect(dataDiagnostics({ ...swapped, kind: 'csv' })[0]).toMatch(/서로 바뀐 것 같습니다.*열/s);
    expect(dataDiagnostics(swapped)[0]).toMatch(/X·Y 순서 바꾸기/);
  });

  it('한국 밖인데 다른 좌표계로 읽으면 한국 안이면 그 좌표계를 권한다', () => {
    const out = dataDiagnostics({ ...base, nearKorea: false, crs: { code: 'EPSG:4326', source: 'user' }, suggestCrs: 'EPSG:5179' });
    expect(out[0]).toMatch(/EPSG:5179로 읽으면 한국 안/);
    expect(dataDiagnostics({ ...base, nearKorea: false, suggestCrs: 'EPSG:4326' })).toEqual([]); // 같은 좌표계면 권하지 않는다
  });

  it('좌표가 모두 0, 도형 없음, 깨진 도형, 피처가 아주 많음', () => {
    expect(dataDiagnostics({ ...base, bbox: [0, 0, 0, 0] })[0]).toMatch(/모든 좌표가 0, 0/);
    expect(dataDiagnostics({ ...base, empty: 2 })[0]).toMatch(/2개 피처는 도형이 없어/);
    expect(dataDiagnostics({ ...base, broken: 3 })[0]).toMatch(/3개 피처는 좌표가 숫자가 아니거나/);
    expect(dataDiagnostics({ ...base, count: 250000 })[0]).toMatch(/250,000개로 많아/);
  });
});

describe('읽기 오류 안내 (readRaw)', () => {
  it('비어 있는 파일은 0바이트라고 알려 준다', async () => {
    await expect(read(text('a.geojson', ''))).rejects.toThrow(/a\.geojson: 비어 있는 파일\(0바이트\).*\n→/s);
    await expect(read(text('a.csv', ''))).rejects.toThrow(/비어 있는 파일/);
    await expect(read(text('a.kml', ''))).rejects.toThrow(/비어 있는 파일/);
  });

  it('JSON 이 아니거나 GeoJSON 이 아니면 원인과 해결을 준다', async () => {
    await expect(read(text('a.geojson', '{ 잘린'))).rejects.toThrow(/GeoJSON을 읽을 수 없습니다.*\n→ .*FeatureCollection/s);
    await expect(read(text('tileset.json', '{"asset":{"version":"1.0"},"root":{}}'))).rejects.toThrow(/GeoJSON이 아닙니다 \("type" 값이 없음\).*tileset\.json/s);
    await expect(read(text('t.json', '{"type":"Topology","objects":{}}'))).rejects.toThrow(/TopoJSON입니다/);
  });

  it('깨진 SHP, 0바이트 SHP', async () => {
    const shp = { name: 'a.shp', arrayBuffer: async () => new Uint8Array(10).buffer };
    const { groups } = await collectGroups([shp]);
    await expect(readRaw(groups[0])).rejects.toThrow(/a: SHP를 읽을 수 없습니다.*\n→ .*QGIS/s);
    const empty = { name: 'b.shp', arrayBuffer: async () => new ArrayBuffer(0) };
    const g2 = (await collectGroups([empty])).groups;
    await expect(readRaw(g2[0])).rejects.toThrow(/비어 있는 파일/);
  });

  it('ZIP 이 아닌 ZIP, 빈 ZIP 파일', async () => {
    await expect(collectGroups([text('a.zip', '이건 zip 이 아닙니다')])).rejects.toThrow(/a\.zip: ZIP을 풀 수 없습니다.*\n→/s);
    await expect(collectGroups([text('b.zip', '')])).rejects.toThrow(/비어 있는 파일/);
  });

  it('NetworkLink 만 있는 KML 은 피처가 없다는 이유를 링크로 설명한다', async () => {
    const kml = '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><NetworkLink><name>x</name><Link><href>http://example.com/a.kml</href></Link></NetworkLink></Document></kml>';
    const { info } = buildCollection(await read(text('n.kml', kml)));
    // togeojson 은 링크를 도형 없는 피처 하나로 만든다. 그래도 "도형이 없다"가 아니라 링크 안내가 나와야 한다
    expect(info.warnings.join('\n')).toMatch(/NetworkLink.*\n→ .*내려받아/s);
    expect(info.warnings.join('\n')).not.toMatch(/도형이 없어 지도에/);
  });

  it('feature 가 0개인 GeoJSON/GPX 도 이유를 말한다', async () => {
    expect(buildCollection(await read(text('e.geojson', '{"type":"FeatureCollection","features":[]}'))).info.warnings.join('\n')).toMatch(/features가 비어/);
    expect(buildCollection(await read(text('e.gpx', '<?xml version="1.0"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1"></gpx>'))).info.warnings.join('\n')).toMatch(/GPX에 경로/);
  });
});

describe('읽은 자료 점검 (buildCollection)', () => {
  it('X·Y 가 뒤바뀐 CSV: 알려 주고, X·Y 바꾸기를 켜면 한국 안에 놓인다', async () => {
    const raw = await read(text('s.geojson', JSON.stringify(fc({ type: 'Point', coordinates: [37.55, 126.98] }, { type: 'Point', coordinates: [37.5, 127.0] }))));
    const first = buildCollection(raw);
    expect(first.info.swapSuspected).toBe(true);
    expect(first.info.warnings.join('\n')).toMatch(/서로 바뀐 것 같습니다/);
    expect(first.info.warnings).toHaveLength(1); // 같은 원인의 "좌표계를 알 수 없고…" 안내가 겹쳐 나오지 않는다
    const fixed = buildCollection(raw, { swapXY: true });
    expect(fixed.info.center.lon).toBeGreaterThan(126.9);
    expect(fixed.info.center.lat).toBeGreaterThan(37.4);
    expect(fixed.info.warnings.join('\n')).not.toMatch(/서로 바뀐/);
    expect(fixed.info.swapSuspected).toBe(true); // 켠 뒤에도 칸은 그대로 보여 끌 수 있다
  });

  it('도형이 없거나 깨진 피처는 세고 안내한다 (속성은 남는다)', async () => {
    const g = fc({ type: 'Point', coordinates: [127, 37.5] }, null, { type: 'LineString', coordinates: [[127, 37.5]] });
    const { collection, info } = buildCollection(await read(text('g.geojson', JSON.stringify(g))));
    expect(info).toMatchObject({ count: 3, emptyCount: 1, brokenCount: 1 });
    expect(collection.features).toHaveLength(3);
    expect(info.warnings.join('\n')).toMatch(/1개 피처는 도형이 없어/);
    expect(info.warnings.join('\n')).toMatch(/1개 피처는 좌표가 숫자가 아니거나/);
  });

  it('한국 좌표(미터)를 잘못 4326 으로 고르면 알려 주고 맞는 좌표계를 권한다', async () => {
    const g = fc({ type: 'Point', coordinates: [199000, 551000] });
    const { info } = buildCollection(await read(text('p.geojson', JSON.stringify(g))), { crs: 'EPSG:3857' });
    expect(info.warnings.join('\n')).toMatch(/→ .*EPSG:5179|EPSG:5186/);
  });

  it('예제와 정상 자료에는 새 안내가 붙지 않는다', async () => {
    const { info } = buildCollection(await read(text('ok.geojson', JSON.stringify(fc({ type: 'Point', coordinates: [127, 37.5] })))));
    expect(info.warnings).toEqual([]);
    expect(info.swapSuspected).toBe(false);
  });
});

describe('열기 전체 흐름의 안내 (openVectorFiles)', () => {
  it('열 수 없는 파일만 고르면 이유가 오류/건너뜀으로 나온다', async () => {
    try {
      const r = await openVectorFiles([text('a.geojson', ''), text('b.gpkg', 'x'), text('c.dbf', 'x')]);
      expect(r.items).toHaveLength(0);
      expect(r.errors.join('\n')).toMatch(/a\.geojson: 비어 있는 파일/);
      const out = explainNoItems({ errors: r.errors, skipped: r.skipped });
      expect(out.join('\n')).toMatch(/GeoPackage/);
      expect(out.join('\n')).toMatch(/속성 파일\(\.dbf\)만 있고/);
      r.release();
    } finally {
      resetPool();
    }
  });

  it('ZIP 이 깨졌으면 파일 이름이 겹치지 않게 한 번만 붙는다', async () => {
    try {
      const r = await openVectorFiles([text('broken.zip', '이건 zip 이 아닙니다')]);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0].startsWith('broken.zip: ')).toBe(true);
      expect(r.errors[0]).not.toMatch(/broken\.zip: broken\.zip/);
      r.release();
    } finally {
      resetPool();
    }
  });
});
