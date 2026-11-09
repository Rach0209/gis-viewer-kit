import { LocalFilesPlugin, normalizePath, toFileMap } from './LocalFilesPlugin.js';

/**
 * 타일셋을 "어디서 가져오는가"를 추상화한다 (docs/03-viewer-api.md 의 TilesetSource).
 *
 *   { kind: 'url',   url }
 *   { kind: 'files', files: Map<상대경로, File>, entry?: 'tileset.json', name? }
 *
 * 'backend' 소스({ kind:'backend', apiUrl, id })는 backend.js 가 서버에서 entry URL을 받아
 * 'url'과 똑같이 로드한다 (TileViewer.loadTileset 에서 변환). 그래서 이 파일은 'url'/'files'만 다룬다.
 *
 * @typedef {{
 *   name: string,
 *   rootUrl: string,
 *   entry: string,
 *   plugins: object[],
 *   readJson: (url: string) => Promise<any>,
 *   readRange: (url: string, start: number, length: number) => Promise<ArrayBuffer>,
 * }} ResolvedSource
 */

let localCounter = 0;

/** @returns {ResolvedSource} */
export function resolveSource(source) {
  if (source.kind === 'url') {
    // '/tiles-real/tileset.json' 같은 상대 주소도 흔하다. 자식 URI를 `new URL(uri, base)`로
    // 풀려면 base가 절대 주소여야 하므로 여기서 한 번 절대 주소로 바꿔 둔다.
    const absolute = new URL(source.url, globalThis.location?.href ?? 'http://localhost/').toString();
    return {
      name: source.name ?? lastSegment(absolute),
      rootUrl: absolute,
      entry: source.url,
      plugins: [],
      readJson: fetchJson,
      readRange: fetchRange,
    };
  }

  if (source.kind === 'files') {
    const files = toFileMap(source.files);
    const baseUrl = `http://local-files.invalid/${++localCounter}/`;
    const plugin = new LocalFilesPlugin({ files, baseUrl });
    const entry = normalizePath(source.entry ?? findEntry(files));
    if (!plugin.lookup(entry)) {
      throw new Error(`선택한 폴더에서 "${entry}"를 찾지 못했습니다. tileset.json이 들어 있는 폴더를 선택하세요.`);
    }

    // 가짜 주소면 폴더 안 파일에서, 아니면(절대 http URI 등) 네트워크에서 읽는다.
    const fileFor = (url) => (url.startsWith(baseUrl) ? plugin.lookup(decodeRel(url.slice(baseUrl.length))) : null);
    return {
      name: source.name ?? 'local folder',
      rootUrl: baseUrl + entry,
      entry,
      plugins: [plugin],
      readJson: async (url) => {
        if (!url.startsWith(baseUrl)) return fetchJson(url);
        const f = fileFor(url);
        if (!f) throw new Error(`폴더에 없는 파일: ${decodeRel(url.slice(baseUrl.length))}`);
        return JSON.parse(await f.text());
      },
      readRange: async (url, start, length) => {
        if (!url.startsWith(baseUrl)) return fetchRange(url, start, length);
        const f = fileFor(url);
        if (!f) throw new Error(`폴더에 없는 파일: ${decodeRel(url.slice(baseUrl.length))}`);
        return f.slice(start, start + length).arrayBuffer();
      },
    };
  }

  throw new Error(`지원하지 않는 소스 종류: ${source?.kind}`);
}

/**
 * entry를 지정하지 않으면 폴더 안에서 가장 얕은 tileset.json을 쓴다.
 * 사용자가 tileset.json 폴더가 아니라 그 상위 폴더를 골라도 동작하게 하기 위함이다
 * (상대 경로 URI는 entry 파일 기준으로 풀리므로 결과는 같다).
 */
export function findEntry(files) {
  const hits = [...files.keys()]
    .filter((k) => /(^|\/)tileset\.json$/i.test(k))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  return hits[0] ?? 'tileset.json';
}

function decodeRel(rel) {
  rel = rel.split('#')[0].split('?')[0];
  try {
    return decodeURIComponent(rel);
  } catch {
    return rel;
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`가져오지 못했습니다 (HTTP ${res.status}): ${url}`);
  return res.json();
}

/**
 * 파일 앞부분만 읽는다. 서버가 Range를 무시하고 200으로 전체를 보내도,
 * 스트림을 필요한 만큼만 읽고 취소하므로 수십 MB를 받지 않는다.
 */
async function fetchRange(url, start, length) {
  // cache: 'no-store' — 부분 응답(206)이 브라우저 캐시에 남으면, 같은 주소를 전체로 다시 받을 때
  // 일부만 돌려받는 문제가 생긴다 (GitHub Pages 같은 Range 지원 서버에서 확인됨).
  const res = await fetch(url, { mode: 'cors', cache: 'no-store', headers: { Range: `bytes=${start}-${start + length - 1}` } });
  if (!res.ok) throw new Error(`가져오지 못했습니다 (HTTP ${res.status}): ${url}`);
  const skip = res.status === 206 ? 0 : start; // 200이면 처음부터 오므로 start까지 건너뛴다
  const want = skip + length;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  while (got < want) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
  }
  reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(got, want));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, all.length - off);
    all.set(c.subarray(0, take), off);
    off += take;
    if (off >= all.length) break;
  }
  return all.slice(skip).buffer;
}

function lastSegment(url) {
  try {
    const parts = new URL(url, 'http://x/').pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] ?? url;
    return /\.json$/i.test(last) && parts.length > 1 ? parts[parts.length - 2] : last;
  } catch {
    return url;
  }
}
