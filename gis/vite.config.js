import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// 이 페이지는 three.js 뷰어(../viewer)의 순수 계산 모듈(좌표계, glb 검사, 배경 지도 공급자 정의)을 같이 쓴다.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './', // 하위 경로에 올려도(GitHub Pages: /저장소이름/gis/) 파일을 찾도록 상대 경로
  server: { port: 5178, strictPort: true, fs: { allow: [repoRoot] } },
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'node' },
});
