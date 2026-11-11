# gis-viewer-kit

내 **3D Tiles · glb · GeoJSON · SHP · 지형(DEM)** 을 **업로드 없이 브라우저에서 바로 열어 보는** 3D·GIS 도구입니다.
파일은 이 브라우저 안에서만 처리되고 어디로도 전송되지 않습니다. 서버가 필요 없어서 GitHub Pages 같은 정적 호스팅에 그대로 올릴 수 있습니다.

> 사이트: [web-page:](https://rach0209.github.io/gis-viewer-kit/)

사이트에는 두 가지 화면이 있습니다 (시작 화면에서 고릅니다).

| | **3D 뷰어** (`viewer/`, three.js) | **GIS 작업실** (`gis/`, Cesium) |
|---|---|---|
| 용도 | 타일셋이나 모델 하나를 가볍고 빠르게 자세히 | 지도 위에 여러 자료를 겹쳐 놓고 재고 확인 |
| 열 수 있는 것 | 3D Tiles 폴더(압축 타일 포함), glb | 3D Tiles, glb, SHP(SLD 스타일), GeoJSON, KML/KMZ, GPX, CSV(경도·위도 열), 항공·위성 사진(GeoTIFF, PNG/JPG+월드파일), 지형(GeoTIFF·텍스트 DEM·지형 타일) |
| 기능 | 타일셋 정보, 거리 재기, 메모, 스크린샷, 1인칭 걷기, **`<script>` 한 줄로 내 웹에 넣기** | 레이어 겹치기, 거리·면적 재기(꼭짓점 맞춤), **어떤 좌표계든 입력**(EPSG 번호·PROJ·WKT, 해외 포함), 클릭 정보, 레이어 메모, 스크린샷, **GeoJSON·CSV 저장**, glb 좌표 복사, **예제 열기** |
| 설명 | [docs/03-viewer-api.md](docs/03-viewer-api.md) | [docs/09-gis-page.md](docs/09-gis-page.md) |

## 로컬에서 실행

Node 20 이상이 필요합니다.

```bash
# 3D 뷰어
cd viewer
npm install
npm run dev          # http://localhost:5173/kit-demo.html
npm test

# GIS 작업실
cd ../gis
npm install
npm run dev          # http://localhost:5178
npm test
```

## `<script>` 한 줄로 내 웹페이지에 넣기

```bash
cd viewer
npm run build:lib       # -> viewer/dist/ (tile-viewer.iife.js, draco/, basis/, THIRD-PARTY-NOTICES.txt)
```

`dist/` 한 폴더를 정적 서버에 올리고 아래처럼 씁니다 (`draco/`, `basis/`는 스크립트 옆에 두면 자동으로 찾습니다).

```html
<div id="viewer" style="height:600px"></div>
<script src="tile-viewer.iife.js"></script>
<script>
  const viewer = TileViewer.create(document.getElementById('viewer'), { persistence: 'localStorage' });
  viewer.loadTileset({ kind: 'url', url: '/내/tileset.json' });   // 또는 화면의 '폴더 열기' / 폴더 끌어놓기
</script>
```

glb 한 개는 `viewer.loadModel(file)`(위치를 고르는 대화상자) 또는 `viewer.loadModel(file, { type: 'coords', crs: 'EPSG:5179', x, y, height })`로 엽니다. ES 모듈은 `import { create } from './tile-viewer.es.js'`. 전체 예제는 `viewer/examples/embed.html`, API는 [docs/03](docs/03-viewer-api.md).
이 번들은 **클라이언트 전용**이라 서버 연결 코드가 빠져 있습니다.

## 내 서버로 타일을 서빙하고 싶다면 (선택)

폴더를 직접 여는 방식이 기본이라 서버는 필요 없습니다. 내 서버에서 타일을 내려 받게 하고 싶다면 두 가지 방법이 있습니다.

1. **가장 간단**: 타일셋 폴더를 아무 정적 서버(nginx, Spring 정적 리소스, 클라우드 스토리지 등)로 서빙하고, **CORS를 허용**한 뒤 3D 뷰어의 `URL 열기`에 `…/tileset.json` 주소를 넣습니다. 큰 타일은 `Range` 요청과 `ETag`를 지원하면 더 빠릅니다.
2. **목록까지**: [docs/04-backend-api.md](docs/04-backend-api.md)의 REST 규격(`GET /api/tilesets` 등)을 구현하면, 3D 뷰어의 `서버 연결 (선택)` 줄(접혀 있음)에서 서버 주소를 넣고 `서버 목록` → `서버에서 열기`로 열 수 있습니다. 서버의 CORS 허용 목록에 뷰어가 열리는 주소를 넣어야 합니다.

배포된 사이트(https)에서 내 PC의 `http://localhost:…` 서버에 접속하는 것은 브라우저의 예외로 허용되지만, 브라우저가 로컬 네트워크 접근 확인창을 띄울 수 있습니다. 다른 컴퓨터의 서버는 https여야 합니다.

## 폴더 구조

```
gis-viewer-kit/
├─ site/        시작 화면 (정적 HTML 한 장)
├─ viewer/      3D 뷰어: Vite + three.js, 임베드용 번들(build:lib), 사이트용 빌드(build:site)
├─ gis/         GIS 작업실: Vite + Cesium
├─ docs/        설계·API·사용 문서
├─ samples/     샘플 자료를 만드는 방법 (자료는 스크립트로 생성, git 제외)
└─ .github/     GitHub Pages 배포 설정
```

## 라이선스

[MIT](LICENSE). 함께 쓰는 오픈소스(Cesium, three.js, 3d-tiles-renderer, Draco, Basis Universal 등)의 고지는 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)에 있습니다.
