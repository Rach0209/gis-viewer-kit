# 03. 뷰어 공개 API (초안)

> **초안이다.** 구현 전에 이 문서를 먼저 확정하고, 코드는 이 계약에 맞춘다.
> 이름과 옵션은 P1 구현 시 조정될 수 있으며, 변경하면 이 문서를 먼저 고친다.

## 1. 진입점

```js
// <script> 임베드: 전역 TileViewer
// npm/ES 모듈:   import { TileViewer } from 'gis-viewer-kit';

const viewer = TileViewer.create(containerElement, options);
```

## 2. `options`

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `mode` | `'auto'` | `'auto'` \| `'model'` \| `'geo'`. auto는 타일셋 루트 bounding volume으로 판별 |
| `origin` | `'auto'` | `'auto'` 또는 `{ lon, lat, alt }`. geo 모드의 로컬 좌표 기준점 |
| `targetCRS` | `null` | 좌표 표시용 투영 좌표계(예: `'EPSG:5179'`). null이면 lon/lat 표시 |
| `decoderBaseUrl` | 스크립트 위치 기준 | Draco/Basis WASM이 있는 경로 |
| `ui.panels` | `'all'` | `'all'` \| 패널 이름 배열 \| `false` (UI 없이 캔버스만) |
| `persistence` | `'none'` | `'none'` \| `'localStorage'` \| `PersistenceAdapter` (메모 저장소) |
| `syncUrl` | `false` | true면 `?mode=`·공유 링크용 카메라 상태를 `window.location`과 동기화 (임베드 시 기본 꺼짐) |

> 기존 코드와의 차이: 지금은 `window.location`, `import.meta.env`, `localStorage`에 직접 의존한다. 임베드 모듈에서는 **모두 옵션으로 주입**한다.

## 3. 타일셋 로드

```js
const handle = await viewer.loadTileset(source, profile?);
viewer.removeTileset(handle.id);
```

### `source` (TilesetSource)

```ts
type TilesetSource =
  | { kind: 'url';     url: string }                       // 공개 URL 또는 내 서버
  | { kind: 'files';   files: Map<string, File>;           // 모드 A: 사용자 폴더
                       entry?: string }                    //   기본 'tileset.json'
  | { kind: 'backend'; apiUrl: string; id: string };       // 모드 B: Java 서버 (개발용 데모 빌드만. <script> 번들에서는 제외)
```

### 로컬 폴더 헬퍼 (모드 A)

```js
const source = await TileViewer.pickFolder();          // showDirectoryPicker 또는 input 폴백
const source = await TileViewer.fromDropEvent(event);  // 드래그앤드롭
await viewer.loadTileset(source);
```

### `profile` (선택, 타일셋별 튜닝)

| 필드 | 기본값 | 설명 |
|---|---|---|
| `name` | 폴더/URL 이름 | 표시 이름 |
| `mode` | 옵션 `mode` 상속 | 타일셋별 덮어쓰기 |
| `errorTarget` | `16` | 값이 클수록 거친 LOD로 빨리 뜸 (기존 현장 데이터는 `32`) |
| `enableFade` | `true` | 부모/자식이 coplanar이면 z-fighting → `false` |
| `origin` | `'auto'` | |

서버(모드 B)는 이 profile을 타일셋 폴더의 `viewer-profile.json`에서 읽어 목록 API로 내려준다 ([04-backend-api.md](04-backend-api.md)).

## 4. 자동 판별 규칙

`tileset.json` 루트 `boundingVolume`을 본다.

| 조건 | 판별 |
|---|---|
| `region` 사용 | geo |
| `box`/`sphere` 중심 벡터 크기가 약 6.0e6 ~ 6.5e6 m (지구 반경 근처) | geo (ECEF 좌표) |
| 그 외 | model (로컬 좌표) |

geo일 때 `origin: 'auto'`는 루트 중심의 ECEF → 위경도 변환으로 구한다 (기존 `origin.config.js`를 2026-08-05에 수동으로 계산한 방식을 코드화). 틀리게 판별되면 `profile.mode`로 강제할 수 있다.

## 5. 인스턴스 메서드/이벤트

```js
viewer.setMode('model' | 'geo');
viewer.fitToAll();                      // 지금의 "처음 시점으로"
viewer.getCameraState() / viewer.setCameraState(state);
viewer.on(eventName, handler) / viewer.off(eventName, handler);
viewer.dispose();                       // 리스너·GPU 리소스·DOM 완전 정리
```

