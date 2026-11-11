import { createTileViewer, listBackendTilesets } from './index.js';

const viewer = createTileViewer(document.getElementById('viewer'), {
  mode: 'auto',
  // 디코더(draco/, basis/)는 이 페이지와 같은 사이트의 base 아래에 있다 (개발 서버는 '/', 하위 경로로 배포하면 그 폴더)
  decoderBaseUrl: new URL(import.meta.env.BASE_URL, window.location.href).href,
  persistence: 'localStorage', // 메모를 이 브라우저에 저장 (타일셋 이름+모드별)
  sampleGlbUrl: new URL(`${import.meta.env.BASE_URL}samples/house-5186.glb`, window.location.href).href, // "예제 glb" 버튼
});

// 사이트(GitHub Pages 등)로 빌드한 화면에서만 시작 화면으로 돌아가는 링크를 보인다 (개발 서버에서는 상위 폴더가 없다)
if (import.meta.env.PROD) document.getElementById('home-link').hidden = false;

document.getElementById('load-url').addEventListener('click', () => {
  const url = document.getElementById('url').value.trim();
  if (url) viewer.loadTileset({ kind: 'url', url }).catch(() => {});
});

// ---- Java 서버(모드 B) ----
const $ = (id) => document.getElementById(id);
async function refreshServerList() {
  const msg = $('server-msg');
  msg.textContent = '서버 확인 중…';
  try {
    const list = await listBackendTilesets($('api').value.trim());
    const sel = $('server-tilesets');
    sel.replaceChildren(
      ...list.map((t) => {
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = `${t.name}${t.sizeBytes ? ` (${(t.sizeBytes / 1048576).toFixed(0)}MB)` : ''}`;
        return o;
      }),
    );
    sel.hidden = $('load-server').hidden = list.length === 0;
    msg.textContent = list.length ? `타일셋 ${list.length}개` : '서버에 등록된 타일셋이 없습니다.';
    return list;
  } catch (e) {
    $('server-tilesets').hidden = $('load-server').hidden = true;
    msg.textContent = e.message;
    return [];
  }
}
$('list-server').addEventListener('click', refreshServerList);
$('load-server').addEventListener('click', () => {
  const id = $('server-tilesets').value;
  if (id) viewer.loadTileset({ kind: 'backend', apiUrl: $('api').value.trim(), id }).catch(() => {});
});

// 쿼리로 바로 열기: /kit-demo.html?url=/tiles-real/tileset.json&errorTarget=32&fade=0
// (콘솔 디버깅/자동 검증용. 서버에 올라간 URL만 해당하며 로컬 폴더는 '폴더 열기' 버튼을 쓴다.)
const q = new URLSearchParams(location.search);
if (q.get('url')) {
  document.getElementById('url').value = q.get('url');
  const profile = {};
  if (q.get('errorTarget')) profile.errorTarget = Number(q.get('errorTarget'));
  if (q.get('fade') === '0') profile.enableFade = false;
  viewer.loadTileset({ kind: 'url', url: q.get('url') }, profile).catch(() => {});
}

// /kit-demo.html?server=http://localhost:8080&id=site-a  (서버 경유 로드를 바로 확인)
if (q.get('server')) {
  $('server-box').open = true; // 접혀 있는 서버 줄을 펼친다
  $('api').value = q.get('server');
  refreshServerList().then(() => {
    if (q.get('id')) {
      $('server-tilesets').value = q.get('id');
      viewer.loadTileset({ kind: 'backend', apiUrl: q.get('server'), id: q.get('id') }).catch(() => {});
    }
  });
}

window.tileViewer = viewer; // 개발 중 콘솔 접근용
