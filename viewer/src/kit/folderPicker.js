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

/** items를 limit개씩 동시에 처리한다. 하나라도 실패하면 전체가 실패한다. */
async function mapLimit(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

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

/**
 * FileSystemDirectoryHandle 아래의 모든 파일을 읽는다.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} [prefix]
 * @param {Map<string, File>} [out]
 * @param {(count:number)=>void} [report]
 */
export async function filesFromHandle(dirHandle, prefix = '', out = new Map(), report) {
  const files = [];
  const dirs = [];
  for await (const [name, handle] of dirHandle.entries()) {
    (handle.kind === 'file' ? files : dirs).push([name, handle]);
  }
  await mapLimit(files, READ_CONCURRENCY, async ([name, handle]) => {
    out.set(prefix + name, await handle.getFile());
    report?.(out.size);
  });
  for (const [name, handle] of dirs) {
    await filesFromHandle(handle, `${prefix}${name}/`, out, report);
  }
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

async function walkEntries(entries, prefix, out, report) {
  const files = entries.filter((e) => e.isFile);
  const dirs = entries.filter((e) => e.isDirectory);
  await mapLimit(files, READ_CONCURRENCY, async (entry) => {
    out.set(prefix + entry.name, await new Promise((res, rej) => entry.file(res, rej)));
    report?.(out.size);
  });
  for (const dir of dirs) {
    await walkEntries(await readAllEntries(dir.createReader()), `${prefix}${dir.name}/`, out, report);
  }
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
  r.done(out.size);
  return { kind: 'files', files: out, name: entry.name };
}
