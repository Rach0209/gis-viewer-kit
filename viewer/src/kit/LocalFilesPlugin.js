/**
 * 사용자가 고른 로컬 폴더의 파일을, 서버 없이 3d-tiles-renderer에 공급하는 플러그인.
 *
 * 동작 원리: 타일셋의 루트 URL을 가짜 주소(예: http://local-files.invalid/<id>/tileset.json)로
 * 잡아두면 라이브러리가 자식 타일 URL을 같은 가짜 주소 아래로 풀어낸다
 * (`new URL(uri, basePath)`). 이 플러그인이 fetchData에서 가짜 주소를 가로채
 * 폴더 안의 File을 `Response`로 돌려준다 -- 가짜 주소가 아닌 URL(절대 http URI 등)은
 * undefined를 돌려줘서 라이브러리 기본 fetch로 넘어간다.
 *
 * File은 디스크 참조일 뿐이라 요청된 타일만 그때그때 읽힌다 (전체를 메모리에 올리지 않음).
 */

/** 경로 구분자/앞의 ./ 와 / 를 정리한다. */
export function normalizePath(p) {
  return p.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
}

/**
 * @param {Map<string, Blob>|Record<string, Blob>} files 상대 경로 -> File/Blob
 */
export function toFileMap(files) {
  const map = new Map();
  const entries = files instanceof Map ? files.entries() : Object.entries(files);
  for (const [path, file] of entries) map.set(normalizePath(path), file);
  return map;
}

export class LocalFilesPlugin {
  /**
   * @param {Object} options
   * @param {Map<string, Blob>|Record<string, Blob>} options.files
   * @param {string} options.baseUrl 가짜 주소 접두어 (끝에 / 포함)
   */
  constructor({ files, baseUrl }) {
    this.name = 'LOCAL_FILES_PLUGIN';
    // 기본 fetch보다 먼저 호출되도록 낮은 priority 값을 준다 (낮을수록 먼저).
    this.priority = -1000;
    this.baseUrl = baseUrl;
    this._files = toFileMap(files);
    // 대소문자만 다른 경우를 위한 보조 인덱스 (Windows에서 만든 데이터는 대소문자가 섞이기 쉽다).
    this._lower = new Map();
    for (const [k, v] of this._files) this._lower.set(k.toLowerCase(), v);
  }

  /** @param {string} relPath */
  lookup(relPath) {
    const key = normalizePath(relPath);
    return this._files.get(key) ?? this._lower.get(key.toLowerCase()) ?? null;
  }

  /**
   * @param {string} url
   * @returns {Promise<Response>|undefined} 가짜 주소가 아니면 undefined (= 이 플러그인이 처리하지 않음)
   */
  fetchData(url) {
    if (typeof url !== 'string' || !url.startsWith(this.baseUrl)) return undefined;

    let rel = url.slice(this.baseUrl.length).split('#')[0].split('?')[0];
    try {
      rel = decodeURIComponent(rel);
    } catch {
      // 잘못된 % 인코딩은 그대로 둔다
    }
    const file = this.lookup(rel);
    if (!file) {
      // statusText는 ByteString(Latin-1)이어야 해서 한글/비ASCII 경로를 그대로 넣으면 예외가 난다.
      // 그래서 경로를 퍼센트 인코딩해서 넣는다 (오류 메시지에 이 값이 그대로 표시된다).
      return Promise.resolve(
        new Response(null, { status: 404, statusText: `Not found in selected folder: ${encodeURI(rel)}` })
      );
    }
    return Promise.resolve(new Response(file, { status: 200 }));
  }
}
