// node_modules/cesium 의 정적 에셋(Cesium.js, Workers, Widgets, ThirdParty, Assets)을 public/cesium 으로 복사한다.
// Cesium.js는 일반 <script>로 읽어야 해서 Vite가 변환하지 않는 public/ 에 둔다 (docs/07-cesium-spike.md 3번).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(fileURLToPath(new URL('.', import.meta.url)), '..');
const src = path.join(root, 'node_modules', 'cesium', 'Build', 'Cesium');
const dst = path.join(root, 'public', 'cesium');

if (!fs.existsSync(src)) {
  console.error('node_modules/cesium 이 없습니다. 먼저 `npm install` 을 실행하세요.');
  process.exit(1);
}
const version = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'cesium', 'package.json'), 'utf8')).version;
const stamp = path.join(dst, '.version');
if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === version) {
  console.log(`Cesium ${version} 에셋이 이미 있습니다.`);
  process.exit(0);
}
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
for (const name of ['Cesium.js', 'Widgets', 'Workers', 'ThirdParty', 'Assets']) {
  fs.cpSync(path.join(src, name), path.join(dst, name), { recursive: true });
}
fs.writeFileSync(stamp, version);
console.log(`Cesium ${version} 에셋을 public/cesium 으로 복사했습니다.`);
