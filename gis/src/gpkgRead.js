/**
 * GeoPackage(.gpkg) 파일을 읽어 지형지물 테이블마다 "원본"(vectorParse.js 의 raw) 하나로 만든다. Cesium·DOM을 모른다.
 *
 * GeoPackage 는 SQLite 파일이다. 파일 전체를 메모리에 올려 sql.js(wasm)로 열고, 표 목록(gpkg_contents)과 도형 열
 * (gpkg_geometry_columns)과 좌표계(gpkg_spatial_ref_sys)를 읽은 뒤, 표마다 행을 훑어 GeoJSON 피처로 만든다.
 * 다 읽으면 데이터베이스를 바로 닫아 메모리를 돌려준다 (화면에는 피처만 남는다).
 *
 * 좌표는 파일에 든 그대로(좌표 변환 전)이고, 어떤 좌표계인지는 raw.srs 에 담아 vectorParse.js 가 변환한다.
 */
import { problem } from './diagnose.js';
import { UnsupportedGeometry, parseGpkgGeometry } from './gpkgGeometry.js';
import { loadSql } from './sqlLoader.js';

/** 이보다 큰 파일은 열지 않는다: 파일 전체를 메모리에 올리고 wasm 쪽에 한 번 더 복사하므로 실제로는 두 배 안팎을 쓴다 */
export const GPKG_MAX_BYTES = 300 * 1024 * 1024;

const quote = (name) => `"${String(name).replaceAll('"', '""')}"`;
const mb = (n) => `${Math.round(n / 1024 / 1024)}MB`;

/** 질의 결과를 [{열: 값}] 으로 */
function rows(db, sql, params) {
  const stmt = db.prepare(sql);
  try {
    if (params) stmt.bind(params);
    const out = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    return out;
  } finally {
    stmt.free();
  }
}

const hasTable = (db, name) => rows(db, "SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name = ?", [name]).length > 0;

/**
 * @param {ArrayBuffer|Uint8Array} buffer .gpkg 파일 내용
 * @param {string} fileName 화면에 보일 이름 (확장자 없이)
 * @returns {Promise<{raws: object[], skippedTables: string[]}>}
 */
export async function readGpkg(buffer, fileName, { maxBytes = GPKG_MAX_BYTES } = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length > maxBytes) {
    throw new Error(problem(`${fileName}: 파일이 너무 큽니다 (${mb(bytes.length)}). 브라우저 메모리로는 ${mb(maxBytes)}까지 열 수 있습니다.`, 'QGIS에서 필요한 레이어나 지역만 골라 새 GeoPackage·GeoJSON으로 내보낸 뒤 여세요.'));
  }
  const SQL = await loadSql();
  let db;
  try {
    db = new SQL.Database(bytes);
    if (!hasTable(db, 'gpkg_contents') || !hasTable(db, 'gpkg_geometry_columns')) {
      throw new Error(problem(`${fileName}: GeoPackage가 아닙니다 (gpkg_contents 표가 없는 일반 SQLite 파일).`, 'QGIS 등에서 GeoPackage(.gpkg)로 내보낸 파일이어야 합니다. SpatiaLite 데이터베이스는 열 수 없습니다.'));
    }
    return readTables(db, fileName);
  } catch (e) {
    if (String(e?.message).includes('\n→ ')) throw e; // 이미 원인과 해결을 담은 안내
    throw new Error(problem(`${fileName}: GeoPackage를 읽을 수 없습니다 (${e?.message ?? e}).`, '파일이 중간에 끊겼거나 SQLite/GeoPackage가 아닐 수 있습니다. QGIS에서 열어 보고, 열리지 않으면 원본을 다시 받으세요.'));
  } finally {
    db?.close();
  }
}

