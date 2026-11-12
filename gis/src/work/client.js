/**
 * 화면 쪽에서 쓰는 "백그라운드 읽기" 입구. 무거운 파싱(GeoTIFF, 글자 DEM, SHP/ZIP/GeoJSON)을 웹 워커에 맡긴다.
 * 워커를 쓸 수 없는 환경(시험, 아주 오래된 브라우저)에서는 같은 코드를 그 자리에서 돌린다.
 *
 * 화면 코드는 이 파일의 함수만 부르고, 무거운 라이브러리는 워커 쪽 번들에만 들어간다.
 */
import { assembleDemText } from '../demText.js';
import { getCrs } from '../../../viewer/src/kit/crsList.js';
import { planSources } from '../vectorNames.js';
import { createPool } from './pool.js';

/** 동시에 돌릴 워커 수: CPU 코어 수 - 1 (화면용 한 개를 남김), 1~4개 */
export function workerCountFor(cores) {
  const n = Number.isFinite(cores) ? cores : 4;
  return Math.max(1, Math.min(4, n - 1));
}

let pool = null;

function getPool() {
  if (pool) return pool;
  if (typeof Worker !== 'undefined') {
    pool = createPool({
      size: workerCountFor(globalThis.navigator?.hardwareConcurrency),
      // new Worker(new URL(...)) 모양은 번들러(Vite)가 알아보는 형식이라 한 줄로 둔다
      makeWorker: () => new Worker(new URL('./parse.worker.js', import.meta.url), { type: 'module' }),
    });
  } else {
    pool = createPool({ runInline: async (task, args) => (await import('./tasks.js')).runTask(task, args) });
  }
  return pool;
}

/** 시험용: 풀을 새로 만들게 한다 */
export function resetPool() {
  pool?.terminate();
  pool = null;
}

/** 지금 어떻게 돌고 있는지 (진단용) */
export const poolInfo = () => ({ mode: getPool().mode, workers: getPool().workerCount });

// ---------------------------------------------------------------- 지형(DEM)
/** GeoTIFF 한 개 읽기 (워커) */
export const readDemTiff = (file, limits) => getPool().run('demTiff', { file, limits });

/** 글자 DEM 여러 파일: 파일마다 다른 워커가 동시에 읽고, 합치기만 화면에서 한다 */
export async function readDemTextParallel(files, limits) {
  if (!files.length) throw new Error('파일이 없습니다.');
  const parsed = await Promise.all(files.map((file) => getPool().run('demTextFile', { file, limits })));
  return assembleDemText(parsed);
}

// ---------------------------------------------------------------- 색 이미지(항공·위성 사진, 월드파일 이미지)
/** GeoTIFF 가 색 이미지인가 (아니면 지형 DEM) */
export const probeTiff = async (file) => getPool().run('tiffProbe', { file: await asBlob(file) });

/** Blob 이 아닌 파일 모양({name, arrayBuffer})은 워커에 넘길 수 있게 Blob 으로 */
async function asBlob(f) {
  if (typeof Blob !== 'undefined' && f instanceof Blob) return f;
  return Object.assign(new Blob([await f.arrayBuffer()]), { name: f.name });
}

/**
 * 이미지 하나를 읽어 워커에 둔다. 좌표계를 바꿔 가며 project() 로 다시 그리고, 다 쓰면 release().
 * @param {{name:string, arrayBuffer:()=>Promise<ArrayBuffer>}} image
 * @param {{worldFile?:{text?:()=>Promise<string>, arrayBuffer:()=>Promise<ArrayBuffer>}|null, limits?:object}} [o]
 */
export async function openRasterFile(image, { worldFile = null, limits } = {}) {
  const worldText = worldFile ? new TextDecoder('utf-8').decode(await worldFile.arrayBuffer()) : null;
  const file = await asBlob(image);
  const named = file.name ? file : Object.assign(file, { name: image.name });
  const lease = getPool().lease();
  let info;
  try {
    info = await lease.run('rasterOpen', { file: named, worldText, limits });
  } catch (e) {
    lease.release();
    throw e;
  }
  let released = false;
  return {
    info,
    /** @param {{crs:string, transparentBlack?:boolean, maxDim?:number}} opts */
    project: (opts) => lease.run('rasterProject', { id: info.id, ...withCrsDef(opts) }),
    release() {
      if (released) return;
      released = true;
      lease.run('rasterRelease', { id: info.id }).catch(() => {});
      lease.release();
    },
  };
}