| 이벤트 | 페이로드 |
|---|---|
| `tileset-ready` | `{ id, name, mode, origin, bounds }` |
| `tileset-error` | `{ id, error }` |
| `progress` | `{ loadingTiles, loadedBytes? }` |
| `camera-change` | 카메라 상태 |
| `annotation-added` / `annotation-removed` | 메모 데이터 |

### 5-1. 지금 구현되어 있는 것 (`viewer/src/kit/TileViewer.js`)

위 초안과 이름이 다른 부분이 있다. 구현된 쪽이 현재 기준이다.

```js
const v = TileViewer.create(el, { mode:'auto', persistence:'localStorage', basemap:'osm' });
v.loadTileset({ kind:'url'|'files'|'backend', ... }, profile?);
v.resetView(); v.focusLocal(point, size);
v.setTool('measure'|'annotate'|'walk'|null);   // 한 번에 하나. walk = 체험(걷기)
// 걷기: 발 높이 바로 위(0.6m)에서 아래로 쏴 처음 만나는 표면을 바닥으로 삼는다 -> 필로티·다층 건물의 아래층을 걸을 수 있고
//       (예전에는 맨 위 표면이라 항상 옥상으로 올라갔다), 허리 높이 앞의 벽은 통과하지 못하고 벽을 따라 미끄러진다.
//       0.6m 이하 단차(계단·연석)는 오르고, 0.5m 넘게 꺼지는 바닥은 중력으로 떨어진다. 점프는 약 1.2m.
//       시작 위치를 클릭한 곳의 높이가 곧 시작 층이다. (코드: interaction/walkPhysics.js)
v.faceNorth();                                  // 나침반 더블클릭과 같음 (geo 타일셋)
v.setLayerVisible('tileset'|'basemap'|'memos', on);
v.setBasemap(null | 'osm' | { provider, apiKey?, height?, maxTiles? });
v.setBasemapHeight(m);
v.getAnnotations(); v.clearAnnotations(); v.clearMeasurements();
v.setMinimapEnabled(on); v.saveScreenshot(); v.getInfo(); v.on/off; v.dispose();
```

