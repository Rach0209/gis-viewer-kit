import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classifyDrop } from './dropClassify.js';
import { buildCollection, collectGroups, readRaw, readRaws } from './vectorParse.js';
import { SAMPLES, sampleUrl } from './samples.js';
import { parseDemTextFile } from './demText.js';
import { parseWorldFile, worldFileBbox } from './rasterCore.js';

const DIR = path.join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public', 'samples');
const read = (name) => fs.readFileSync(path.join(DIR, name));
const asFile = (name) => {
  const buf = read(name);
  return Object.assign(new Blob([buf]), { name, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
};

describe('예제 목록', () => {
  it('모든 샘플 파일이 public/samples 에 있고 아이디가 겹치지 않는다', () => {
    expect(new Set(SAMPLES.map((s) => s.id)).size).toBe(SAMPLES.length);
    for (const s of SAMPLES) for (const f of s.files) expect(fs.existsSync(path.join(DIR, f)), `${s.id}: ${f}`).toBe(true);
  });

  it('샘플 전체가 작다 (사이트에 함께 올라간다)', () => {
    const total = fs.readdirSync(DIR).reduce((a, f) => a + fs.statSync(path.join(DIR, f)).size, 0);
    expect(total).toBeLessThan(400_000);
  });

  it('주소는 하위 경로 기준이고 한글 이름은 인코딩한다', () => {
    expect(sampleUrl('./', '서울 명소.csv')).toBe('./samples/%EC%84%9C%EC%9A%B8%20%EB%AA%85%EC%86%8C.csv');
  });
});

describe('예제가 실제로 열린다 (읽기 시험)', () => {
  const vectorSamples = SAMPLES.filter((s) => s.kind === 'vector');
  it.each(vectorSamples.map((s) => [s.id, s]))('벡터 %s: 피처가 있고 서울 근처에 놓인다', async (_id, s) => {
    const { groups } = await collectGroups(s.files.map(asFile));
    expect(groups.length).toBe(1);
    const { raws } = await readRaws(groups[0]); // GeoPackage는 표마다 하나라 여러 개일 수 있다
    expect(raws.length).toBeGreaterThan(0);
    for (const raw of raws) {
      const { info } = buildCollection(raw);
      expect(info.count).toBeGreaterThan(0);
      expect(info.center.lon).toBeGreaterThan(126.9);
      expect(info.center.lon).toBeLessThan(127.1);
      expect(info.center.lat).toBeGreaterThan(37.5);
      expect(info.center.lat).toBeLessThan(37.6);
      expect(info.warnings.filter((w) => !w.includes('추정'))).toEqual([]);
    }
  });

  it('GeoPackage 샘플: 표 4개가 레이어 4개로 나오고, 서로 다른 좌표계(5186·4326)가 파일 안의 정의로 읽히며, 높이는 비행경로 표에만 있다', async () => {
    const { groups } = await collectGroups([asFile('서울-지도.gpkg')]);
    const { raws } = await readRaws(groups[0]);
    const built = raws.map((r) => buildCollection(r).info);
    expect(built.map((i) => i.name)).toEqual(['서울-지도.gpkg / 비행경로(높이)', '서울-지도.gpkg / 명소', '서울-지도.gpkg / 산책로(경위도)', '서울-지도.gpkg / 구역']); // 표 이름(flight, places, walk, zones) 순서
    expect(built.map((i) => i.crs.code)).toEqual(['EPSG:4326', 'EPSG:5186', 'EPSG:4326', 'EPSG:5186']);
    expect(built.every((i) => i.crs.source === 'gpkg')).toBe(true);
    expect(built.map((i) => i.count)).toEqual([1, 8, 1, 3]);
    expect(built.map((i) => i.hasHeights)).toEqual([true, false, false, false]);
    const zs = buildCollection(raws[0]).collection.features[0].geometry.coordinates.map((c) => c[2]);
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...zs)).toBeLessThanOrEqual(300);
    expect(Math.max(...zs)).toBeGreaterThan(250);
    const places = buildCollection(raws[1]).collection.features;
    expect(places[0].properties).toMatchObject({ 이름: '서울시청', 분류: '관공서' });
    expect(places[0].geometry.coordinates[0]).toBeCloseTo(126.9784, 3); // 5186 미터 좌표에서 되돌린 경위도가 CSV의 같은 곳과 맞는다
    expect(places[0].geometry.coordinates[1]).toBeCloseTo(37.5666, 3);
  });

  it('높이 KML 샘플: 높이가 100~300 m 로 있어 레이어 줄의 "높이" 토글이 나타난다', async () => {
    const { groups } = await collectGroups([asFile('서울-비행경로.kml')]);
    const { info, collection } = buildCollection(await readRaw(groups[0]));
    expect(info.hasHeights).toBe(true);
    const line = collection.features.find((f) => f.geometry.type === 'LineString');
    const zs = line.geometry.coordinates.map((c) => c[2]);
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...zs)).toBeLessThanOrEqual(300);
    expect(Math.max(...zs)).toBeGreaterThan(250);
  });

  it('CSV 는 열을 이름으로 찾고 한글 속성을 읽는다', async () => {
    const { groups } = await collectGroups([asFile('서울-명소.csv')]);
    const { info, collection } = buildCollection(await readRaw(groups[0]));
    expect(info.csv).toMatchObject({ xCol: 1, yCol: 2, header: true, rows: 8 });
    expect(collection.features[0].properties).toMatchObject({ 이름: '서울시청', 분류: '관공서' });
  });

  it('이미지 샘플: 월드파일이 5186 서울 도심 1km 를 가리키고, 드롭하면 한 묶음으로 분류된다', () => {
    const bbox = worldFileBbox(parseWorldFile(read('서울-항공사진.pgw').toString()), 500, 500);
    expect(bbox).toEqual([197600, 551400, 198600, 552400]);
    const plan = classifyDrop(['a/서울-항공사진.png', 'a/서울-항공사진.pgw', 'a/서울-항공사진.prj']);
    expect(plan.rasters.length).toBe(1);
    expect(plan.rasters[0].paths).toHaveLength(3);
    expect(plan.ignored).toEqual([]);
    const png = read('서울-항공사진.png');
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('DEM 샘플: 50x50 격자이고 높이가 변한다', async () => {
    const r = await parseDemTextFile(asFile('가상-언덕-DEM.txt'));
    expect(r.grid.width).toBe(50);
    expect(r.grid.height).toBe(50);
    expect(r.stats.max - r.stats.min).toBeGreaterThan(40);
  });

  it('glb 샘플: glb 머리글(glTF)', () => {
    expect(read('집-5186.glb').subarray(0, 4).toString()).toBe('glTF');
  });
});
