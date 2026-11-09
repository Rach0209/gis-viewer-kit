/**
 * 사용자의 로컬 폴더를 `{ kind:'files', files: Map<상대경로, File>, name }` 소스로 바꾼다.
 * 서버로 아무것도 보내지 않는다 -- File 객체는 디스크 파일에 대한 참조일 뿐이다.
 *
 * 세 가지 경로 (docs/02-architecture.md 2절):
 *  1) showDirectoryPicker()   Chromium 계열, 보안 컨텍스트(https/localhost) 필요
 *  2) <input webkitdirectory> 대부분의 브라우저 (폴백)
 *  3) 드래그앤드롭            webkitGetAsEntry
 *
 * 폴더 안 파일이 많으면 읽는 데 시간이 걸린다. 파일 하나하나를 기다리면 느리므로 한 번에 여러 개를 읽고,
 * 호출하는 쪽이 로딩 표시를 할 수 있게 진행 콜백을 준다.
 *
 * @typedef {{ onPicked?: () => void, onProgress?: (fileCount: number) => void }} ReadHooks
 *   onPicked: 사용자가 폴더를 고른 직후(읽기 시작 전)에 한 번. onProgress: 읽은 파일 수 (자주 호출되지 않도록 간격을 둔다)
 */

/** 파일을 동시에 몇 개까지 읽을지. 너무 크면 브라우저가 오히려 느려진다. */
const READ_CONCURRENCY = 32;

export function supportsDirectoryPicker() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function' && window.isSecureContext;
}

/** 폴더 목록을 동시에 몇 개까지 읽을지 (파일 열기와 별개의 상한) */
const DIR_CONCURRENCY = 8;

/**
 * 동시에 limit개까지만 실행시키는 문. gate(fn)은 자리가 날 때까지 기다렸다가 fn을 실행하고 그 결과를 돌려준다.
 * 폴더를 통째로 읽을 때, 하위 폴더를 하나씩 차례로 읽지 않고 한꺼번에 펼치면서도 브라우저에 한 번에 보내는 요청 수는 제한한다.
 */
export function createGate(limit) {
  let active = 0;
  const waiting = [];
  return async (fn) => {
    if (active >= limit) await new Promise((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next(); // 자리를 기다리던 쪽에 넘겨준다 (active는 그대로)
      else active--;
    }
  };
}

/** 한 번 훑는 동안 같이 쓰는 문들: 파일 열기, 폴더 목록 읽기 */
const makeGates = () => ({ file: createGate(READ_CONCURRENCY), dir: createGate(DIR_CONCURRENCY) });

/** onProgress를 일정 간격으로만 부르는 보고 함수. 마지막에 done()으로 정확한 값을 한 번 더 보낸다. */
function makeReporter(onProgress, intervalMs = 80) {
  let last = 0;
  return {
    report(count) {
      const now = Date.now();
      if (onProgress && now - last >= intervalMs) {
        last = now;
        onProgress(count);
      }
    },
    done(count) {
      onProgress?.(count);
    },
  };
}

/** 병렬로 읽으면 들어온 순서가 매번 달라서, 경로 순으로 다시 늘어놓는다 (같은 폴더는 늘 같은 순서) */
function sortByPath(map) {
  const entries = [...map].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  map.clear();
  for (const [k, v] of entries) map.set(k, v);
  return map;
}

/**
 * FileSystemDirectoryHandle 아래의 모든 파일을 읽는다. 하위 폴더도 동시에 펼친다.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} [prefix]
 * @param {Map<string, File>} [out]
 * @param {(count:number)=>void} [report]
 */
export async function filesFromHandle(dirHandle, prefix = '', out = new Map(), report) {
  await readHandle(dirHandle, prefix, out, report, makeGates());
  return sortByPath(out);
}

async function readHandle(dirHandle, prefix, out, report, gates) {
  const files = [];
  const dirs = [];
  await gates.dir(async () => {
    for await (const [name, handle] of dirHandle.entries()) {
      (handle.kind === 'file' ? files : dirs).push([name, handle]);
    }
  });
  // 이 폴더의 파일과 하위 폴더를 한꺼번에 진행한다 (하위 폴더가 수천 개인 지형 타일 폴더에서 특히 빠르다)
  await Promise.all([
    ...files.map(([name, handle]) =>
      gates.file(async () => {
        out.set(prefix + name, await handle.getFile());
        report?.(out.size);
      }),
    ),
    ...dirs.map(([name, handle]) => readHandle(handle, `${prefix}${name}/`, out, report, gates)),
  ]);
  return out;
}

/** <input webkitdirectory>의 FileList -> Map. 첫 경로 조각(선택한 폴더 이름)은 뗀다. */
export function filesFromFileList(fileList) {
  const out = new Map();
  let folderName = '';
  for (const f of fileList) {
    const rel = f.webkitRelativePath || f.name;
    const parts = rel.split('/');
    if (parts.length > 1) {
      folderName = parts[0];
      out.set(parts.slice(1).join('/'), f);
    } else {
      out.set(rel, f);
    }
  }
  return { files: out, name: folderName };
}

function pickViaInput(hooks) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      input.remove();
      if (!input.files || input.files.length === 0) return reject(new DOMException('선택 취소', 'AbortError'));
      hooks.onPicked?.();
      const { files, name } = filesFromFileList(input.files);
      hooks.onProgress?.(files.size);
      resolve({ kind: 'files', files, name: name || 'local folder' });
    });
    input.addEventListener('cancel', () => {
      input.remove();
      reject(new DOMException('선택 취소', 'AbortError'));
    });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * 폴더 선택 창을 연다. 반드시 사용자 클릭 같은 제스처 안에서 호출해야 한다.
 * 취소하면 name이 'AbortError'인 예외가 난다.
 * @param {ReadHooks} [hooks]
 * @returns {Promise<{kind:'files', files:Map<string,File>, name:string}>}
 */
