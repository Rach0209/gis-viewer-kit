/**
 * sql.js(SQLite를 WebAssembly로 돌리는 라이브러리)를 처음 필요할 때 한 번만 불러온다.
 * GeoPackage(.gpkg)가 SQLite 파일이라서 쓴다. gpkgRead.js 가 동적으로 불러오므로 GeoPackage를 열 때만 내려받는다.
 *
 * 브라우저(워커 포함)에서는 번들러가 wasm 파일 주소를 알려 주고, Node(시험)에서는 라이브러리가 알아서 찾는다.
 */
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';

let sqlPromise = null;

export function loadSql() {
  if (!sqlPromise) {
    const inNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
    sqlPromise = initSqlJs(inNode ? {} : { locateFile: () => wasmUrl }).catch((e) => {
      sqlPromise = null; // 다음에 다시 시도할 수 있게
      throw e;
    });
  }
  return sqlPromise;
}
