// 만든 사이트(_site/)를 하위 경로(/gis-viewer-kit/)에서 미리 본다. GitHub Pages 처럼 하위 경로에서 동작하는지 확인하는 용도다.
// 실행: node scripts/serve-site.mjs [포트]   ->   http://localhost:4180/gis-viewer-kit/
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '_site');
const prefix = '/gis-viewer-kit/';
const port = Number(process.argv[2] ?? 4180);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.xml': 'application/xml', '.glb': 'model/gltf-binary' };

createServer((req, res) => {
  const url = new URL(req.url, 'http://x').pathname;
  if (!url.startsWith(prefix)) {
    res.writeHead(302, { Location: prefix });
    return res.end();
  }
  let rel = decodeURIComponent(url.slice(prefix.length));
  let file = normalize(join(root, rel));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    return res.end();
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('없는 파일');
  }
  res.writeHead(200, { 'Content-Type': types[extname(file).toLowerCase()] ?? 'application/octet-stream' });
  return createReadStream(file).pipe(res);
}).listen(port, () => console.log(`http://localhost:${port}${prefix}`));
