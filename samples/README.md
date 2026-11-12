# samples/

시험용 샘플 자료를 **스크립트로 만들어** 두는 곳입니다. 만들어진 파일은 git에 올라가지 않습니다 (이 안내 파일만 올라갑니다).

| 만들기 | 결과 |
|---|---|
| `node viewer/tools/make-sample-glbs.mjs` | `samples/glb/` 시험용 glb (좌표 없음, Z축이 위, mm 단위, 파일 안 좌표 포함 등) |
| `node gis/tools/make-sample-geojson.mjs` | `samples/geojson/` 복잡한 모양의 GeoJSON과 어울리는 SLD (테두리·점선·글자·축척 범위) |
| `node gis/tools/make-sample-dem.mjs` | `samples/dem/` GeoTIFF 지형 (5186 / 4326, 값 없음 구멍 포함) |
| `node gis/tools/make-sample-terrain-tiles.mjs` | `samples/terrain-tiles/` Cesium 지형 타일 폴더 (quantized-mesh, gzip) |
| `node gis/tools/make-sample-mixed.mjs` | `samples/mixed/` 끌어놓기 시험용 섞인 폴더 (위 자료를 모아 3D Tiles 폴더까지 만듦) |

모두 가상의 도형·지형이며 실제 현장 자료가 아닙니다. (화면의 `예제 열기` 자료는 `node gis/scripts/make-samples.mjs`가 `gis/public/samples/`에 만들며, 그쪽은 git에 올라갑니다.) 사용 방법은 [docs/08-glb-test-guide.md](../docs/08-glb-test-guide.md), [docs/09-gis-page.md](../docs/09-gis-page.md).
