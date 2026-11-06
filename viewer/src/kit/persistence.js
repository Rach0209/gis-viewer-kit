/**
 * 메모 저장소 (docs/03-viewer-api.md 6절의 PersistenceAdapter).
 *
 * @typedef {Object} PersistenceAdapter
 * @property {(scope: string) => Promise<Array>|Array} load
 * @property {(scope: string, items: Array) => Promise<void>|void} save
 *
 * scope에는 타일셋 이름과 모드가 들어간다. 다른 타일셋의 메모가 섞이지 않게 하기 위함이다.
 * 서버가 생기면(P4 이후) REST 구현을 같은 모양으로 만들어 넘기면 된다.
 */

/** @param {string} [prefix] @param {Storage} [storage] 테스트에서 가짜 저장소를 주입할 수 있다 */
export function createLocalStorageAdapter(prefix = 'gis-viewer-kit:annotations:', storage) {
  const store = () => storage ?? globalThis.localStorage;
  return {
    load(scope) {
      try {
        const raw = store().getItem(prefix + scope);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        // 접근 불가(프라이빗 모드 등)나 손상된 JSON은 "저장된 게 없음"과 같게 취급한다.
        return [];
      }
    },
    save(scope, items) {
      try {
        store().setItem(prefix + scope, JSON.stringify(items));
      } catch {
        // 용량 초과 등은 조용히 무시한다. 메모는 이번 세션 화면에는 그대로 남는다.
      }
    },
  };
}

/** @param {'none'|'localStorage'|PersistenceAdapter|undefined} option @returns {PersistenceAdapter|null} */
export function resolvePersistence(option) {
  if (!option || option === 'none') return null;
  if (option === 'localStorage') return createLocalStorageAdapter();
  if (typeof option.load === 'function' && typeof option.save === 'function') return option;
  throw new Error("persistence는 'none' | 'localStorage' | { load, save } 중 하나여야 합니다");
}
