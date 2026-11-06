/**
 * 레이어별 메모를 이 브라우저(localStorage)에 저장한다. 레이어 목록은 새로고침하면 사라지지만,
 * 같은 이름·종류의 레이어를 다시 열면 메모를 불러온다. 저장소를 못 쓰는 환경(시크릿 창 등)에서는 조용히 메모리에서만 동작한다.
 */

const PREFIX = 'tvk-gis-memo:';
export const MEMO_MAX = 2000;

export const memoKey = (kind, name) => `${PREFIX}${kind}:${name}`;

function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // 접근만 해도 예외가 날 수 있다
  }
}

/** @param {{getItem:Function, setItem:Function, removeItem:Function}|null} [storage] */
export function createMemoStore(storage = browserStorage()) {
  const fallback = new Map(); // 저장소가 없을 때 이 페이지 안에서만
  return {
    load(kind, name) {
      const key = memoKey(kind, name);
      try {
        if (storage) return storage.getItem(key) ?? '';
      } catch {
        // 아래 대체 저장으로
      }
      return fallback.get(key) ?? '';
    },
    /** 글자가 비면 지운다. 너무 길면 자른다. 저장소에 실제로 썼으면 true */
    save(kind, name, text) {
      const key = memoKey(kind, name);
      const t = String(text ?? '').slice(0, MEMO_MAX);
      try {
        if (storage) {
          if (t) storage.setItem(key, t);
          else storage.removeItem(key);
          return true;
        }
      } catch {
        // 용량 초과 등: 대체 저장으로
      }
      if (t) fallback.set(key, t);
      else fallback.delete(key);
      return false;
    },
  };
}
