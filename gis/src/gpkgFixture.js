/**
 * 시험·샘플용 GeoPackage 만들기 (앱에서는 쓰지 않는다 — 번들에 들어가지 않는다).
 * QGIS 없이 같은 모양의 .gpkg 를 만들어 읽기 시험을 반복할 수 있게 한다. 규격의 최소 부분(좌표계 표, 내용 표, 도형 열 표 + 지형지물 표)만 만든다.
 */
// sql.js 는 부르는 쪽이 넘겨 줄 수 있다 (scripts/make-samples.mjs 는 번들러 없이 Node 로 돌아서, 번들러용 sqlLoader.js 를 쓸 수 없다)

const f64 = (n) => {
  const b = new ArrayBuffer(8);
  new DataView(b).setFloat64(0, n, true);
  return [...new Uint8Array(b)];
};
const u32 = (n) => {
  const b = new ArrayBuffer(4);
  new DataView(b).setUint32(0, n >>> 0, true);
  return [...new Uint8Array(b)];
};
const i32 = (n) => {
  const b = new ArrayBuffer(4);
  new DataView(b).setInt32(0, n, true);
  return [...new Uint8Array(b)];
};

const TYPE_CODE = { Point: 1, LineString: 2, Polygon: 3, MultiPoint: 4, MultiLineString: 5, MultiPolygon: 6, GeometryCollection: 7 };

const coord = (c, z) => (z ? [...f64(c[0]), ...f64(c[1]), ...f64(c[2] ?? 0)] : [...f64(c[0]), ...f64(c[1])]);
const coords = (cs, z) => [...u32(cs.length), ...cs.flatMap((c) => coord(c, z))];

/** GeoJSON 도형 -> ISO WKB (little endian). z=true 면 세 번째 값(높이)까지 쓴다 */
export function toWkb(g, z = false) {
  const code = TYPE_CODE[g.type] + (z ? 1000 : 0);
  const head = [1, ...u32(code)];
  switch (g.type) {
    case 'Point':
      return [...head, ...coord(g.coordinates, z)];
    case 'LineString':
      return [...head, ...coords(g.coordinates, z)];
    case 'Polygon':
      return [...head, ...u32(g.coordinates.length), ...g.coordinates.flatMap((r) => coords(r, z))];
    case 'MultiPoint':
      return [...head, ...u32(g.coordinates.length), ...g.coordinates.flatMap((c) => toWkb({ type: 'Point', coordinates: c }, z))];
    case 'MultiLineString':
      return [...head, ...u32(g.coordinates.length), ...g.coordinates.flatMap((c) => toWkb({ type: 'LineString', coordinates: c }, z))];
    case 'MultiPolygon':
      return [...head, ...u32(g.coordinates.length), ...g.coordinates.flatMap((c) => toWkb({ type: 'Polygon', coordinates: c }, z))];
    case 'GeometryCollection':
      return [...head, ...u32(g.geometries.length), ...g.geometries.flatMap((x) => toWkb(x, z))];
    default:
      throw new Error(`만들 수 없는 도형: ${g.type}`);
  }
}

/** GeoJSON 도형 -> GeoPackage 도형 값 (GP 머리글, 범위 없음). envelopeXY=true 면 범위(32바이트)도 넣는다 */
export function toGpkgBlob(geometry, srsId, { z = false, envelopeXY = false, bigEndianHeader = false } = {}) {
  if (!geometry) return Uint8Array.from([0x47, 0x50, 0, 0x01 | 0x10, ...i32(srsId)]); // 빈 도형 표시
  const flags = (bigEndianHeader ? 0 : 1) | (envelopeXY ? 1 << 1 : 0);
  const srs = bigEndianHeader ? [...new Uint8Array(new Int32Array([srsId]).buffer)].reverse() : i32(srsId);
  const env = envelopeXY ? [0, 0, 0, 0].flatMap(() => f64(0)) : [];
  return Uint8Array.from([0x47, 0x50, 0, flags, ...srs, ...env, ...toWkb(geometry, z)]);
}

export const SRS = {
  4326: { srs_name: 'WGS 84', srs_id: 4326, organization: 'EPSG', organization_coordsys_id: 4326, definition: 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]' },
  5186: { srs_name: 'Korea 2000 / Central Belt 2010', srs_id: 5186, organization: 'EPSG', organization_coordsys_id: 5186, definition: 'PROJCS["Korea 2000 / Central Belt 2010",GEOGCS["Korea 2000",DATUM["Geocentric_datum_of_Korea",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",38],PARAMETER["central_meridian",127],PARAMETER["scale_factor",1],PARAMETER["false_easting",200000],PARAMETER["false_northing",600000],UNIT["metre",1]]' },
};

/**
 * @param {{layers: Array<{table:string, identifier?:string, geomType?:string, srsId:number, z?:boolean, columns?:string[], rows:Array<{geometry:object|null, props?:object}>, blobOptions?:object}>, srs?:object[], extraSql?:string}} spec
 * @param {object} [sqlJs] 이미 초기화한 sql.js (없으면 앱과 같은 sqlLoader 로 불러온다)
 * @returns {Promise<Uint8Array>} .gpkg 파일 내용
 */
export async function makeGpkg({ layers, srs = [], extraSql = '' }, sqlJs) {
  const SQL = sqlJs ?? (await (await import('./sqlLoader.js')).loadSql());
  const db = new SQL.Database();
  db.run('PRAGMA application_id = 1196444487; PRAGMA user_version = 10300;');
  db.run('CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT)');
  db.run("CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER)");
  db.run('CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL, PRIMARY KEY (table_name, column_name))');
  const known = new Set();
  for (const s of [...srs, ...layers.map((l) => SRS[l.srsId]).filter(Boolean)]) {
    if (known.has(s.srs_id)) continue;
    known.add(s.srs_id);
    db.run('INSERT INTO gpkg_spatial_ref_sys (srs_name, srs_id, organization, organization_coordsys_id, definition) VALUES (?,?,?,?,?)', [s.srs_name, s.srs_id, s.organization, s.organization_coordsys_id, s.definition]);
  }
  for (const l of layers) {
    const cols = l.columns ?? [...new Set(l.rows.flatMap((r) => Object.keys(r.props ?? {})))];
    const q = (n) => `"${n.replaceAll('"', '""')}"`;
    db.run(`CREATE TABLE ${q(l.table)} (fid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, geom BLOB${cols.map((c) => `, ${q(c)}`).join('')})`);
    db.run('INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id) VALUES (?,?,?,?)', [l.table, 'features', l.identifier ?? l.table, l.srsId]);
    db.run('INSERT INTO gpkg_geometry_columns VALUES (?,?,?,?,?,?)', [l.table, 'geom', l.geomType ?? 'GEOMETRY', l.srsId, l.z ? 1 : 0, 0]);
    const stmt = db.prepare(`INSERT INTO ${q(l.table)} (geom${cols.map((c) => `, ${q(c)}`).join('')}) VALUES (?${cols.map(() => ',?').join('')})`);
    for (const r of l.rows) stmt.run([r.raw ?? toGpkgBlob(r.geometry, l.srsId, { z: l.z, ...l.blobOptions }), ...cols.map((c) => r.props?.[c] ?? null)]);
    stmt.free();
  }
  if (extraSql) db.run(extraSql);
  const out = db.export();
  db.close();
  return out;
}
