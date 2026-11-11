/**
 * 좌표계 직접 입력: 사용자가 적은 글(EPSG 번호, PROJ 문자열, WKT)을 좌표계로 바꾼다.
 *
 *  - 'EPSG:2154' 또는 '2154'  : 목록(CRS_LIST)·UTM 존이면 바로. 아니면 저장해 둔 정의, 그래도 없으면 인터넷(epsg.io,
 *    spatialreference.org)에서 정의를 가져온다 (이때 EPSG 번호만 밖으로 나간다. 자료는 나가지 않는다).
 *  - '+proj=tmerc ...'        : PROJ 문자열 그대로
 *  - 'PROJCS["...' / 'GEOGCS["...' : WKT (.prj 파일 내용을 붙여 넣으면 된다)
 *
 * 결과는 registerCrs 로 등록되어 getCrs / toLonLat / fromLonLat 에서 코드로 쓸 수 있다.
 * 가져온 정의와 직접 넣은 좌표계는 최근 것을 localStorage 에 저장해 다음에도 목록에 보인다.
 */
import { crsInfoFromDef, customCrsList, getCrs, isKnownCrs, registerCrs } from './crsList.js';

const DEF_PREFIX = 'gis-viewer-kit:crsdef:'; // + 코드 -> 정의 (가져온 EPSG 정의 캐시)
const RECENT_KEY = 'gis-viewer-kit:crs-recent'; // [{code, def, label}] 최근에 쓴 직접 추가 좌표계
const RECENT_MAX = 12;

/**
 * 글을 종류별로 나눈다 (네트워크·등록은 하지 않는다).
 * @returns {{kind:'empty'|'epsg'|'proj'|'wkt'|'invalid', code?:string, def?:string}}
 */
export function parseCrsText(text) {
  const t = String(text ?? '').trim();
  if (!t) return { kind: 'empty' };
  const epsg = /^(?:EPSG\s*[:：]?\s*)?(\d{4,6})$/i.exec(t);
  if (epsg) return { kind: 'epsg', code: `EPSG:${Number(epsg[1])}` };
  if (/^\+/.test(t) && /\+proj=/.test(t)) return { kind: 'proj', def: t.replace(/\s+/g, ' ') };
  if (/^(PROJCS|GEOGCS|GEOGCRS|PROJCRS|GEODCRS|PROJECTEDCRS|GEOGRAPHICCRS)\s*\[/i.test(t)) return { kind: 'wkt', def: t };
  return { kind: 'invalid' };
}

/** WKT 안의 이름과 EPSG 권한 코드 (마지막 AUTHORITY 가 좌표계 전체의 것이다) */
export function wktNameAndCode(wkt) {
  const name = /^[A-Z]+\s*\[\s*"([^"]+)"/i.exec(wkt.trim())?.[1] ?? null;
  const all = [...wkt.matchAll(/AUTHORITY\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]/gi)];
  const code = all.length ? `EPSG:${all[all.length - 1][1]}` : null;
  return { name, code };
}

