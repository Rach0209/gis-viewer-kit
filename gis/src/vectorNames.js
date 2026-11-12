/**
 * 벡터 파일 이름 규칙. 무거운 라이브러리(shpjs, proj4, ZIP)를 끌어오지 않아서 화면 쪽에서도 가볍게 쓴다.
 * 실제 읽기는 워커에서 vectorParse.js 가 한다.
 */
const VECTOR_EXT = /\.(shp|dbf|prj|cpg|shx|geojson|json|zip|kml|kmz|gpx|csv|gpkg|sld)$/i;
export const isVectorFileName = (name) => VECTOR_EXT.test(name);

export const baseOf = (path) => path.split('/').pop();
export const extOf = (path) => (baseOf(path).includes('.') ? baseOf(path).split('.').pop().toLowerCase() : '');
export const stemOf = (path) => {
  const b = baseOf(path);
  const dot = b.lastIndexOf('.');
  const dir = path.slice(0, path.length - b.length);
  return dir + (dot < 0 ? b : b.slice(0, dot));
};

const SHP_PARTS = ['shp', 'dbf', 'prj', 'cpg', 'shx'];

/**
 * 파일 이름만 보고 "한 번에 읽을 묶음"으로 나눈다 (읽기 전에 계획만 세운다).
 *  - zip 하나, GeoJSON 하나, 같은 이름의 SHP 부품들이 각각 한 묶음 -> 묶음마다 다른 워커가 동시에 읽는다.
 *  - .sld 는 묶음과 별개로 모아 둔다 (어느 데이터에나 고를 수 있다).
 *  - 그 밖의 파일은 건너뛴 목록에 넣는다.
 * @param {Array<{name:string}>} files
 * @returns {{sources: Array<{label:string, files:Array<{name:string}>}>, styles: Array<{name:string}>, skipped: string[]}}
 */
export function planSources(files) {
  const sources = [];
  const byStem = new Map();
  const styles = [];
  const skipped = [];
  for (const f of files) {
    const ext = extOf(f.name);
    if (['zip', 'kmz', 'geojson', 'json', 'kml', 'gpx', 'csv', 'gpkg'].includes(ext)) sources.push({ label: baseOf(f.name), files: [f] });
    else if (ext === 'sld') styles.push(f);
    else if (SHP_PARTS.includes(ext)) {
      const key = stemOf(f.name).toLowerCase();
      if (!byStem.has(key)) {
        const src = { label: baseOf(stemOf(f.name)), files: [] };
        byStem.set(key, src);
        sources.push(src);
      }
      byStem.get(key).files.push(f);
    } else skipped.push(f.name);
  }
  return { sources, styles, skipped };
}
