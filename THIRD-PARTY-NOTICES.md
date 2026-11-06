# Third-party notices

이 프로젝트는 아래 오픈소스를 사용하거나 함께 배포합니다. 각 라이선스의 전문은 해당 프로젝트 저장소에 있습니다.
`viewer`의 `<script>` 번들(`npm run build:lib`)은 번들에 실제로 들어간 패키지의 라이선스 전문을 `dist/THIRD-PARTY-NOTICES.txt`로 따로 만들어 함께 둡니다.

## 화면에 함께 배포되는 것

| 이름 | 버전 | 라이선스 | 사용처 |
|---|---|---|---|
| [CesiumJS](https://github.com/CesiumGS/cesium) | 1.147.0 | Apache-2.0 | GIS 작업실 (사이트의 `gis/cesium/`에 그대로 포함) |
| [three.js](https://github.com/mrdoob/three.js) | 0.185.x | MIT | 3D 뷰어 |
| [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS) | 0.5.x | Apache-2.0 | 3D 뷰어 (3D Tiles 읽기) |
| [proj4js](https://github.com/proj4js/proj4js) | 2.x | MIT | 좌표계 변환 |
| [shpjs](https://github.com/calvinmetcalf/shapefile-js) | 6.x | MIT | SHP 읽기 |
| [geotiff.js](https://github.com/geotiffjs/geotiff.js) | 3.x | MIT | GeoTIFF(DEM) 읽기 |
| [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) | 5.x | MIT | SLD 읽기 |
| [but-unzip](https://github.com/samthor/but-unzip) | 0.1.x | Apache-2.0 | ZIP 읽기 |
| [Draco](https://github.com/google/draco) 디코더 (`viewer/public/draco/`) | three.js 배포본 | Apache-2.0 | 압축된 3D 타일·glb 해제 |
| [Basis Universal](https://github.com/BinomialLLC/basis_universal) 트랜스코더 (`viewer/public/basis/`) | three.js 배포본 | Apache-2.0 | KTX2 텍스처 해제 |

## 지도 데이터

- 배경 지도는 [OpenStreetMap](https://www.openstreetmap.org/copyright) 타일입니다(© OpenStreetMap contributors, ODbL). 화면 오른쪽 아래와 스크린샷 아래 줄에 출처를 표시합니다.
- VWorld 배경은 사용자가 직접 발급한 API 키로만 동작하며, 키와 이용 약관은 VWorld(국토교통부)를 따릅니다.
- CesiumJS의 Cesium ion 서비스(유료 지형·지도)는 **사용하지 않습니다**.

## 개발 도구

Vite, Vitest 등은 개발·빌드에만 쓰이며 배포물에 들어가지 않습니다.
