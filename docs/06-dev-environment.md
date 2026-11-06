# 06. 개발 환경과 실행 방법

## 1. 필요한 것

| 항목 | 요구 | 비고 |
|---|---|---|
| Node / npm | Node 20 이상 (22·24에서 시험) | 개발·빌드용. 배포물을 쓰는 쪽은 필요 없다 |
| Git | 아무 버전 | |
| 브라우저 | Chromium 계열 권장 | 폴더 선택창(`showDirectoryPicker`)은 Chromium + https/localhost에서만. 그 외는 `<input webkitdirectory>` 폴백 |

## 2. 실행

```bash
# 3D 뷰어
cd viewer
npm install
npm run dev        # http://localhost:5173/kit-demo.html
npm test           # 단위 테스트

# GIS 작업실
cd ../gis
npm install
npm run dev        # http://localhost:5178
npm test
```

- **서버 없이** 쓰려면 화면의 `폴더 열기`(타일셋 폴더), `glb 열기` 등을 쓰거나 파일을 화면에 끌어다 놓는다. 데이터는 어디로도 업로드되지 않는다.
- GIS 작업실은 `npm run dev`(또는 `npm run assets`)가 Cesium 정적 파일을 `gis/public/cesium`으로 복사한다 (git에는 올리지 않는다).

### 내 타일셋을 개발 서버에 연결 (선택)

큰 타일셋을 복사하지 않고 `viewer/public/tiles-real`에 **링크**로 연결해 `?url=/tiles-real/tileset.json`로 열 수 있다. 이 경로는 git에 올라가지 않는다(`.gitignore`).

```powershell
# Windows PowerShell (관리자 권한 불필요한 디렉터리 정션)
New-Item -ItemType Junction -Path "<저장소>\viewer\public\tiles-real" -Target "<내 타일셋 폴더>"
```
```bash
# macOS / Linux
ln -s "<내 타일셋 폴더>" viewer/public/tiles-real
```
> **주의:** 프로젝트 폴더를 통째로 복사/압축하면 링크를 따라가서 큰 타일이 함께 복사될 수 있다. 링크만 지울 때는 `Remove-Item -Recurse`가 아니라 `rmdir <링크 경로>`를 쓴다 (원본은 지워지지 않는다).

## 3. 배포물 만들기

| 무엇 | 명령 | 결과 |
|---|---|---|
| 임베드용 `<script>` 번들 | `cd viewer && npm run build:lib` | `viewer/dist/` (`tile-viewer.iife.js`, `draco/`, `basis/`, `THIRD-PARTY-NOTICES.txt`). 미리 보기 `npm run preview:lib` |

사이트는 상대 경로(`base: './'`)로 빌드해서 `https://<아이디>.github.io/<저장소>/` 같은 하위 경로에 올려도 동작한다. `main`에 올리면 `.github/workflows/pages.yml`이 테스트와 빌드를 한 뒤 GitHub Pages에 배포한다.

## 4. IntelliJ / VS Code

- 저장소 **루트** 폴더를 연다. `viewer`와 `gis`는 각각 독립된 npm 프로젝트다.
- 인덱싱 속도를 위해 `node_modules`, `dist`, `_site`는 제외(Excluded)해 두면 좋다.

## 5. Git

- 로컬 저장소 (`main`). 원격은 GitHub 공개 단계(P7)에서 연결한다.
- **커밋 작성자(`user.name`/`user.email`)는 공개해도 되는 값으로 설정**한다. 올리기 전에 `git log --format='%an <%ae>' | sort -u`로 확인한다.
- `.gitignore`가 제외하는 것: `node_modules`, `dist/`와 `_site/`, `samples/`의 생성 파일, `viewer/public/tiles-real`, `gis/public/cesium`, 개발 도구 설정(`.claude/`).
- 올리기 전 점검: 내 PC의 절대 경로, 개인/회사 이메일, 실제 현장 이름·좌표가 코드·문서·시험 데이터에 섞이지 않았는지.
