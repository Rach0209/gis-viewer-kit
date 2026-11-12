/**
 * 벡터(GeoJSON/SHP/ZIP/KML/GPX/CSV/GeoPackage) 읽기 작업 — 워커 안에서 돈다 (Node 시험에서는 그 자리에서 돈다).
 * 읽은 원본(raw)은 이 모듈 안에 두고 화면에는 번호(id)만 준다. 인코딩·좌표계를 바꿔 다시 계산할 때
 * 큰 원본을 워커와 화면 사이로 왔다 갔다 하지 않게 하려는 것이다.
 */
import { registerCrs } from '../../../viewer/src/kit/crsList.js';
import { buildCollection, collectGroups, readRaws } from '../vectorParse.js';

const store = new Map();
let seq = 0;

/** 워커로 넘어온 파일({name, blob} 또는 {name, buffer})을 collectGroups가 읽는 모양으로 */
const asFile = ({ name, blob, buffer }) => ({
  name,
  arrayBuffer: async () => (blob ? blob.arrayBuffer() : buffer),
});

/**
 * 한 묶음(ZIP 하나 / GeoJSON 하나 / SHP 부품들)을 읽어 둔다.
 * @param {{files:Array<{name:string, blob?:Blob, buffer?:ArrayBuffer}>}} o
 * @returns {Promise<{items:Array<{id:number,name:string,kind:'shp'|'geojson'|'csv',hasDbf:boolean}>, skipped:string[], errors:string[], styles:Array<{name:string,text:string}>}>}
 */
export async function openSource({ files }) {
  const { groups, skipped, styles } = await collectGroups(files.map(asFile));
  const items = [];
  const errors = [];
  for (const g of groups) {
    try {
      // 묶음 하나가 원본 하나가 아닐 수 있다 (GeoPackage는 지형지물 표마다 하나)
      const read = await readRaws(g);
      for (const raw of read.raws) {
        const id = ++seq;
        store.set(id, raw);
        // label: 화면에 보일 형식 이름(SHP, GeoJSON, KML, GPX, CSV, GeoPackage), hasEncoding: 속성 인코딩을 고를 수 있는가(DBF가 있는 SHP, CSV)
        items.push({ id, name: raw.name ?? g.name, kind: raw.kind, label: raw.source ?? raw.kind, hasDbf: Boolean(raw.dbfBuf), hasEncoding: Boolean(raw.dbfBuf) || raw.kind === 'csv' });
      }
    } catch (e) {
      errors.push(e?.message ?? String(e));
    }
  }
  const texts = [];
  for (const s of styles) {
    try {
      texts.push({ name: s.name, text: new TextDecoder('utf-8').decode(await s.read()) });
    } catch (e) {
      errors.push(`${s.name}: ${e?.message ?? e}`);
    }
  }
  return { items, skipped, errors, styles: texts };
}

/** 읽어 둔 원본으로 설정(인코딩·좌표계)에 맞는 FeatureCollection과 요약을 만든다 */
export function buildItem({ id, opts }) {
  const raw = store.get(id);
  if (!raw) throw new Error('이미 닫힌 파일입니다. 다시 열어 주세요.');
  // 화면에서 직접 추가한 좌표계는 이 워커가 모르므로 정의를 같이 받아 등록한다
  if (opts?.crsDef) registerCrs(opts.crsDef);
  return buildCollection(raw, opts);
}

export function releaseItems({ ids }) {
  for (const id of ids) store.delete(id);
  return true;
}

/** 시험용: 지금 들고 있는 원본 수 */
export const heldCount = () => store.size;
