import { defineConfig } from 'vite';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `<script>` / ES 모듈 번들 빌드: `npm run build:lib` -> dist/
//
//   dist/tile-viewer.iife.js   <script src>로 쓰는 단일 파일. 전역 TileViewer
//   dist/tile-viewer.es.js     import 용
//   dist/draco/, dist/basis/   디코더 (번들 옆에 같이 배포해야 한다)
//   dist/index.html            임베드 예제 (examples/embed.html)
//
// 앱 빌드(`npm run build`, vite.config.js)와 따로 둔다: 여기서는 public/을 통째로
// 복사하지 않는다 (개발용 타일 정션 public/tiles-real 이 1GB가 넘는다).
const root = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * 번들에 실제로 들어간 외부 패키지(node_modules)의 라이선스를 모아 dist/THIRD-PARTY-NOTICES.txt 로 쓴다.
 * 배포물에 라이선스 고지를 함께 두기 위한 것 (MIT/Apache-2.0 등은 고지를 요구한다).
 */
function thirdPartyNotices() {
  const roots = new Map(); // 패키지 루트 경로 -> true
  const pkgRoot = (id) => {
    const clean = id.split('?')[0].split(String.fromCharCode(92)).join('/'); // 윈도우 경로의 역슬래시를 슬래시로
    const i = clean.lastIndexOf('/node_modules/');
    if (i < 0) return null;
    const rest = clean.slice(i + '/node_modules/'.length).split('/');
    const name = rest[0].startsWith('@') ? rest.slice(0, 2).join('/') : rest[0];
    return clean.slice(0, i) + '/node_modules/' + name;
  };
  return {
    name: 'tvk-third-party-notices',
    apply: 'build',
    generateBundle(_o, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of Object.keys(chunk.modules)) {
          const r = pkgRoot(id);
          if (r) roots.set(r, true);
        }
      }
    },
    closeBundle() {
      const parts = [
        'THIRD-PARTY NOTICES',
        '',
        '이 번들(tile-viewer.*.js)에는 아래 오픈소스 패키지가 포함되어 있습니다.',
        '디코더 폴더(draco/, basis/)는 Google Draco(Apache-2.0)와 Binomial Basis Universal(Apache-2.0)에서 온 파일입니다.',
        '',
      ];
      for (const r of [...roots.keys()].sort()) {
        const pj = join(r, 'package.json');
        if (!existsSync(pj)) continue;
        const p = JSON.parse(readFileSync(pj, 'utf8'));
        const lic = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE', 'LICENSE-MIT']
          .map((n) => join(r, n))
          .find((x) => existsSync(x));
        parts.push('='.repeat(72), `${p.name} ${p.version}  (${typeof p.license === 'string' ? p.license : JSON.stringify(p.license)})`, p.homepage || p.repository?.url || '', '');
        parts.push(lic ? readFileSync(lic, 'utf8').trim() : '(라이선스 파일을 찾지 못했습니다. 위 패키지 페이지를 참고하세요.)', '');
      }
      writeFileSync(`${root}dist/THIRD-PARTY-NOTICES.txt`, parts.join('\n'));
    },
  };
}

function copyRuntimeAssets() {
  return {
    name: 'tvk-copy-runtime-assets',
    apply: 'build',
    closeBundle() {
      // 디코더는 필수 런타임 파일이다. 필요한 폴더만 골라 복사한다.
      cpSync(`${root}public/draco`, `${root}dist/draco`, { recursive: true });
      cpSync(`${root}public/basis`, `${root}dist/basis`, { recursive: true });
      cpSync(`${root}examples/embed.html`, `${root}dist/index.html`);
      if (existsSync(`${root}../LICENSE`)) cpSync(`${root}../LICENSE`, `${root}dist/LICENSE`);
    },
  };
}

/**
 * three의 DRACOLoader/KTX2Loader는 모듈 최상단에서 자체 기본 디코더 주소를
 * `new URL('../libs/...', import.meta.url)`로 만든다. 이 기본값은 setDecoderPath()/
 * setTranscoderPath()를 호출하지 않았을 때만 쓰이고, 우리는 항상 호출한다
 * (Tiles3DLayer.onAdd). 그런데 라이브러리 빌드에서는 두 가지 문제가 생긴다:
 *   1) 그 파일들을 base64로 번들에 인라인해서 크기가 약 1.7MB 늘어난다 (dist/draco, basis와 중복).
 *   2) IIFE에서는 import.meta가 빈 객체가 되어 `new URL(.., undefined)`가 로드 시점에 예외를 던진다.
 * 그래서 이 기본값만 빈 문자열로 바꾼다.
 */
function stripThreeDefaultDecoderUrls() {
  const target = /[\\/]three[\\/]examples[\\/]jsm[\\/]loaders[\\/](DRACOLoader|KTX2Loader)\.js$/;
  const pattern = /new URL\(\s*'[^']*'\s*,\s*import\.meta\.url\s*\)\.toString\(\)/g;
  return {
    name: 'tvk-strip-three-default-decoder-urls',
    enforce: 'pre',
    transform(code, id) {
      if (!target.test(id)) return null;
      const out = code.replace(pattern, "''");
      return out === code ? null : { code: out, map: null };
    },
  };
}

export default defineConfig({
  root,
  publicDir: false,
  // __TVK_BACKEND__: false = Java 서버 연결 코드를 번들에서 뺀다 (클라이언트 전용 배포물)
  define: { __TVK_VERSION__: JSON.stringify(pkg.version), __TVK_BACKEND__: 'false' },
  plugins: [stripThreeDefaultDecoderUrls(), copyRuntimeAssets(), thirdPartyNotices()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 소스맵(각 약 4.8MB)은 디버깅할 때만: TVK_SOURCEMAP=1 npm run build:lib
    sourcemap: process.env.TVK_SOURCEMAP === '1',
    rolldownOptions: {
      // bundle.js의 `import.meta.url` 폴백은 ES 빌드용이고 IIFE에서는 쓰이지 않는다
      // (document.currentScript를 먼저 본다). 그 의도된 경고만 숨긴다.
      onLog(level, log, handler) {
        if (log.code === 'EMPTY_IMPORT_META') return;
        handler(level, log);
      },
    },
    lib: {
      entry: 'src/kit/bundle.js',
      name: 'TileViewer',
      formats: ['es', 'iife'],
      fileName: (format) => (format === 'es' ? 'tile-viewer.es.js' : 'tile-viewer.iife.js'),
    },
  },
});