**단독 glb 열기 (`loadModel`, 2026-11-05).** 타일셋이 아닌 glb 파일 한 개를 열 수 있다 (툴바 "glb 열기", 화면에 파일 끌어놓기, 또는 `viewer.loadModel(file|url, placement?)`). `.gltf`처럼 외부 파일을 참조하는 형식은 읽지 않는다 (하나로 합친 `.glb`만).
- 파일을 열면 먼저 JSON 부분만 읽어 압축(Draco/KTX2/Meshopt), 삼각형 수, 범위, 위치 정보 후보를 알아낸다. 그다음 **"glb 위치 정하기" 대화상자**가 뜬다.
- 위치를 정하는 방법 (우선순위 순):
  1. **자동 판별**: 파일에 `CESIUM_RTC` 좌표가 있거나 정점이 지구 좌표(ECEF)로 저장돼 있으면 기본 후보로 보여 준다. 최선 노력이라 틀릴 수 있으므로 항상 사용자가 확인한다.
  1-1. **파일 안의 실제 좌표 추천 (2026-11-06)**: GIS/DT용 glb는 건물 모양은 작아도 **실제 투영 좌표(예: EPSG:5186의 동·북 값)가 노드 이동값이나 정점에 들어 있는** 경우가 있다. 모델 중심이 파일 원점에서 5,000 단위 넘게 멀면 위/Z 두 가지 축 읽기 × 좌표계 후보(5186→5187→5185→5179→4326) × 단위 배율(1, mm, cm)로 경위도를 계산해 **한국 주변이고 높이가 -500~9000 m 안인 첫 후보 하나만** 대화상자에 "이 위치로 배치"로 추천한다(`embeddedCoords.js`). 서부·중부·동부원점(5185/5186/5187)은 같은 숫자라도 위치가 달라 값만으로 구분할 수 없으므로 **5186을 기본으로 하되 대화상자의 좌표계 선택칸으로 바꿀 수 있고**(미리보기 경위도와 지도 핀이 따라 움직인다), 한국 안으로 읽히는 후보만 목록에 나온다. 3857·4326(도 단위)·옛 좌표계(5174 등)는 추천하지 않는다. 이 경우 모델의 **바닥 중심**이 그 좌표에 놓이고 편집(이동·회전)도 바닥 중심 기준이다(`pivot`). **대부분의 glb처럼 좌표가 없으면 아무것도 나타나지 않는다.** 먼데 한국 안으로 읽히지 않으면 "지도를 클릭해 배치하면 그만큼 떨어진 곳에 놓여 안 보일 수 있다"는 경고만 낸다. 추천을 쓰지 않으면 기존처럼 지도 클릭/좌표 입력.
  2. **지도에서 클릭 (기본 방법)**: 대화상자 안의 작은 지도(OSM, 또는 고른 배경 지도와 같은 공급자)를 끌어서 이동, 휠/+−/방향키로 확대·축소(커서 기준), **클릭하면 핀이 꽂히고** 아래 좌표칸이 자동으로 채워진다. 지도 시작 위치는 열려 있는 데이터의 위치 → 지난번에 고른 위치(`persistence: 'localStorage'`일 때 기억) → 한국 전체 순서.
  3. **좌표 입력 (보조)**: 좌표계(EPSG:4326, 5179(기본), 5186, 5185, 5187, 3857), X/Y(또는 경도/위도), 높이(타원체고, m). 지도와 서로 맞춰진다: 좌표를 입력하면 지도의 핀이 따라가고(화면 밖이면 지도가 이동), 지도로 고른 뒤 좌표계를 바꾸면 같은 지점이 새 좌표계 값으로 환산된다. 입력한 숫자는 좌표계를 바꾸면 **다시 해석**된다(좌표계를 잘못 골랐다가 고치는 경우). 입력값을 경위도로 바꿔 즉시 보여 주고, 좌표계를 잘못 고른 듯하면(경위도 범위 밖, 한국 주변이 아님) 경고한다.
  4. **좌표 없이 단일 모델로 보기**: 사용자가 이 버튼을 눌렀을 때만(= 동의) 지도·좌표 표시 없이 모델만 탐색한다. 배경 지도는 켜지지 않는다.
- 공통 설정: 위쪽 축(`Y` = glTF 표준 / `Z` = GIS·CAD에서 흔함, X축 -90° 보정), 방향(위에서 볼 때 시계 방향 도), 크기 배율(단위가 mm/cm일 때 0.001 등).
- 프로그램에서 부를 때는 대화상자 없이 `placement`로 정한다: `{type:'single'}`, `{type:'coords', crs, x, y, height, headingDeg, upAxis, scale}`, `{type:'auto'}`. 취소하면 `null`을 돌려주고 `model-cancelled` 이벤트가 나간다.
- **배치한 뒤 고치기 ("모델 편집" 패널, 2026-11-05):** 모델을 열면 툴바에 `모델 편집` 버튼이 생긴다. 바꾸는 즉시 화면에 반영되고, `처음 값으로`로 배치 직후 값으로 돌아간다.
  - **위치**: ▲◀▶▼ 동서남북 이동(단위 0.1/1/10/100 m, 나침반 방향 기준이라 모델 방향과 무관), `지도에서 다시 선택`(작은 지도 대화상자에서 클릭), `모델을 끌어서 이동`(켜면 화면에서 모델을 마우스로 끌어 옮김. 모델 밖을 끌면 지도 이동, 측정·메모·체험을 켜면 자동으로 꺼짐).
  - **높이**(타원체고 m, ± 버튼은 이동 단위만큼), **방향**(시계 방향 도: 슬라이더, 입력, ±1°/±15°), **기울기**(앞뒤: + 이면 북쪽이 올라감, 좌우: + 이면 동쪽이 올라감, 둘 다 모델 방향과 함께 돔), **크기 배율**. 잘못된 값(빈 칸, 0 이하 배율)은 무시하고 칸을 벗어나면 실제 값으로 되돌린다.
  - 좌표 없는 단일 모델은 위치·높이 칸이 숨겨지고 방향·기울기·크기만 고칠 수 있다. 정점이 지구 좌표(ECEF)로 구워진 모델은 위치 편집이 의미가 없어 편집 버튼이 없다.
  - 모델을 옮기는 동안 로컬 좌표의 원점은 처음 배치한 곳에 고정이라 원점에서 수십 km 넘게 옮기면 오차가 커진다. 크게 옮기면(80 m 이상) 배경 지도 범위를 새 위치로 다시 깐다(잠깐 멈춘 뒤).
  - 코드: `viewer.getModelEdit()` 현재 값 / `viewer.setModelEdit({lon, lat, height, headingDeg, pitchDeg, rollDeg, scale})`.
