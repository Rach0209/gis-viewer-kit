/**
 * 타일 콘텐츠(glb/b3dm)의 "앞부분만" 읽어서, 압축/디코드가 필요한지 판별한다.
 *
 * 왜 필요한가: 사용자가 가져온 타일셋이 Draco(메시 압축), KTX2/Basis(텍스처 압축),
 * Meshopt 중 무엇을 쓰는지는 타일셋마다 다르고 사용자도 모를 수 있다. 확장 이름은
 * 각 glb의 JSON 청크(`extensionsUsed` / `extensionsRequired`)에 적혀 있으므로, 수십 MB짜리
 * 파일이라도 앞 수 KB만 읽으면 알 수 있다.
 *
 * 실제 디코드는 three.js의 GLTFLoader가 타일 로드 시점마다 알아서 한다
 * (확장이 있으면 해당 디코더 호출, 없으면 무시). 이 모듈의 역할은 그에 앞서
 *   1) 사용자에게 "무엇이 적용된 데이터인지" 보여주고,
 *   2) 필요한 디코더 파일이 실제로 있는지 미리 점검해 오류를 이해 가능하게 만드는 것이다.
 */

export const EXT = {
  DRACO: 'KHR_draco_mesh_compression',
  KTX2: 'KHR_texture_basisu',
  MESHOPT: 'EXT_meshopt_compression',
  QUANTIZATION: 'KHR_mesh_quantization',
};

const textDecoder = new TextDecoder();

/**
 * glb 바이트에서 JSON 청크의 길이를 읽는다. 앞 20바이트면 충분하다.
 * @param {ArrayBuffer} buf
 * @returns {{jsonLength:number}|null} glb가 아니면 null
 */
export function readGlbHeader(buf) {
  if (buf.byteLength < 20) return null;
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== 0x46546c67) return null; // 'glTF'
  if (v.getUint32(16, true) !== 0x4e4f534a) return null; // 첫 청크가 'JSON'
  return { jsonLength: v.getUint32(12, true) };
}

/**
 * 앞 (20 + jsonLength) 바이트가 담긴 버퍼에서 glTF JSON의 확장 목록을 꺼낸다.
 * @param {ArrayBuffer} buf
 * @returns {{extensionsUsed:string[], extensionsRequired:string[], imageMimeTypes:string[]}|null}
 */
export function parseGlbExtensions(buf) {
  const head = readGlbHeader(buf);
  if (!head) return null;
  if (buf.byteLength < 20 + head.jsonLength) return null;
  let json;
  try {
    json = JSON.parse(textDecoder.decode(new Uint8Array(buf, 20, head.jsonLength)));
  } catch {
    return null;
  }
  const mimes = new Set();
  for (const img of json.images ?? []) if (img.mimeType) mimes.add(img.mimeType);
  return {
    extensionsUsed: json.extensionsUsed ?? [],
    extensionsRequired: json.extensionsRequired ?? [],
    imageMimeTypes: [...mimes],
  };
}

/** b3dm: 28바이트 헤더 + 4개 테이블 길이 뒤에 glb가 온다. @returns {number|null} glb 시작 오프셋 */
export function b3dmGlbOffset(buf) {
  if (buf.byteLength < 28) return null;
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== 0x6d643362) return null; // 'b3dm'
  return 28 + v.getUint32(12, true) + v.getUint32(16, true) + v.getUint32(20, true) + v.getUint32(24, true);
}

function extOf(uri) {
  const m = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(uri);
  return m ? m[1].toLowerCase() : '';
}

/**
 * tileset.json 트리를 얕게 훑어 콘텐츠 URI를 모은다 (외부 tileset.json도 몇 개 따라간다).
 * @returns {Promise<string[]>} 절대 URL 목록 (glb/b3dm 등)
 */
async function collectContentUrls(src, rootJson, maxContents, maxJsonFetches) {
  const out = [];
  // 깊이 우선(스택)으로 훑는다. 현장 스캔 데이터처럼 외부 tileset.json이 여러 단계로 중첩된
  // 경우 너비 우선으로 가면 json 읽기 횟수만 소진하고 실제 콘텐츠(glb)까지 못 간다.
  const queue = [{ node: rootJson.root, base: src.rootUrl }];
  let fetches = 0;
  while (queue.length && out.length < maxContents) {
    const { node, base } = queue.pop();
    if (!node) continue;
    const contents = node.contents ?? (node.content ? [node.content] : []);
    for (const c of contents) {
      const uri = c.uri ?? c.url;
      if (!uri) continue;
      let abs;
      try {
        abs = new URL(uri, base).toString();
      } catch {
        continue;
      }
      if (extOf(uri) === 'json') {
        if (fetches < maxJsonFetches) {
          fetches++;
          try {
            const sub = await src.readJson(abs);
            if (sub?.root) queue.push({ node: sub.root, base: abs });
          } catch {
            // 외부 tileset을 못 읽어도 검사는 계속한다
          }
        }
      } else {
        out.push(abs);
      }
    }
    // 스택이므로 역순으로 넣어야 첫 번째 자식부터 꺼내진다
    const kids = node.children ?? [];
    for (let i = kids.length - 1; i >= 0; i--) queue.push({ node: kids[i], base });
  }
  return out.slice(0, maxContents);
}

