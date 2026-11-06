# 04. 백엔드(Java) REST 계약

> 참고 구현(Java / Spring Boot, 2026-11-05)은 이 계약대로 동작하며 실데이터로 검증했다. 그 코드는 공개 저장소에서 빼고 별도 저장소로 옮겼다. 이 계약대로 구현하면 어떤 서버든 뷰어(3D 뷰어의 `서버 연결` 줄)에 연결된다.
> 구현하면서 정해진 것: `.json`만 약한 ETag로 보내 gzip되게 함, 오류 본문은 problem+json.

> **이 문서가 뷰어와 서버 사이의 계약이다.** 같은 API만 구현하면 Java가 아닌 백엔드도 같은 뷰어를 쓸 수 있다.
> 모드 A(로컬 파일)에는 서버가 필요 없다. 이 문서는 모드 B(백엔드 데모)용이다.

## 1. 서버의 책임 / 비책임

| 한다 | 하지 않는다 |
|---|---|
| 타일셋 목록 제공 | Draco/KTX2 디코딩, 타일 변환 |
| 타일 파일 그대로 서빙 (Range, ETag, CORS) | 업로드 (현재 범위 밖) |
| 타일셋별 뷰어 프로필 전달 | 사용자 인증 (로컬 데모 단계) |

## 2. 엔드포인트

### `GET /api/health`
```json
{ "status": "ok", "version": "0.1.0" }
```

### `GET /api/config`
뷰어가 서버 기능을 확인한다.
```json
{ "apiVersion": 1, "features": { "annotations": false, "upload": false } }
```

### `GET /api/tilesets`
```json
[
  {
    "id": "site-a",
    "name": "예시 타일셋",
    "description": "",
    "entry": "/tiles/site-a/tileset.json",
    "profile": { "mode": "geo", "errorTarget": 32, "enableFade": false },
    "sizeBytes": 1181116006,
    "updatedAt": "2026-08-10T00:00:00Z"
  }
]
```
- `entry`는 서버 루트 기준 경로이거나 절대 URL이다 (이후 CDN/서명 URL로 바꿀 수 있도록).
- **서버의 로컬 디스크 경로는 절대 노출하지 않는다.**
- `profile`은 비어 있으면 뷰어가 자동 판별한다.

### `GET /api/tilesets/{id}`
위 목록의 항목 하나. 없으면 404.

### `GET /tiles/{id}/**`
타일셋 폴더 안 파일을 그대로 전달.

| 항목 | 요구 |
|---|---|
| Range 요청 | `Accept-Ranges: bytes`, `206 Partial Content` 지원 |
| 캐시 | `ETag`, `Last-Modified`, `Cache-Control: public, max-age=…` (설정 가능) |
| Content-Type | `.json` → `application/json`, `.glb` → `model/gltf-binary`, `.b3dm` `.i3dm` `.pnts` `.cmpt` → `application/octet-stream`, `.ktx2` → `image/ktx2` |
| CORS | 허용 Origin을 설정으로 지정 (`<script>` 임베드 호스트가 서버와 다른 origin일 것이므로 필수) |
| 압축 | glb는 이미 압축됨 → 재압축하지 않음. `.json`만 gzip |

### (이후 단계, 현재 범위 밖)
- `GET|PUT|DELETE /api/tilesets/{id}/annotations` — 메모 저장 (뷰어 `PersistenceAdapter`의 REST 구현)
- `POST /api/tilesets` — 업로드 (클라우드 단계에서 재검토)

## 3. 오류 형식
RFC 7807 `application/problem+json`.
```json
{ "type": "about:blank", "title": "Not Found", "status": 404, "detail": "tileset 'x' not found" }
```

## 4. 타일셋 등록 방식 (둘 다 지원)

**(a) 명시 목록 — 데모 기본.** 보유 중인 폴더를 이동하거나 복사하지 않고 경로만 지정.
```yaml
tileviewer:
  tilesets:
    - id: site-a
      name: 예시 타일셋
      path: C:/path/to/tiles
```

**(b) 루트 스캔.** 폴더 하나를 지정하면 그 아래에서 `tileset.json`이 있는 하위 폴더를 자동 등록.
```yaml
tileviewer:
  tileset-root: ./data
```
```
data/
├─ site-a/
│  ├─ tileset.json
│  └─ viewer-profile.json    ← 선택. { "mode": "geo", "errorTarget": 32, ... }
└─ site-b/tileset.json
```

기타 설정: `tileviewer.cors.allowed-origins`, `tileviewer.cache.max-age`, `server.port`(기본 8080).

## 5. 보안 요구사항 (로컬 데모라도 지킨다)

- `id`는 `[A-Za-z0-9._-]+`만 허용.
- 요청 경로를 정규화한 뒤 **타일셋 폴더 밖으로 나가는 경로(`..`, 절대경로, 심볼릭 링크 탈출)를 거부**한다. (명시 목록(a)은 사용자가 지정한 경로 자체를 신뢰하되, 그 폴더 안에서는 탈출 금지)
- 숨김 파일, `viewer-profile.json` 외 설정 파일은 서빙하지 않는다.
- 읽기 전용. 쓰기/삭제 API 없음.

## 6. 서버 모듈 책임 분담

| 모듈 | 내용 |
|---|---|
| `core` | `TilesetStore`(인터페이스), `LocalDiskStore`, `TilesetRegistry`, `ProfileReader`, 경로 검사. Spring 비의존 |
| `starter` | 자동설정, `@ConfigurationProperties`, 컨트롤러, Range 응답 처리, CORS |
| `app` | `main()` + 기본 `application.yml` + (선택) 뷰어 번들을 정적 리소스로 포함 |
