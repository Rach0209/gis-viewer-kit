/**
 * 사용자가 고른 로컬 폴더(Map<상대경로, File>)를 Cesium이 "주소"로 읽을 수 있게 하는 순수 로직.
 * 폴더마다 가짜 주소(http://local-files.invalid/<번호>/상대/경로)를 주고, 그 주소로 온 요청을 파일로 연결한다.
 * Cesium에 끼워 넣는 부분은 cesiumLocalFiles.js. 이 파일은 Cesium에 의존하지 않아 단독으로 시험할 수 있다.
 */

/** `.invalid`는 실제로 존재할 수 없는 최상위 도메인이라 진짜 서버로 요청이 나갈 일이 없다. */
export const VIRTUAL_HOST = 'http://local-files.invalid/';

/** 윈도우 경로 구분자·앞의 ./ 와 /·반복된 /를 정리한다. */
export function normalizePath(p) {
  const parts = String(p).split(String.fromCharCode(92)).join('/').split('/');
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    out.push(part);
  }
  return out.join('/');
}

/** 폴더 안에서 tileset.json 을 찾는다. 여러 개면 가장 얕은 것. */
export function findEntry(keys) {
  return [...keys]
    .filter((k) => /(^|\/)tileset\.json$/i.test(k))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
}

const isGzip = (u8) => u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b;

/**
 * gzip(맨 앞 1f 8b)으로 압축된 내용이면 풀어서 돌려준다.
 * 서버로 서비스할 때는 서버가 `Content-Encoding: gzip` 으로 보내 브라우저가 풀어 주지만, 로컬 파일은 압축된 채로
 * 읽히므로 직접 풀어야 한다 (Cesium 지형 타일 `.terrain` 파일은 보통 gzip으로 저장되어 있다).
 * @param {ArrayBuffer} buf
 * @returns {Promise<ArrayBuffer>}
 */
export async function gunzipIfNeeded(buf) {
  if (!isGzip(new Uint8Array(buf, 0, Math.min(3, buf.byteLength)))) return buf;
  if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 gzip 압축 파일을 풀 수 없습니다 (DecompressionStream 없음). 압축을 푼 파일을 쓰세요.');
  try {
    return await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  } catch (e) {
    throw new Error(`gzip 압축 해제에 실패했습니다 (${e.message}). 파일이 손상되었을 수 있습니다.`);
  }
}

/** File(또는 같은 모양의 객체)을 Cesium 요청 형식(responseType)에 맞게 읽는다. gzip이면 풀어서. */
export async function readAs(file, responseType) {
  if (responseType === 'blob') return file instanceof Blob ? file : new Blob([await file.arrayBuffer()]);
  if (typeof file.arrayBuffer !== 'function') {
    if (responseType === 'text') return file.text();
    if (responseType === 'json') return JSON.parse(await file.text());
  }
  const buf = await gunzipIfNeeded(await file.arrayBuffer());
  if (responseType === 'text') return new TextDecoder().decode(buf);
  if (responseType === 'json') return JSON.parse(new TextDecoder().decode(buf));
  return buf; // 'arraybuffer' (기본)
}

export function createVirtualFolders() {
  let seq = 0;
  /** @type {Map<string, {files: Map<string, any>, lower: Map<string, string>}>} */
  const folders = new Map();

  return {
    /**
     * @param {Map<string, any>} files 상대경로 -> File
     * @returns {{id:string, entry:string|undefined, urlFor:(rel:string)=>string, entryUrl:string|null}}
     */
    register(files) {
      const id = String(++seq);
      const norm = new Map();
      const lower = new Map();
      for (const [k, v] of files) {
        const n = normalizePath(k);
        norm.set(n, v);
        lower.set(n.toLowerCase(), n);
      }
      folders.set(id, { files: norm, lower });
      const entry = findEntry(norm.keys());
      const urlFor = (rel) => `${VIRTUAL_HOST}${id}/${normalizePath(rel).split('/').map(encodeURIComponent).join('/')}`;
      return { id, entry, urlFor, entryUrl: entry ? urlFor(entry) : null };
    },

    /**
     * 가짜 주소인지 확인하고 파일을 찾는다. 가짜 주소가 아니면 null, 맞는데 파일이 없으면 { file: null, rel }.
     * 대소문자만 다른 경로도 찾아 준다 (윈도우에서 만든 데이터를 다른 곳에서 열 때).
     */
    resolve(url) {
      const u = String(url).split('#')[0].split('?')[0];
      if (!u.startsWith(VIRTUAL_HOST)) return null;
      const rest = u.slice(VIRTUAL_HOST.length);
      const slash = rest.indexOf('/');
      if (slash < 0) return { file: null, rel: rest };
      const folder = folders.get(rest.slice(0, slash));
      let rel;
      try {
        rel = normalizePath(decodeURIComponent(rest.slice(slash + 1)));
      } catch {
        rel = normalizePath(rest.slice(slash + 1));
      }
      if (!folder) return { file: null, rel };
      const exact = folder.files.get(rel);
      if (exact) return { file: exact, rel };
      const alt = folder.lower.get(rel.toLowerCase());
      return { file: alt ? folder.files.get(alt) : null, rel };
    },

    release(id) {
      folders.delete(id);
    },
  };
}