// ---------------------------------------------------------------- 벡터
/** 직접 추가한 좌표계를 골랐으면 워커가 알 수 있게 정의를 같이 보낸다 (워커는 화면의 좌표계 목록을 모른다) */
export function withCrsDef(opts) {
  if (!opts?.crs || opts.crs === 'auto') return opts;
  try {
    const info = getCrs(opts.crs);
    return info.custom && info.def ? { ...opts, crsDef: { code: info.code, def: info.def, label: info.label } } : opts;
  } catch {
    return opts;
  }
}

/** 파일(File 또는 {name, arrayBuffer, blob?})을 워커에 넘길 수 있는 모양으로. Blob이면 복사 없이 핸들만 넘어간다. */
async function toWire(f) {
  const blob = f.blob ?? (typeof Blob !== 'undefined' && f instanceof Blob ? f : null);
  if (blob) return { name: f.name, blob };
  return { name: f.name, buffer: await f.arrayBuffer() };
}

/**
 * 벡터 파일들(GeoJSON, SHP, ZIP, KML/KMZ, GPX, CSV, GeoPackage)을 읽는다. 묶음(zip 하나, GeoJSON 하나, 같은 이름의 SHP 부품들 …)마다 다른 워커가 동시에 읽는다.
 * 읽은 원본은 워커에 남아 있고, item.build(설정)으로 인코딩·좌표계를 바꿔 가며 다시 계산한다. 다 쓰면 release().
 *
 * @param {Array<{name:string, arrayBuffer:()=>Promise<ArrayBuffer>, blob?:Blob}>} files
 * @returns {Promise<{
 *   items: Array<{name:string, kind:'shp'|'geojson'|'csv', hasDbf:boolean, build:(opts:{encoding?:string, crs?:string})=>Promise<{collection:object, info:object}>}>,
 *   skipped: string[], errors: string[], styles: Array<{name:string, text:string}>, release: ()=>void
 * }>}
 */
export async function openVectorFiles(files) {
  const plan = planSources(files);
  const skipped = [...plan.skipped];
  const errors = [];
  const items = [];
  const styles = [];
  const leases = [];

  for (const s of plan.styles) {
    try {
      styles.push({ name: s.name.split('/').pop(), text: new TextDecoder('utf-8').decode(await s.arrayBuffer()) });
    } catch (e) {
      errors.push(`${s.name}: ${e?.message ?? e}`);
    }
  }

  const results = await Promise.all(
    plan.sources.map(async (src) => {
      const lease = getPool().lease();
      leases.push(lease);
      try {
        const wire = await Promise.all(src.files.map(toWire));
        return { src, lease, out: await lease.run('vectorOpen', { files: wire }) };
      } catch (e) {
        const msg = String(e?.message ?? e);
        return { src, lease, error: msg.startsWith(src.label) ? msg : `${src.label}: ${msg}` }; // 이미 파일 이름으로 시작하는 안내는 겹치게 붙이지 않는다
      }
    }),
  );

  for (const r of results) {
    if (r.error) {
      errors.push(r.error);
      continue;
    }
    skipped.push(...r.out.skipped);
    errors.push(...r.out.errors);
    styles.push(...r.out.styles);
    for (const it of r.out.items) {
      items.push({
        name: it.name,
        kind: it.kind,
        label: it.label,
        hasDbf: it.hasDbf,
        hasEncoding: it.hasEncoding,
        build: (opts) => r.lease.run('vectorBuild', { id: it.id, opts: withCrsDef(opts) }),
        _id: it.id,
        _lease: r.lease,
      });
    }
  }

  let released = false;
  return {
    items,
    skipped,
    errors,
    styles,
    release() {
      if (released) return;
      released = true;
      for (const l of leases) {
        const ids = items.filter((i) => i._lease === l).map((i) => i._id);
        if (ids.length) l.run('vectorRelease', { ids }).catch(() => {});
        l.release();
      }
    },
  };
}
