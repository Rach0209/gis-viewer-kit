import { describe, expect, it } from 'vitest';
import { buildCollection, collectGroups, readRaws } from './vectorParse.js';
import { readGpkg } from './gpkgRead.js';
import { SRS, makeGpkg, toGpkgBlob } from './gpkgFixture.js';

const file = (name, bytes) => ({ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

/** gpkg 바이트를 열기 흐름(collectGroups → readRaws → buildCollection)으로 읽는다 */
async function open(bytes, name = 'a.gpkg', opts) {
  const { groups } = await collectGroups([file(name, bytes)]);
  expect(groups).toHaveLength(1);
  const { raws } = await readRaws(groups[0]);
  return raws.map((raw) => ({ raw, ...buildCollection(raw, opts) }));
}

const seoul5186 = { type: 'Point', coordinates: [198000, 551800] };

describe('GeoPackage 읽기', () => {
  it('좌표계(EPSG)를 파일에서 읽어 경위도로 바꾸고, 한글 속성을 그대로 읽는다', async () => {
    const bytes = await makeGpkg({
      layers: [{ table: '건물', srsId: 5186, rows: [{ geometry: seoul5186, props: { 이름: '시청', 층수: 12, 비고: null } }, { geometry: { type: 'Point', coordinates: [198100, 551900] }, props: { 이름: '광장', 층수: 1 } }] }],
    });
    const [r] = await open(bytes);
    expect(r.info.source).toBe('GeoPackage');
    expect(r.info.count).toBe(2);
    expect(r.info.crs.code).toBe('EPSG:5186');
    expect(r.info.crs.source).toBe('gpkg');
    const [lon, lat] = r.collection.features[0].geometry.coordinates;
    expect(lon).toBeGreaterThan(126.9);
    expect(lon).toBeLessThan(127.1);
    expect(lat).toBeGreaterThan(37.5);
    expect(lat).toBeLessThan(37.6);
    expect(r.collection.features[0].properties).toMatchObject({ fid: 1, 이름: '시청', 층수: 12, 비고: null });
    expect(r.info.warnings).toEqual([]);
    expect(r.info.encoding).toBeNull(); // SQLite 는 늘 UTF-8 이라 인코딩을 고르지 않는다
  });

  it('경위도(4326) 표는 그대로 둔다', async () => {
    const bytes = await makeGpkg({ layers: [{ table: 'p', srsId: 4326, rows: [{ geometry: { type: 'Point', coordinates: [127.1, 37.5] } }] }] });
    const [r] = await open(bytes);
    expect(r.info.crs.code).toBe('EPSG:4326');
    expect(r.collection.features[0].geometry.coordinates).toEqual([127.1, 37.5]);
  });

  it('표가 여러 개면 표마다 레이어로 나온다 (이름: 파일 / 표)', async () => {
    const bytes = await makeGpkg({
      layers: [
        { table: 'roads', identifier: '도로', srsId: 4326, rows: [{ geometry: { type: 'LineString', coordinates: [[127, 37], [127.1, 37.1]] } }] },
        { table: 'sites', identifier: '부지', srsId: 4326, rows: [{ geometry: { type: 'Polygon', coordinates: [[[127, 37], [127.1, 37], [127.1, 37.1], [127, 37]]] } }] },
      ],
    });
    const rs = await open(bytes);
    expect(rs.map((r) => r.raw.name)).toEqual(['a.gpkg / 도로', 'a.gpkg / 부지']);
    expect(rs.map((r) => r.info.geometryTypes)).toEqual([['LineString'], ['Polygon']]);
  });

  it('이진 열(사진 등)은 속성에서 빼고, 높이는 유지한다', async () => {
    const bytes = await makeGpkg({
      layers: [{ table: 't', srsId: 4326, z: true, columns: ['name', 'photo'], rows: [{ geometry: { type: 'Point', coordinates: [127, 37, 55] }, props: { name: 'a', photo: Uint8Array.from([1, 2, 3]) } }] }],
    });
    const [r] = await open(bytes);
    expect(r.collection.features[0].properties).toEqual({ fid: 1, name: 'a' });
    expect(r.info.hasHeights).toBe(true);
    expect(r.collection.features[0].geometry.coordinates).toEqual([127, 37, 55]);
  });

  it('곡선 도형은 건너뛰고 알려 준다. 도형이 없는 행도 센다', async () => {
    const curve = new DataView(new ArrayBuffer(9));
    curve.setUint8(0, 1);
    curve.setUint32(1, 8, true);
    const blob = Uint8Array.from([0x47, 0x50, 0, 1, 0xe6, 0x10, 0, 0, ...new Uint8Array(curve.buffer)]);
    const bytes = await makeGpkg({
      layers: [{ table: 't', srsId: 4326, rows: [{ geometry: { type: 'Point', coordinates: [127, 37] } }, { raw: blob }, { geometry: null }] }],
    });
    const [r] = await open(bytes);
    expect(r.info.count).toBe(3);
    expect(r.info.emptyCount).toBe(2);
    expect(r.info.warnings.join('\n')).toMatch(/CircularString 도형 1개는 지원하지 않아/);
  });

  it('EPSG 번호가 아닌 정의(WKT)만 있는 좌표계도 쓴다', async () => {
    const custom = { ...SRS[5186], srs_id: 990001, srs_name: '사용자', organization: 'NONE', organization_coordsys_id: 990001 };
    const bytes = await makeGpkg({ srs: [custom], layers: [{ table: 't', srsId: 990001, rows: [{ geometry: seoul5186 }] }] });
    const [r] = await open(bytes);
    expect(r.info.crs.source).toBe('gpkg');
    expect(r.info.crs.label).toMatch(/Korea 2000/);
    expect(r.collection.features[0].geometry.coordinates[0]).toBeGreaterThan(126.9);
  });

  it('좌표계를 모르면(srs_id -1, 정의 undefined) 좌표 범위로 추정한다', async () => {
    const undef = { srs_name: 'Undefined', srs_id: -1, organization: 'NONE', organization_coordsys_id: -1, definition: 'undefined' };
    const bytes = await makeGpkg({ srs: [undef], layers: [{ table: 't', srsId: -1, rows: [{ geometry: seoul5186 }] }] });
    const [r] = await open(bytes);
    expect(r.info.crs.source).toBe('guess');
    expect(r.info.warnings.join('\n')).toMatch(/추정/);
  });

  it('고른 좌표계로 덮어쓸 수 있다', async () => {
    const bytes = await makeGpkg({ layers: [{ table: 't', srsId: 5186, rows: [{ geometry: seoul5186 }] }] });
    const [r] = await open(bytes, 'a.gpkg', { crs: 'EPSG:5179' });
    expect(r.info.crs.source).toBe('user');
    expect(r.info.crs.code).toBe('EPSG:5179');
  });

  it('도형이 없는 표와 타일 표는 열지 않고 알려 준다', async () => {
    const bytes = await makeGpkg({
      layers: [{ table: 'p', srsId: 4326, rows: [{ geometry: { type: 'Point', coordinates: [127, 37] } }] }],
      extraSql: "CREATE TABLE notes (id INTEGER); INSERT INTO gpkg_contents (table_name, data_type, identifier) VALUES ('notes','attributes','notes'); CREATE TABLE tl (id INTEGER); INSERT INTO gpkg_contents (table_name, data_type, identifier) VALUES ('tl','tiles','tl');",
    });
    const [r] = await open(bytes);
    expect(r.info.warnings.join('\n')).toMatch(/다른 표 2개.*notes \(attributes\)/);
  });

  it('일반 SQLite 파일, 타일만 있는 파일, 깨진 파일은 이유를 알려 준다', async () => {
    const { loadSql } = await import('./sqlLoader.js');
    const SQL = await loadSql();
    const plain = new SQL.Database();
    plain.run('CREATE TABLE a (x)');
    const plainBytes = plain.export();
    plain.close();
    await expect(readGpkg(plainBytes, 'a.gpkg')).rejects.toThrow(/GeoPackage가 아닙니다/);

    const tilesOnly = await makeGpkg({
      layers: [],
      extraSql: "CREATE TABLE tl (id INTEGER); INSERT INTO gpkg_contents (table_name, data_type, identifier) VALUES ('tl','tiles','tl');",
    });
    await expect(readGpkg(tilesOnly, 'a.gpkg')).rejects.toThrow(/타일.*벡터가 없습니다/s);

    await expect(readGpkg(Uint8Array.from([1, 2, 3, 4, 5]), 'a.gpkg')).rejects.toThrow(/GeoPackage를 읽을 수 없습니다.*→/s);
  });

  it('너무 큰 파일은 읽기 전에 거절한다', async () => {
    await expect(readGpkg(new Uint8Array(2000), 'big.gpkg', { maxBytes: 1000 })).rejects.toThrow(/너무 큽니다.*→/s);
  });

  it('표 이름에 따옴표가 있어도 읽는다', async () => {
    const bytes = await makeGpkg({ layers: [{ table: 'a"b', srsId: 4326, rows: [{ geometry: { type: 'Point', coordinates: [127, 37] } }] }] });
    const [r] = await open(bytes);
    expect(r.info.count).toBe(1);
    expect(toGpkgBlob(null, 4326).length).toBeGreaterThan(0);
  });

  it('빈 파일(0바이트)은 비어 있다고 알려 준다', async () => {
    const { groups } = await collectGroups([file('e.gpkg', new Uint8Array(0))]);
    await expect(readRaws(groups[0])).rejects.toThrow(/비어 있는 파일/);
  });
});