/**
 * @typedef {Object} ContentReport
 * @property {number} sampled            실제로 열어 본 파일 수
 * @property {string[]} formats          발견한 콘텐츠 형식 (glb, b3dm, pnts ...)
 * @property {string[]} extensionsUsed
 * @property {string[]} extensionsRequired
 * @property {{draco:boolean, ktx2:boolean, meshopt:boolean}} needs   디코더가 필요한가
 * @property {string[]} notInspected     내용을 열어보지 못한 형식 (i3dm/pnts/cmpt 등)
 * @property {string[]} errors
 */

/**
 * @param {import('./sources.js').ResolvedSource} src
 * @param {any} rootJson 이미 읽어 둔 루트 tileset.json
 * @param {{maxContents?:number, maxJsonFetches?:number}} [opts]
 * @returns {Promise<ContentReport>}
 */
export async function inspectContent(src, rootJson, { maxContents = 4, maxJsonFetches = 6 } = {}) {
  const report = {
    sampled: 0,
    formats: [],
    extensionsUsed: [],
    extensionsRequired: [],
    needs: { draco: false, ktx2: false, meshopt: false },
    notInspected: [],
    errors: [],
  };
  const used = new Set();
  const required = new Set();
  const formats = new Set();
  const notInspected = new Set();

  let urls = [];
  try {
    urls = await collectContentUrls(src, rootJson, maxContents, maxJsonFetches);
  } catch (e) {
    report.errors.push(String(e.message ?? e));
  }

  for (const url of urls) {
    const ext = extOf(url);
    formats.add(ext || '?');
    try {
      let glbStart = 0;
      if (ext === 'b3dm') {
        const h = await src.readRange(url, 0, 28);
        const off = b3dmGlbOffset(h);
        if (off == null) throw new Error('b3dm 헤더가 올바르지 않음');
        glbStart = off;
      } else if (ext !== 'glb' && ext !== 'gltf') {
        notInspected.add(ext || '?');
        continue;
      }
      if (ext === 'gltf') {
        notInspected.add('gltf');
        continue;
      }
      const head = await src.readRange(url, glbStart, 20);
      const hdr = readGlbHeader(head);
      if (!hdr) throw new Error('glb 헤더가 올바르지 않음');
      const buf = await src.readRange(url, glbStart, 20 + hdr.jsonLength);
      const parsed = parseGlbExtensions(buf);
      if (!parsed) throw new Error('glb JSON을 읽지 못함');
      report.sampled++;
      parsed.extensionsUsed.forEach((x) => used.add(x));
      parsed.extensionsRequired.forEach((x) => required.add(x));
    } catch (e) {
      report.errors.push(`${url.split('/').slice(-2).join('/')}: ${e.message ?? e}`);
    }
  }

  report.formats = [...formats];
  report.extensionsUsed = [...used];
  report.extensionsRequired = [...required];
  report.notInspected = [...notInspected];
  report.needs = {
    draco: used.has(EXT.DRACO) || required.has(EXT.DRACO),
    ktx2: used.has(EXT.KTX2) || required.has(EXT.KTX2),
    meshopt: used.has(EXT.MESHOPT) || required.has(EXT.MESHOPT),
  };
  return report;
}

/** wasm 파일인지 앞 4바이트(\0asm)로 확인한다. Vite dev 서버는 없는 파일에도 index.html을 200으로 주기 때문. */
async function isWasmAt(url) {
  try {
    // cache: 'no-store' — 4바이트 부분 응답이 캐시에 남으면 뒤이은 실제 wasm 로드가 4바이트만 받아 실패한다.
    const res = await fetch(url, { cache: 'no-store', headers: { Range: 'bytes=0-3' } });
    if (!res.ok) return false;
    const b = new Uint8Array(await res.arrayBuffer());
    return b[0] === 0x00 && b[1] === 0x61 && b[2] === 0x73 && b[3] === 0x6d;
  } catch {
    return false;
  }
}

/**
 * 필요한 디코더 파일이 실제로 있는지 미리 확인한다.
 * Meshopt 디코더는 three에 내장(JS에 포함)이라 파일 점검이 필요 없다.
 * @param {{draco:boolean, ktx2:boolean}} needs
 * @param {string} decoderBaseUrl 예: '/' -> /draco/, /basis/
 * @returns {Promise<string[]>} 문제 설명 (비어 있으면 정상)
 */
export async function checkDecoders(needs, decoderBaseUrl) {
  const problems = [];
  if (needs.draco && !(await isWasmAt(`${decoderBaseUrl}draco/draco_decoder.wasm`))) {
    problems.push(`Draco 디코더를 찾을 수 없음: ${decoderBaseUrl}draco/draco_decoder.wasm`);
  }
  if (needs.ktx2 && !(await isWasmAt(`${decoderBaseUrl}basis/basis_transcoder.wasm`))) {
    problems.push(`KTX2(Basis) 트랜스코더를 찾을 수 없음: ${decoderBaseUrl}basis/basis_transcoder.wasm`);
  }
  return problems;
}
