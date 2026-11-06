/**
 * Cesium이 파일을 읽는 단계(Resource._Implementations.loadWithXhr)를 가로채, 가짜 주소(virtualFiles.js)면
 * 서버가 아니라 사용자가 고른 로컬 파일에서 읽게 한다. 그래서 백엔드 없이 로컬 폴더의 3D Tiles를 열 수 있다.
 *
 * 주의: `_Implementations`는 밑줄로 시작하는 Cesium **내부(비공개) 함수**다. Cesium을 올릴 때 깨질 수 있어
 * package.json에서 버전을 고정(1.147.0)했고, 함수가 없으면 아래에서 분명한 오류로 알려 준다.
 */
import { readAs } from './virtualFiles.js';

let installed = false;

export function installLocalFileLoader(Cesium, folders) {
  if (installed) return;
  const impl = Cesium.Resource?._Implementations;
  if (typeof impl?.loadWithXhr !== 'function') {
    throw new Error(`이 Cesium 버전(${Cesium.VERSION})에서는 로컬 폴더 읽기를 지원하지 않습니다 (Resource._Implementations.loadWithXhr 없음). 1.147.0을 사용하세요.`);
  }
  const original = impl.loadWithXhr;
  impl.loadWithXhr = function loadWithXhr(url, responseType, method, data, headers, deferred, overrideMimeType) {
    const hit = folders.resolve(url);
    if (!hit) return original.call(this, url, responseType, method, data, headers, deferred, overrideMimeType);
    if (!hit.file) {
      deferred.reject(new Cesium.RequestErrorEvent(404, undefined, `선택한 폴더에 없는 파일: ${hit.rel}`));
      return undefined;
    }
    readAs(hit.file, responseType).then(deferred.resolve, deferred.reject);
    return undefined;
  };
  installed = true;
}
