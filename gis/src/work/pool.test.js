import { describe, expect, it } from 'vitest';
import { createPool, ownBuffer, transferred, unwrapTransferred } from './pool.js';

/** 메시지를 받으면 handler 결과를 비동기로 돌려주는 가짜 워커 */
function fakeWorkerFactory(handler) {
  const made = [];
  const makeWorker = () => {
    const w = {
      id: made.length,
      terminated: false,
      calls: [],
      onmessage: null,
      onerror: null,
      postMessage(msg, transfer) {
        w.calls.push({ msg, transfer });
        Promise.resolve()
          .then(() => handler(msg.task, msg.args, w))
          .then((value) => w.onmessage({ data: { id: msg.id, ok: true, value } }))
          .catch((e) => w.onmessage({ data: { id: msg.id, ok: false, error: e.message } }));
      },
      terminate() {
        w.terminated = true;
      },
    };
    made.push(w);
    return w;
  };
  return { makeWorker, made };
}

describe('transferred / ownBuffer', () => {
  it('값과 넘길 버퍼 목록을 묶고 풀어낸다', () => {
    const buf = new ArrayBuffer(8);
    const t = transferred({ a: 1 }, [buf]);
    expect(unwrapTransferred(t)).toEqual({ value: { a: 1 }, transfer: [buf] });
    expect(unwrapTransferred(5)).toEqual({ value: 5, transfer: [] });
  });
  it('타입 배열이 버퍼 전체를 쓸 때만 넘김 목록에 넣는다', () => {
    const whole = new Float32Array(4);
    expect(ownBuffer(whole)).toEqual([whole.buffer]);
    expect(ownBuffer(new Float32Array(whole.buffer, 4, 2))).toEqual([]);
    expect(ownBuffer(null)).toEqual([]);
  });
});

describe('createPool: 워커 없이(inline)', () => {
  it('runInline 결과의 값만 돌려준다 (transferred 포장은 벗긴다)', async () => {
    const pool = createPool({ runInline: async (task, args) => transferred({ task, args }, []) });
    expect(pool.mode).toBe('inline');
    expect(await pool.run('t', { x: 1 })).toEqual({ task: 't', args: { x: 1 } });
    const lease = pool.lease();
    expect(await lease.run('u', 2)).toEqual({ task: 'u', args: 2 });
    lease.release();
  });
  it('오류는 그대로 던진다', async () => {
    const pool = createPool({
      runInline: async () => {
        throw new Error('깨짐');
      },
    });
    await expect(pool.run('t', null)).rejects.toThrow('깨짐');
  });
});

describe('createPool: 워커', () => {
  it('작업 결과를 돌려주고, 오류 메시지를 Error로 바꿔 던진다', async () => {
    const { makeWorker } = fakeWorkerFactory((task, args) => {
      if (task === 'bad') throw new Error('읽을 수 없습니다');
      return { echo: args };
    });
    const pool = createPool({ makeWorker, size: 2 });
    expect(pool.mode).toBe('worker');
    expect(await pool.run('ok', 7)).toEqual({ echo: 7 });
    await expect(pool.run('bad', 1)).rejects.toThrow('읽을 수 없습니다');
  });

  it('동시에 맡기면 워커를 size개까지 늘려 나눠 준다', async () => {
    const { makeWorker, made } = fakeWorkerFactory((task, args) => args);
    const pool = createPool({ makeWorker, size: 3 });
    await Promise.all([1, 2, 3, 4, 5, 6].map((i) => pool.run('t', i)));
    expect(made.length).toBe(3);
    expect(made.every((w) => w.calls.length === 2)).toBe(true);
  });

  it('차례로 맡기면(한가하면) 워커를 새로 만들지 않는다', async () => {
    const { makeWorker, made } = fakeWorkerFactory((t, a) => a);
    const pool = createPool({ makeWorker, size: 3 });
    for (let i = 0; i < 5; i++) await pool.run('t', i);
    expect(made.length).toBe(1);
  });

  it('lease는 같은 워커에 붙고, 서로 다른 lease는 다른 워커로 퍼진다', async () => {
    const { makeWorker, made } = fakeWorkerFactory((t, a, w) => w.id);
    const pool = createPool({ makeWorker, size: 3 });
    const a = pool.lease();
    const b = pool.lease();
    const ida = await a.run('t');
    const idb = await b.run('t');
    expect(ida).not.toBe(idb);
    expect(await a.run('t')).toBe(ida);
    expect(await a.run('t')).toBe(ida);
    a.release();
    b.release();
    expect(made.length).toBe(2);
  });

  it('워커가 죽으면(onerror) 기다리던 작업을 모두 실패시키고, 다음 작업은 새 워커로 한다', async () => {
    let hang = true;
    const { makeWorker, made } = fakeWorkerFactory((t, a) => (hang ? new Promise(() => {}) : a));
    const pool = createPool({ makeWorker, size: 1 });
    const p = pool.run('t', 1);
    await Promise.resolve();
    made[0].onerror({ message: '워커 오류' });
    await expect(p).rejects.toThrow('워커 오류');
    expect(made[0].terminated).toBe(true);
    hang = false;
    expect(await pool.run('t', 2)).toBe(2);
    expect(made.length).toBe(2);
  });

  it('transfer 목록을 postMessage에 넘긴다', async () => {
    const { makeWorker, made } = fakeWorkerFactory((t, a) => a);
    const pool = createPool({ makeWorker });
    const buf = new ArrayBuffer(4);
    await pool.run('t', { buf }, [buf]);
    expect(made[0].calls[0].transfer).toEqual([buf]);
  });
});
