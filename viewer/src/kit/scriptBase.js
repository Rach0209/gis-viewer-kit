/**
 * 번들(`<script>`)이 놓인 폴더를 기준으로 디코더(draco/, basis/) 경로를 정한다.
 *
 * 번들 진입점(bundle.js)이 자기 URL(`import.meta.url`, IIFE 빌드에서는 Vite가
 * 현재 실행 중인 <script>의 src로 바꿔 준다)을 한 번 등록한다. 등록하지 않은 환경
 * (개발 서버의 /kit-demo.html 등)에서는 기존 값 '/'(Vite public/)을 그대로 쓴다.
 */
let scriptUrl = null;

/** @param {string} url 번들 파일의 URL */
export function setScriptUrl(url) {
  scriptUrl = typeof url === 'string' && url ? url : null;
}

/** @returns {string} 끝에 /가 붙은 접두어. 예: 'https://cdn.example.com/tv/' -> draco/는 그 아래 */
export function defaultDecoderBaseUrl() {
  if (!scriptUrl) return '/';
  try {
    // '.' 로 풀면 쿼리/해시 없이 파일이 있는 폴더가 된다
    return new URL('.', scriptUrl).href;
  } catch {
    return '/';
  }
}
