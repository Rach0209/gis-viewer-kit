/**
 * `<script>` / ES 모듈 번들의 진입점. 빌드 설정은 viewer/vite.lib.config.js.
 *
 *   <script src="tile-viewer.iife.js"></script>
 *   <script>const viewer = TileViewer.create(el, { persistence: 'localStorage' });</script>
 *
 * docs/03-viewer-api.md 의 `TileViewer.create(container, options)` 형태를 그대로 따른다.
 */
import { setScriptUrl } from './scriptBase.js';

// 이 번들이 놓인 위치를 기억해 두면 디코더(draco/, basis/)를 번들 옆에서 찾는다.
//  - <script src> (IIFE): 스크립트가 실행되는 이 순간에만 document.currentScript가 유효하다.
//    (빌드러(rolldown)는 IIFE의 import.meta를 빈 객체로 바꾸므로 import.meta.url은 쓸 수 없다.)
//  - ES 모듈: currentScript는 null이고 import.meta.url이 이 파일의 URL이다.
const currentScript = typeof document !== 'undefined' ? document.currentScript : null;
setScriptUrl((currentScript && currentScript.src) || import.meta.url);

export { createTileViewer, createTileViewer as create } from './TileViewer.js';
export { pickFolder, fromDropEvent, supportsDirectoryPicker } from './folderPicker.js';
export { analyzeTileset } from './analyzeTileset.js';
export { inspectContent } from './inspectContent.js';
export { createLocalStorageAdapter } from './persistence.js';

/* global __TVK_VERSION__ */
export const VERSION = typeof __TVK_VERSION__ !== 'undefined' ? __TVK_VERSION__ : 'dev';

export { CRS_LIST } from './crsList.js';
export { inspectGlb } from './glbInspect.js';