function readTables(db, fileName) {
  const layers = rows(
    db,
    "SELECT c.table_name AS tbl, c.identifier AS ident, c.data_type AS dt, g.column_name AS col, g.srs_id AS srs FROM gpkg_contents c LEFT JOIN gpkg_geometry_columns g ON g.table_name = c.table_name ORDER BY c.table_name",
  );
  const featureLayers = layers.filter((l) => String(l.dt).toLowerCase() === 'features' && l.col);
  const skippedTables = layers.filter((l) => !featureLayers.includes(l)).map((l) => `${l.tbl} (${l.dt})`);
  if (!featureLayers.length) {
    const kinds = [...new Set(layers.map((l) => l.dt))];
    const what = kinds.includes('tiles') || kinds.some((k) => /gridded/.test(String(k))) ? '지도 타일(래스터)만 들어 있어' : '도형이 든 표가 없어';
    throw new Error(problem(`${fileName}: GeoPackage에 ${what} 지도에 올릴 수 있는 벡터가 없습니다.`, '타일은 벡터가 아니라 열 수 없습니다. 도형 표를 담은 GeoPackage인지 QGIS에서 확인하세요.'));
  }

  const raws = [];
  for (const l of featureLayers) {
    raws.push(readLayer(db, l, featureLayers.length > 1 ? `${fileName} / ${l.ident || l.tbl}` : fileName));
  }
  // 열지 않은 표(타일, 도형 없는 속성 표 등)는 첫 레이어의 안내로 알려 준다
  if (skippedTables.length) {
    const shown = skippedTables.slice(0, 3).join(', ') + (skippedTables.length > 3 ? ` 외 ${skippedTables.length - 3}개` : '');
    raws[0].readWarnings.push(problem(`이 파일의 다른 표 ${skippedTables.length}개는 도형이 없거나 지도 타일이라 열지 않았습니다: ${shown}`, ''));
  }
  return { raws, skippedTables };
}

function srsOf(db, srsId) {
  const r = rows(db, 'SELECT organization AS org, organization_coordsys_id AS code, definition AS def FROM gpkg_spatial_ref_sys WHERE srs_id = ?', [srsId])[0];
  if (!r) return { id: srsId, code: null, wkt: null };
  return { id: srsId, code: String(r.org).toLowerCase() === 'epsg' && r.code > 0 ? `EPSG:${r.code}` : null, wkt: r.def && r.def !== 'undefined' ? String(r.def) : null };
}

function readLayer(db, layer, name) {
  const features = [];
  const unsupported = new Map(); // 도형 종류 -> 개수
  let broken = 0;
  const stmt = db.prepare(`SELECT * FROM ${quote(layer.tbl)}`);
  try {
    while (stmt.step()) {
      const row = stmt.getAsObject();
      let geometry = null;
      const blob = row[layer.col];
      if (blob instanceof Uint8Array && blob.length) {
        try {
          geometry = parseGpkgGeometry(blob).geometry;
        } catch (e) {
          if (e instanceof UnsupportedGeometry) unsupported.set(e.typeName, (unsupported.get(e.typeName) ?? 0) + 1);
          else broken++;
        }
      }
      const properties = {};
      for (const k of Object.keys(row)) {
        if (k === layer.col || row[k] instanceof Uint8Array) continue; // 도형 열과 그 밖의 이진 열(사진 등)은 속성으로 쓰지 않는다
        properties[k] = row[k];
      }
      features.push({ type: 'Feature', geometry, properties });
    }
  } finally {
    stmt.free();
  }

  const readWarnings = [];
  for (const [type, n] of unsupported) {
    readWarnings.push(problem(`${type} 도형 ${n.toLocaleString('ko-KR')}개는 지원하지 않아 건너뛰었습니다 (곡선 도형은 읽지 못합니다).`, 'QGIS에서 "곡선을 선분으로 바꾸기(Segmentize)" 후 다시 내보내거나 SHP/GeoJSON으로 내보내세요.'));
  }
  if (broken) readWarnings.push(problem(`도형이 깨진 행 ${broken.toLocaleString('ko-KR')}개를 건너뛰었습니다.`, '파일이 손상됐을 수 있습니다. 원본을 다시 받아 보세요.'));

  return {
    kind: 'geojson',
    source: 'GeoPackage',
    name,
    geojson: { type: 'FeatureCollection', features },
    srs: srsOf(db, layer.srs),
    readWarnings,
    dbfBuf: null,
    prjText: null,
    cpgText: null,
  };
}
