/** 파싱 워커 진입점. 메시지 {id, task, args}를 받아 tasks.js 의 작업을 돌리고 {id, ok, value|error}로 답한다. */
import { unwrapTransferred } from './pool.js';
import { runTask } from './tasks.js';

self.onmessage = async (ev) => {
  const { id, task, args } = ev.data;
  try {
    const { value, transfer } = unwrapTransferred(await runTask(task, args));
    self.postMessage({ id, ok: true, value }, transfer);
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e?.message ?? e) });
  }
};
