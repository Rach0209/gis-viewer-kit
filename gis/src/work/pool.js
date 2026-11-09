/**
 * 무거운 파싱을 웹 워커 여러 개에 나눠 맡기는 작은 풀.
 *
 * - run(task, args, transfer): 가장 한가한 워커에 한 번 맡긴다 (워커는 필요할 때 만들고, size개까지 늘린다).
 * - lease(): 워커 하나를 붙잡는다. 같은 lease로 보낸 작업은 같은 워커에서 돌아서, 워커 안에 읽어 둔 자료(예: 읽은 SHP)를 이어 쓸 수 있다.
 *   여러 lease는 서로 다른 워커로 퍼져서 병렬로 돈다. 다 쓰면 release().
 * - 워커를 쓸 수 없는 환경(Node 시험 등)에서는 runInline(task, args)로 그 자리에서 실행한다.
 *
 * 결과가 큰 배열이면 task 안에서 transferred(값, [buffer...])로 돌려주면 복사 없이 넘어온다.
 */

export class Transferred {
  constructor(value, list) {
    this.value = value;
    this.list = list;
  }
}

/** 복사하지 않고 넘길 ArrayBuffer 목록을 함께 돌려준다 */
export const transferred = (value, list = []) => new Transferred(value, list);

/** 타입 배열이 버퍼 전체를 쓰고 있을 때만 그 버퍼를 넘김 목록에 넣는다 (일부만 쓰면 다른 데이터까지 넘어가므로 복사로 둔다) */
export function ownBuffer(typed) {
  return typed && typed.buffer instanceof ArrayBuffer && typed.byteOffset === 0 && typed.byteLength === typed.buffer.byteLength ? [typed.buffer] : [];
}

export function unwrapTransferred(result) {
  return result instanceof Transferred ? { value: result.value, transfer: result.list } : { value: result, transfer: [] };
}

/**
 * @param {{makeWorker?: ()=>Worker, size?: number, runInline?: (task:string, args:any)=>Promise<any>}} o
 */
export function createPool({ makeWorker, size = 3, runInline } = {}) {
  const slots = [];
  const waiting = new Map();
  let seq = 0;

  function drop(slot, message) {
    const i = slots.indexOf(slot);
    if (i >= 0) slots.splice(i, 1);
    for (const [id, c] of waiting) {
      if (c.slot === slot) {
        waiting.delete(id);
        c.reject(new Error(message));
      }
    }
    try {
      slot.worker.terminate();
    } catch {
      /* 이미 끝난 워커 */
    }
  }

  function spawn() {
    const worker = makeWorker();
    const slot = { worker, pending: 0, pinned: 0 };
    worker.onmessage = (ev) => {
      const { id, ok, value, error } = ev.data;
      const c = waiting.get(id);
      if (!c) return;
      waiting.delete(id);
      c.slot.pending--;
      if (ok) c.resolve(value);
      else c.reject(new Error(error));
    };
    worker.onerror = (ev) => drop(slot, ev?.message || '백그라운드 작업에 실패했습니다.');
    slots.push(slot);
    return slot;
  }

  /** 붙잡힌 수(lease)가 적은 것, 같으면 대기 작업이 적은 것. 모두 바쁘고 더 만들 수 있으면 새로 만든다. */
  function pick(forLease) {
    let best = null;
    for (const s of slots) {
      if (!best) best = s;
      else if (forLease ? s.pinned < best.pinned || (s.pinned === best.pinned && s.pending < best.pending) : s.pending < best.pending || (s.pending === best.pending && s.pinned < best.pinned)) best = s;
    }
    const busy = !best || (forLease ? best.pinned > 0 || best.pending > 0 : best.pending > 0);
    if (busy && slots.length < size) return spawn();
    return best ?? spawn();
  }

  function call(slot, task, args, transfer) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve, reject, slot });
      slot.pending++;
      try {
        slot.worker.postMessage({ id, task, args }, transfer ?? []);
      } catch (e) {
        waiting.delete(id);
        slot.pending--;
        reject(e);
      }
    });
  }

  const inline = !makeWorker;
  const inlineRun = async (task, args) => {
    const r = await runInline(task, args);
    return unwrapTransferred(r).value;
  };

  return {
    /** 지금 워커를 쓰는 중인가 (시험·진단용) */
    get mode() {
      return inline ? 'inline' : 'worker';
    },
    get workerCount() {
      return slots.length;
    },
    run(task, args, transfer) {
      if (inline) return inlineRun(task, args);
      return call(pick(false), task, args, transfer);
    },
    lease() {
      if (inline) return { run: (task, args) => inlineRun(task, args), release() {} };
      const slot = pick(true);
      slot.pinned++;
      let released = false;
      return {
        run: (task, args, transfer) => call(slot, task, args, transfer),
        release() {
          if (released) return;
          released = true;
          slot.pinned = Math.max(0, slot.pinned - 1);
        },
      };
    },
    terminate() {
      for (const s of [...slots]) drop(s, '종료되었습니다.');
    },
  };
}