export async function pickFolder(hooks = {}) {
  if (supportsDirectoryPicker()) {
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    hooks.onPicked?.();
    const r = makeReporter(hooks.onProgress);
    const files = await filesFromHandle(handle, '', new Map(), r.report);
    r.done(files.size);
    return { kind: 'files', files, name: handle.name };
  }
  return pickViaInput(hooks);
}

/**
 * glb 파일 한 개를 고른다 (파일 선택창). 취소하면 name이 'AbortError'인 예외.
 * 반드시 사용자 클릭 같은 제스처 안에서 호출해야 한다.
 * @returns {Promise<File>}
 */
export function pickGlbFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb,model/gltf-binary';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      input.remove();
      const f = input.files?.[0];
      if (!f) return reject(new DOMException('선택 취소', 'AbortError'));
      resolve(f);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      reject(new DOMException('선택 취소', 'AbortError'));
    });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * drop 이벤트에서 glb 파일 한 개를 꺼낸다. 폴더이거나 glb가 아니면 null (폴더 열기 경로로 넘어간다).
 * @param {DragEvent} event
 * @returns {File|null}
 */
export function glbFromDropEvent(event) {
  const items = [...(event.dataTransfer?.items ?? [])].filter((i) => i.kind === 'file');
  if (items.length !== 1) return null;
  const entry = items[0].webkitGetAsEntry?.();
  if (entry && !entry.isFile) return null; // 폴더
  const file = items[0].getAsFile();
  return file && /\.glb$/i.test(file.name) ? file : null;
}

function readAllEntries(reader) {
  return new Promise((resolve, reject) => {
    const all = [];
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          next(); // readEntries는 한 번에 일부(보통 100개)만 주므로 빌 때까지 반복
        }
      }, reject);
    next();
  });
}

async function walkEntries(entries, prefix, out, report, gates = makeGates()) {
  const files = entries.filter((e) => e.isFile);
  const dirs = entries.filter((e) => e.isDirectory);
  await Promise.all([
    ...files.map((entry) =>
      gates.file(async () => {
        out.set(prefix + entry.name, await new Promise((res, rej) => entry.file(res, rej)));
        report?.(out.size);
      }),
    ),
    ...dirs.map(async (dir) => {
      const children = await gates.dir(() => readAllEntries(dir.createReader()));
      await walkEntries(children, `${prefix}${dir.name}/`, out, report, gates);
    }),
  ]);
}

/**
 * drop 이벤트에서 놓은 것 전부(파일과 폴더)를 읽는다. 폴더 안은 하위 폴더까지 편다.
 * 폴더 하나만 놓았으면 경로는 그 폴더 기준(tileset.json 등), 그 밖에는 놓은 이름부터 시작한다.
 * @param {DragEvent} event
 * @param {ReadHooks} [hooks]
 * @returns {Promise<{files:Map<string,File>, name:string, singleFolder:boolean}>}
 */
export async function allFromDropEvent(event, hooks = {}) {
  // dataTransfer는 await 전에 모두 꺼내 둔다.
  const items = [...(event.dataTransfer?.items ?? [])].filter((i) => i.kind === 'file');
  const entries = items.map((i) => ({ entry: i.webkitGetAsEntry?.() ?? null, file: i.getAsFile() }));
  const out = new Map();
  const r = makeReporter(hooks.onProgress);
  const single = entries.length === 1 && entries[0].entry?.isDirectory;
  hooks.onPicked?.();
  if (single) {
    await walkEntries(await readAllEntries(entries[0].entry.createReader()), '', out, r.report);
  } else {
    for (const { entry, file } of entries) {
      if (entry?.isDirectory) await walkEntries(await readAllEntries(entry.createReader()), `${entry.name}/`, out, r.report);
      else if (file) out.set(file.name, file);
    }
  }
  sortByPath(out);
  r.done(out.size);
  return { files: out, name: single ? entries[0].entry.name : (entries[0]?.file?.name ?? ''), singleFolder: !!single };
}

/**
 * drop 이벤트에서 폴더를 읽는다. 폴더가 아닌 파일만 놓았으면 예외.
 * @param {DragEvent} event
 * @param {ReadHooks} [hooks]
 */
export async function fromDropEvent(event, hooks = {}) {
  // dataTransfer는 이벤트 핸들러가 끝나면 비워지므로 await 전에 필요한 것을 모두 꺼내 둔다.
  const item = [...(event.dataTransfer?.items ?? [])].find((i) => i.kind === 'file');
  const entry = item?.webkitGetAsEntry?.();
  if (!entry || !entry.isDirectory) throw new Error('폴더를 끌어다 놓아 주세요 (파일이 아니라 tileset.json이 들어 있는 폴더).');
  hooks.onPicked?.();
  const out = new Map();
  const r = makeReporter(hooks.onProgress);
  await walkEntries(await readAllEntries(entry.createReader()), '', out, r.report);
  sortByPath(out);
  r.done(out.size);
  return { kind: 'files', files: out, name: entry.name };
}
