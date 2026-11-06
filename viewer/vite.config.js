import { defineConfig } from 'vite';

// 개발 서버(`npm run dev`)와 시험(`npm test`) 설정.
//   - 3D 뷰어 화면은 http://localhost:5173/kit-demo.html
//   - 임베드용 번들은 vite.lib.config.js (`npm run build:lib`), 사이트용 빌드는 vite.site.config.js (`npm run build:site`)
export default defineConfig({
  test: {
    environment: 'node',
  },
});
