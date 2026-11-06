# 02. 아키텍처

## 1. 구성요소

```
┌────────────────────────── 브라우저 ──────────────────────────┐
│  호스트 웹페이지 (임의의 사이트)                             │
│   └─ <script src="tile-viewer.js">                           │
│        └─ TileViewer.create(container, options)              │
│             ├─ Viewer / CameraRig         (three.js 렌더 골격)│
│             ├─ Layers (3D Tiles, 래스터, POI, 메모)           │
│             ├─ Interaction (측정, 걷기, 메모 …)               │
│             ├─ UI 패널                                        │
│             └─ Sources  ← 타일을 어디서 가져올지              │
│                  ├─ UrlSource      (http URL)                 │
│                  ├─ LocalFilesSource (사용자 폴더, 백엔드 無) │
│                  └─ BackendSource  (Java REST API)            │
│   Draco / Basis(KTX2) 디코더 (WASM) ← 브라우저에서 해제       │
└───────────────┬──────────────────────────────┬───────────────┘
                │ (모드 A) 로컬 파일 직접 읽기  │ (모드 B) HTTP
        사용자 PC 디스크                        ▼
                                  ┌──── Java 서버 ────┐
                                  │ GET /api/tilesets │
                                  │ GET /tiles/{id}/**│  ← 폴더 서빙
                                  └─────────┬─────────┘
                                            ▼
                                   서버 PC 디스크 (→ 클라우드 스토리지)
```

## 2. 모드 A — 로컬 파일 (백엔드 없음)

1. 사용자가 폴더를 고르거나(드롭) 한다.
2. 뷰어가 폴더 안 파일을 `Map<상대경로, File>`로 보관한다. `File`은 디스크 참조일 뿐이라 **전체를 메모리에 올리지 않는다.**
3. `tileset.json`을 읽어 루트 bounding volume으로 **모드(model/geo)와 원점을 자동 판별**한다.
4. 3d-tiles-renderer가 타일 URL을 요청할 때, 플러그인이 가상 URL을 `File`로 매핑해 응답한다.

**기술적 근거 (확인됨):** `3d-tiles-renderer` 0.5.0은 플러그인에 `preprocessURL(url, tile)`과 `fetchData(url, options)` 훅을 제공하며, 루트 tileset 로드와 각 타일 콘텐츠 로드 둘 다 이 훅을 거친다 (`TilesRendererBase.js`). 따라서 `fetchData`가 `new Response(file)`을 돌려주는 "로컬 파일 플러그인"으로 구현할 수 있다.
**아직 확인 안 된 것:** 실제 데이터(Draco+KTX2 glb 43개)로 끝까지 로드되는지는 P2에서 검증한다.

### 폴더를 받는 방법

| 방법 | 지원 | 비고 |
|---|---|---|
| `showDirectoryPicker()` | Chromium (Chrome/Edge), 보안 컨텍스트(https 또는 localhost) 필요 | 폴더 핸들을 IndexedDB에 저장하면 재방문 시 재선택 최소화 가능 |
| 폴더 드래그앤드롭 (`webkitGetAsEntry`) | 주요 브라우저 대부분 | 재귀 탐색 필요 |
| `<input type="file" webkitdirectory>` | 주요 브라우저 대부분 | 폴백 |

### 한계/주의
- 타일셋은 **폴더 안에서 자기완결적**이어야 한다 (상대 경로 URI). 절대 `http(s)://` URI는 그대로 네트워크로 나간다.
- URI에 `\`, 대소문자 차이, `..` 이 섞인 경우 정규화가 필요하다.
- 새로고침하면 재선택이 필요하다 (Chromium은 핸들 저장으로 완화 가능).
- zip 입력은 1GB급이면 메모리 문제가 있어 초기 범위에서 제외.

## 3. 모드 B — 백엔드 데모

1. 뷰어가 `GET {apiUrl}/api/tilesets`로 목록을 받는다.
2. 사용자가 고른 타일셋의 `entry`(예: `/tiles/site-a/tileset.json`)를 `UrlSource`와 동일하게 로드한다.
3. 서버는 파일을 **그대로** 전달한다 (Range, ETag, CORS). 해제·변환 없음.

REST 계약은 [04-backend-api.md](04-backend-api.md).

## 4. 임베드 방식

```html
<div id="viewer" style="height:600px"></div>
<script src="https://<호스트>/tile-viewer.iife.js"></script>
<script>
  const viewer = TileViewer.create(document.getElementById('viewer'), { mode: 'auto' });
  // 모드 A: 버튼 클릭 시
  //   const src = await TileViewer.pickFolder(); viewer.loadTileset(src);
  // 모드 B:
  //   viewer.loadTileset({ kind: 'backend', apiUrl: 'http://localhost:8080', id: 'site-a' });