- **배경 지도 기본값:** 좌표로 배치한 glb는 지도 위에 놓은 것이므로 **OSM 배경 지도를 자동으로 깐다**(고른 적이 없을 때). 그렇게 자동으로 켠 지도는 타일셋을 열면 다시 꺼진다. 사용자가 `쓰지 않음`을 직접 고른 적이 있으면 자동으로 켜지 않는다. 좌표 없는 단일 모델에는 지도가 없다.
- **배경 지도가 까맣거나 비어 보일 때 (2026-11-06):** 네트워크에는 PNG가 오는데 화면이 까만 경우의 대표 원인은 **공급자가 키·도메인·지역이 맞지 않을 때 완전히 투명하거나 검은 PNG를 돌려주는 것**이다(투명 픽셀의 색 0,0,0이 그대로 검게 그려진다). 이제 받은 타일을 8x8로 줄여 투명도·밝기를 검사해, 그런 타일은 입히지 않고 **밝은 붉은색**으로 표시하며 레이어 패널에 이유를 쓴다(`빈 이미지 N (완전히 투명한 이미지 — …)`). 받기에 실패한 타일은 한 번 다시 시도하고, 그래도 실패하면 `실패 N`으로 센다. 안내 줄에 마우스를 올리면 첫 문제의 주소(키는 가림)가 보인다. 받는 중/실패 타일 색도 어두운 색에서 밝은 색으로 바꿨다.
- **진단 정보 복사:** 레이어 패널의 `진단 정보 복사` 버튼(코드: `viewer.getDiagnostics()`)이 GPU 이름, 카메라, 레이어 높이·범위, 배경 지도 상태(타일 수, 첫 문제)를 클립보드에 복사한다. 복사가 막힌 브라우저에서는 선택해서 복사할 수 있는 글상자로 보여 준다. API 키는 포함하지 않는다.
- **미니맵 기본값:** 단독 glb는 범위가 좁아 미니맵이 쓸모가 적으므로 **기본으로 꺼 둔다**(타일셋은 기존처럼 옵션 `minimap`, 기본 켜짐). 사용자가 미니맵 버튼으로 직접 켜거나 끈 적이 있으면 그 선택을 모든 데이터에서 유지한다.
- 결과 모델은 3D Tiles와 같이 측정, 메모, 호버 강조, 클릭 정보, 체험(걷기), 미니맵, 배경 지도(좌표로 배치한 경우)가 동작한다. 이전 화면 교체 시 메모 확인 규칙도 같다.
- 한계: 좌표의 높이는 타원체고로 취급한다(한국에서 표고와 수십 m 차이 가능). 옛 좌표계(EPSG:5174 등)는 위치 오차 위험 때문에 목록에 넣지 않았다. 자동 판별은 실제 샘플이 적어 합성 파일로만 확인했다.

**로딩 표시.** 타일셋을 열기 전 준비 단계(폴더 읽기 → 타일셋 확인 → 압축 검사 → 디코더 확인)는 화면에 아직 변화가 없어서 멈춘 것처럼 보이기 쉽다. 이 단계에는 화면 가운데에 스피너와 단계별 문구(예: "폴더를 읽는 중… 파일 1,234개")가 있는 로딩 오버레이를 띄운다. 0.25초 안에 끝나는 로드에서는 깜빡이지 않도록 늦게 보여주고, 성공/실패/취소/확인창 표시 때 사라진다. 이후 타일을 받는 동안은 기존처럼 상태줄("타일 불러오는 중…")이 알린다. 폴더 읽기(`pickFolder`, `fromDropEvent`)는 파일을 동시에 최대 32개씩 읽고, 선택 직후 `onPicked`와 진행 `onProgress(파일 수)` 콜백을 준다.