/** 같은 정의는 늘 같은 코드가 나오도록 하는 짧은 지문 */
function fingerprint(def) {
  let h = 5381;
  for (let i = 0; i < def.length; i++) h = ((h << 5) + h + def.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function storageOf(storage) {
  try {
    return storage ?? globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function rememberRecent(info, storage) {
  const s = storageOf(storage);
  if (!s) return;
  try {
    const list = JSON.parse(s.getItem(RECENT_KEY) ?? '[]').filter((x) => x.code !== info.code);
    list.unshift({ code: info.code, def: info.def, label: info.label });
    s.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    /* 저장하지 못해도 이번 방문에는 쓸 수 있다 */
  }
}

/** 지난번에 직접 추가한 좌표계를 다시 등록하고 돌려준다 (페이지를 열 때 한 번) */
export function restoreRecentCrs(storage) {
  const s = storageOf(storage);
  if (!s) return [];
  let list = [];
  try {
    list = JSON.parse(s.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
  const out = [];
  for (const r of list) {
    try {
      if (!isKnownCrs(r.code)) registerCrs({ code: r.code, def: r.def, label: r.label });
      out.push(getCrs(r.code));
    } catch {
      /* 깨진 항목은 건너뛴다 */
    }
  }
  return out;
}

/**
 * EPSG 번호의 정의를 인터넷에서 가져온다. epsg.io 를 먼저, 안 되면 spatialreference.org.
 * @param {string} code 'EPSG:2154'
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<{def:string, label:string}>}
 */
export async function fetchEpsgDef(code, fetchImpl = globalThis.fetch?.bind(globalThis)) {
  if (!fetchImpl) throw new Error('이 환경에서는 인터넷에서 좌표계 정의를 가져올 수 없습니다.');
  const n = code.replace('EPSG:', '');
  const text = async (url) => {
    const r = await fetchImpl(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.text()).trim();
  };
  let def = null;
  try {
    def = await text(`https://epsg.io/${n}.proj4`);
  } catch {
    try {
      def = await text(`https://spatialreference.org/ref/epsg/${n}/proj4.txt`);
    } catch {
      def = null;
    }
  }
  if (!def || !/\+proj=/.test(def)) {
    throw new Error(`EPSG:${n} 정의를 가져오지 못했습니다. 인터넷 연결을 확인하거나, 좌표계를 PROJ 문자열·WKT(.prj 내용)로 직접 붙여 넣으세요.`);
  }
  // 이름은 있으면 좋은 정도라 실패해도 넘어간다
  let label = `EPSG:${n}`;
  try {
    const j = JSON.parse(await text(`https://epsg.io/${n}.json`));
    if (j?.name) label = `${j.name} (EPSG:${n})`;
  } catch {
    /* 이름 없이 번호로 */
  }
  return { def, label };
}

/**
 * 입력한 글을 좌표계로 만들어 등록한다.
 * @param {string} text
 * @param {{fetchImpl?:typeof fetch, storage?:Storage}} [o]
 * @returns {Promise<import('./crsList.js').CrsInfo>}
 */
export async function resolveCrsInput(text, { fetchImpl, storage } = {}) {
  const p = parseCrsText(text);
  if (p.kind === 'empty') throw new Error('좌표계를 입력하세요. 예: EPSG:2154, +proj=… 문자열, 또는 .prj 파일 내용(WKT)');
  if (p.kind === 'invalid') throw new Error('알아볼 수 없는 입력입니다. EPSG 번호(예: EPSG:2154), PROJ 문자열(+proj=…), WKT(PROJCS[…])만 됩니다.');

  if (p.kind === 'epsg') {
    if (isKnownCrs(p.code)) return getCrs(p.code);
    const s = storageOf(storage);
    let cached = null;
    try {
      cached = s ? JSON.parse(s.getItem(DEF_PREFIX + p.code) ?? 'null') : null;
    } catch {
      cached = null;
    }
    const got = cached ?? (await fetchEpsgDef(p.code, fetchImpl));
    const info = registerCrs({ code: p.code, def: got.def, label: got.label });
    if (!cached && s) {
      try {
        s.setItem(DEF_PREFIX + p.code, JSON.stringify(got));
      } catch {
        /* 캐시를 못 해도 괜찮다 */
      }
    }
    rememberRecent(info, storage);
    return info;
  }

  // PROJ 문자열 / WKT: 해석 가능한지 먼저 확인하고(오류 메시지), 코드와 이름을 정한다
  crsInfoFromDef('CHECK', p.def);
  let code = `USER:${fingerprint(p.def)}`;
  let label = `직접 입력 좌표계 (${code.slice(5)})`;
  if (p.kind === 'wkt') {
    const { name, code: authority } = wktNameAndCode(p.def);
    if (name) label = name;
    if (authority && !isKnownCrs(authority)) code = authority;
    else if (authority && isKnownCrs(authority)) return getCrs(authority);
    if (name && code.startsWith('EPSG:')) label = `${name} (${code})`;
  }
  const info = registerCrs({ code, def: p.def, label });
  rememberRecent(info, storage);
  return info;
}

/** 선택 목록에 보여 줄 모든 직접 추가 좌표계 */
export { customCrsList };
