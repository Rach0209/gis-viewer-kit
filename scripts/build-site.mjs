// GitHub Pages 등에 올릴 사이트(_site/)를 만든다.
//
//   _site/index.html   시작 화면 (site/index.html)
//   _site/viewer/      3D 뷰어 데모 (three.js)   <- viewer 의 build:site
//   _site/gis/         GIS 작업실 (Cesium)       <- gis 의 build
//
// 실행: node scripts/build-site.mjs            (각 페이지를 빌드한 뒤 묶는다)
//       node scripts/build-site.mjs --skip-build   (이미 빌드한 결과만 묶는다)
// 미리 보기: node scripts/serve-site.mjs
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const out = join(root, '_site');
const run = (cmd, cwd) => {
  console.log(`\n$ ${cmd}   (${cwd.replace(root, '.') || '.'})`);
  execSync(cmd, { cwd, stdio: 'inherit' });
};

if (!process.argv.includes('--skip-build')) {
  run('npm run build:site', join(root, 'viewer'));
  run('npm run build', join(root, 'gis'));
}

const need = [join(root, 'viewer', 'dist-site', 'index.html'), join(root, 'gis', 'dist', 'index.html'), join(root, 'site', 'index.html')];
for (const f of need) if (!existsSync(f)) throw new Error(`없는 파일: ${f}\n먼저 각 페이지를 빌드하세요 (--skip-build 없이 실행).`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'site'), out, { recursive: true });
cpSync(join(root, 'viewer', 'dist-site'), join(out, 'viewer'), { recursive: true });
cpSync(join(root, 'gis', 'dist'), join(out, 'gis'), { recursive: true });
writeFileSync(join(out, '.nojekyll'), ''); // GitHub Pages 가 밑줄로 시작하는 파일 등을 건너뛰지 않게
console.log(`\n사이트를 만들었습니다: ${out}`);
