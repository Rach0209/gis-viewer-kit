import { defineConfig } from 'vite';
import { cpSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 사이트(GitHub Pages 등)에 올릴 3D 뷰어 데모 빌드: `npm run build:site` -> viewer/dist-site/
//
//   dist-site/index.html   데모 화면 (kit-demo.html 을 index.html 로 바꿔 담는다)
//   dist-site/assets/      번들된 스크립트·스타일
//   dist-site/draco/, basis/   디코더 (Draco / KTX2)
//
// base './' 라서 어느 하위 경로(/저장소이름/viewer/)에 올려도 동작한다.
// public/ 은 통째로 복사하지 않는다 (개발용 타일 연결 폴더 public/tiles-real 이 1GB가 넘을 수 있다): 디코더만 복사한다.
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist-site',
    emptyOutDir: true,
    rollupOptions: { input: join(root, 'kit-demo.html') },
  },
  plugins: [
    {
      name: 'site-extras',
      closeBundle() {
        // 빌드가 다 끝난 뒤: kit-demo.html -> index.html, 디코더 복사
        const dist = join(root, 'dist-site');
        if (!existsSync(join(dist, 'kit-demo.html'))) throw new Error('빌드 결과에 kit-demo.html 이 없습니다');
        renameSync(join(dist, 'kit-demo.html'), join(dist, 'index.html'));
        for (const name of ['draco', 'basis', 'samples']) {
          const from = join(root, 'public', name);
          if (!existsSync(from)) throw new Error(`디코더 폴더가 없습니다: ${from}`);
          cpSync(from, join(dist, name), { recursive: true });
        }
      },
    },
  ],
  test: { environment: 'node' },
});