**배경 지도 (`basemap`)**
- 공급자: `osm`(키 불필요), `vworld-base`, `vworld-satellite`(브이월드 API 키 필요), 또는 `{ urlTemplate, maxZoom, attribution }`. Web Mercator XYZ 타일만 가능 (국토지리정보원 바로e맵은 EPSG:5179 격자라 미지원).
- 위치: 타일 모서리를 위경도로 구해 3D Tiles와 **같은 변환**(WGS84 → 원점 접평면)으로 놓는다. 지구 곡률도 반영된다.
- 범위/줌/높이: 실제로 로드된 메시 범위를 덮고, 타일 수가 `maxTiles`(기본 256, 2026-11-06에 64에서 상향 — 같은 범위가 한 줌 단계 더 선명해진다) 이하인 가장 높은 줌을 고른다. 높이 기본값은 메시 바닥 높이의 하위 10% 지점이며 `setBasemapHeight`나 패널에서 바꾼다.
- 출처 표시(attribution)를 화면 아래에 항상 보여준다 (OSM은 이용 조건).
- `persistence: 'localStorage'`이면 마지막 선택(공급자, API 키)을 이 브라우저에 기억한다.
- geo 타일셋에서만 동작한다 (model 모드는 좌표가 없다).

## 6. `PersistenceAdapter` (메모 저장소)

```ts
interface PersistenceAdapter {
  load(scope: string): Promise<Annotation[]> | Annotation[];
  save(scope: string, items: Annotation[]): Promise<void> | void;
}
```

기본 제공: `'none'`, `'localStorage'`. 이후 REST 구현(`/api/tilesets/{id}/annotations`)을 추가할 수 있다. `scope`에는 타일셋 이름과 모드(`이름|모드`)가 들어간다 (기존에는 `viewMode`만 키로 썼음).

**타일셋을 바꾸면 메모는 초기화된다 (2026-11-05 결정). 지우기 전에 먼저 확인을 받는다.** 이름이 같은 다른 타일셋의 메모가 섞이는 문제를 막기 위해, 메모가 있는 상태에서 **다른** 타일셋(다른 `이름|모드`)을 열려고 하면 화면 안에 확인 대화상자("메모 N개가 모두 삭제됩니다. 계속할까요?")를 띄운다. 계속하면 이전 메모를 화면과 저장소에서 지우고(새 타일셋의 같은 이름 저장분도 비움) 열고, 취소하면 이전 타일셋이 그대로 남는다. 규칙:
- 확인은 새 타일셋이 정상으로 확인된 뒤, 이전 것을 지우기 전에 받는다. 기본 포커스는 "취소"이고 Esc도 취소다.
- 확인창이 떠 있는 동안 다른 타일셋 열기가 시작되면 확인창은 취소로 닫히고 새 요청이 우선한다.
- 메모가 없거나, 같은 타일셋을 다시 여는 경우에는 묻지 않는다 (같은 타일셋이면 메모를 유지/복원).
- 페이지를 새로 열어 처음 여는 타일셋은 저장된 메모를 복원한다.
- 새 타일셋 열기에 실패하면 아무것도 지우지 않는다.
- **성능 모드(저사양 PC):** 툴바의 `성능` 선택(`자동 / 저사양 / 일반`, 코드: `viewer.setPerformance(pref)`, 옵션 `performance`)으로 정한다. `자동`은 코어 수(4개 이하)와 메모리(4GB 이하)로 판단한다. 저사양이면 선 부드럽게(안티앨리어싱)를 끄고, 고해상도 화면 배율을 1배로 하고, 3D 타일 화면 오차 기준을 1.5배(덜 자세히)로 한다. 화면 배율과 타일 기준은 바로 적용되고, 안티앨리어싱은 새로고침 뒤에 적용된다. 선택은 localStorage(`gis-viewer-kit:perf`)에 저장되어 GIS 작업실과 공유한다. `viewer.getPerformance()`로 지금 값을 본다.
- 옵션 `confirmSwitch: false`: 묻지 않고 지운 뒤 경고만 보여준다 (프로그램이 타일셋을 연속으로 여는 경우). 취소되면 `tileset-cancelled` 이벤트가 나가고 `loadTileset`은 `null`을 돌려준다.

## 7. 비목표

- 여러 `TileViewer` 인스턴스를 한 페이지에서 동시에 쓰는 것은 **P1 목표에 포함**하되, 전역 단일 키/리스너 제거가 선행되어야 한다.
- iframe 임베드는 지원하지 않는다.
