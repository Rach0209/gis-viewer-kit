import { describe, expect, it } from 'vitest';
import { isKnownCrs } from './crsList.js';
import { fetchEpsgDef, parseCrsText, resolveCrsInput, restoreRecentCrs, wktNameAndCode } from './crsLookup.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
};
const LAMBERT = '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs';
/** epsg.io 를 흉내 내는 가짜 fetch. calls 에 부른 주소를 모은다 */
const fakeFetch = (routes, calls = []) => async (url) => {
  calls.push(url);
  const hit = Object.entries(routes).find(([k]) => url.includes(k));
  if (!hit) return { ok: false, status: 404, text: async () => '' };
  return { ok: true, status: 200, text: async () => hit[1] };
};

describe('parseCrsText', () => {
  it.each([
    ['EPSG:2154', { kind: 'epsg', code: 'EPSG:2154' }],
    ['epsg:2154', { kind: 'epsg', code: 'EPSG:2154' }],
    ['EPSG 2154', { kind: 'epsg', code: 'EPSG:2154' }],
    ['  2154 ', { kind: 'epsg', code: 'EPSG:2154' }],
    ['', { kind: 'empty' }],
    ['   ', { kind: 'empty' }],
    ['안녕', { kind: 'invalid' }],
    ['12', { kind: 'invalid' }],
  ])('%j', (input, expected) => {
    expect(parseCrsText(input)).toEqual(expected);
  });
  it('PROJ 문자열과 WKT 를 알아본다', () => {
    expect(parseCrsText('+proj=utm   +zone=33 +datum=WGS84').kind).toBe('proj');
    expect(parseCrsText('PROJCS["x",GEOGCS["y"]]').kind).toBe('wkt');
    expect(parseCrsText('geogcs["x"]').kind).toBe('wkt');
  });
});

describe('wktNameAndCode', () => {
  it('이름과 마지막(좌표계 전체) EPSG 코드를 꺼낸다', () => {
    const wkt = 'PROJCS["Korea_2000_Central_Belt_2010",GEOGCS["GCS_Korea_2000",AUTHORITY["EPSG","4737"]],PARAMETER["x",1],AUTHORITY["EPSG","5186"]]';
    expect(wktNameAndCode(wkt)).toEqual({ name: 'Korea_2000_Central_Belt_2010', code: 'EPSG:5186' });
    expect(wktNameAndCode('PROJCS["abc",GEOGCS["g"]]')).toEqual({ name: 'abc', code: null });
  });
});

describe('resolveCrsInput', () => {
  it('목록에 있는 번호는 인터넷 없이 바로', async () => {
    const calls = [];
    const info = await resolveCrsInput('5186', { fetchImpl: fakeFetch({}, calls), storage: memStorage() });
    expect(info.code).toBe('EPSG:5186');
    expect(calls).toEqual([]);
  });

  it('UTM 존 번호도 인터넷 없이', async () => {
    const calls = [];
    const info = await resolveCrsInput('EPSG:32610', { fetchImpl: fakeFetch({}, calls), storage: memStorage() });
    expect(info.label).toContain('UTM 10N');
    expect(calls).toEqual([]);
  });

  it('모르는 번호는 인터넷에서 정의를 가져와 등록하고, 두 번째부터는 가져오지 않는다', async () => {
    const storage = memStorage();
    const calls = [];
    const f = fakeFetch({ '/9967.proj4': LAMBERT, '/9967.json': JSON.stringify({ name: '시험 좌표계' }) }, calls);
    const a = await resolveCrsInput('EPSG:9967', { fetchImpl: f, storage });
    expect(a).toMatchObject({ code: 'EPSG:9967', label: '시험 좌표계 (EPSG:9967)', geographic: false });
    expect(isKnownCrs('EPSG:9967')).toBe(true);
    expect(calls.length).toBe(2);
    await resolveCrsInput('EPSG:9967', { fetchImpl: f, storage });
    expect(calls.length).toBe(2);
    expect(storage.map.get('gis-viewer-kit:crsdef:EPSG:9967')).toBeTruthy();
  });

  it('epsg.io 가 안 되면 spatialreference.org 로 넘어간다', async () => {
    const calls = [];
    const f = fakeFetch({ 'spatialreference.org/ref/epsg/9968/proj4.txt': LAMBERT }, calls);
    const info = await resolveCrsInput('9968', { fetchImpl: f, storage: memStorage() });
    expect(info.code).toBe('EPSG:9968');
    expect(calls.some((u) => u.includes('spatialreference.org'))).toBe(true);
  });

  it('둘 다 안 되면 직접 붙여 넣으라고 안내한다', async () => {
    await expect(resolveCrsInput('EPSG:9969', { fetchImpl: fakeFetch({}), storage: memStorage() })).rejects.toThrow(/직접 붙여 넣으세요/);
  });

  it('PROJ 문자열은 코드를 만들어 등록한다 (같은 정의는 같은 코드)', async () => {
    const a = await resolveCrsInput(LAMBERT, { storage: memStorage() });
    const b = await resolveCrsInput(LAMBERT, { storage: memStorage() });
    expect(a.code).toMatch(/^USER:/);
    expect(b.code).toBe(a.code);
    expect(a.label).toContain('직접 입력');
  });

  it('WKT: 이름을 라벨로, EPSG 권한 코드가 있으면 그 번호로 등록한다', async () => {
    const wkt =
      'PROJCS["Test_Belt",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",9.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0],AUTHORITY["EPSG","9970"]]';
    const info = await resolveCrsInput(wkt, { storage: memStorage() });
    expect(info.code).toBe('EPSG:9970');
    expect(info.label).toBe('Test_Belt (EPSG:9970)');
    expect(info.geographic).toBe(false);
  });

  it('해석할 수 없는 정의·빈 입력·이상한 글은 오류', async () => {
    await expect(resolveCrsInput('+proj=nonsense', { storage: memStorage() })).rejects.toThrow();
    await expect(resolveCrsInput('', {})).rejects.toThrow(/입력하세요/);
    await expect(resolveCrsInput('hello', {})).rejects.toThrow(/알아볼 수 없는/);
  });

  it('직접 추가한 좌표계는 저장했다가 다음에 되살린다', async () => {
    const storage = memStorage();
    await resolveCrsInput(LAMBERT, { storage });
    const restored = restoreRecentCrs(storage);
    expect(restored.length).toBe(1);
    expect(restored[0].code).toMatch(/^USER:/);
  });

  it('저장소가 깨져 있어도 죽지 않는다', () => {
    expect(restoreRecentCrs({ getItem: () => '{깨짐' })).toEqual([]);
  });
});

describe('fetchEpsgDef', () => {
  it('fetch 가 없는 환경이면 알려 준다', async () => {
    await expect(fetchEpsgDef('EPSG:1234', null)).rejects.toThrow(/가져올 수 없습니다/);
  });
});