</script>
```

- 번들에 three, 3d-tiles-renderer를 포함 → 호스트 페이지와 의존성 충돌 없음. **측정값 (배경 지도·체험 모드·단독 glb 포함, 서버 연결 코드 제외, 2026-11-06): IIFE 1.08MB (gzip 308KB).** proj4는 들어가지 않는다 (새 모듈이 쓰지 않음).
- 디코더(WASM, 약 1.6MB)는 **번들 옆에 같이 배포**하고(`dist/draco/`, `dist/basis/`), 스크립트 자신의 URL을 기준으로 경로를 찾는다. 옵션 `decoderBaseUrl`로 덮어쓸 수 있다. 디코더를 스크립트와 **다른 도메인**(CDN)에 둘 때는 그 서버가 CORS를 허용해야 한다 (디코더 JS/WASM을 fetch로 읽기 때문).
- 빌드/배포 파일 구성은 `npm run build:lib` 결과인 `dist/` 한 폴더 (스크립트 2개, draco/, basis/, 예제 index.html, THIRD-PARTY-NOTICES.txt). 이 폴더를 정적 서버에 올리면 된다.
- **`<script>` 번들은 클라이언트 전용이다.** 빌드가 `__TVK_BACKEND__=false`로 Java 서버 연결 코드(`kind:'backend'`, `listBackendTilesets`)를 제거한다. 개발용 데모(`/kit-demo.html`)는 포함한다. 번들에서 `kind:'backend'`를 쓰면 안내 오류가 난다.
- CSS는 JS에서 주입 (별도 CSS 파일 없음).
- npm 배포는 같은 소스를 ES 모듈로 빌드하고 three를 `peerDependency`로 둔다.

## 5. 뷰어 내부 모듈 경계 (기존 구조 → 변경 방향)

| 영역 | 현재 | 방향 |
|---|---|---|
| `core/Viewer`, `core/geo`, `layers/*` | DOM 의존 적음, 재사용 쉬움 | 거의 유지 |
| `main.js` (555줄) | 앱 전체를 전역으로 조립 | `createViewer(container, options)`로 분리. 가장 큰 작업 |
| `config/appConfig`, `cameraUrlState` | `window.location` 직접 의존 | 옵션으로 주입, 기본은 URL 비연동 |
| (옛 `config/` 하드코딩 URL·원점·EPSG:5179) | 제거됨 (2026-11-06) | 타일셋 프로필 + 자동 원점 계산 |
| `core/annotationStorage` | localStorage 고정, 키 고정 | `PersistenceAdapter` (none / localStorage / REST) |
| `ui/*`, `interaction/*` | `document`/`window` 직접 접근 | 컨테이너 범위로 한정, `dispose()` 보장 |
| (신규) `sources/` | 없음 | UrlSource / LocalFilesSource / BackendSource |

## 6. 클라우드 이관을 위한 원칙 (지금부터 지킬 것)

- 서버 설정은 전부 **환경변수/`application.yml`**. 코드에 경로 하드코딩 금지.
- API 응답에 **서버 로컬 경로를 노출하지 않는다** (id와 URL만).
- 파일 접근은 `TilesetStore` 인터페이스 뒤에 둔다. 지금은 `LocalDiskStore`, 이후 `S3Store` 등으로 교체.
- 서버는 **상태 없음(stateless)**. 메모 같은 상태는 나중에 DB/스토리지로.
- 컨테이너(Docker)로 실행 가능한 형태 유지 (`java -jar` 한 줄).
- 대용량 타일은 서버를 거치지 않고 CDN/서명 URL로 직접 받을 수 있게 `entry` URL을 서버가 자유롭게 지정할 수 있도록 한다.
