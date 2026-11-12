/**
 * "예제 열기" 목록: 자료가 없는 사람도 바로 써 볼 수 있는 작은 샘플 (public/samples/, scripts/make-samples.mjs 가 만든다).
 * 모두 가상 자료이고 위치는 서울 도심(공개 지점) 근처다. DOM·Cesium을 모른다.
 *
 * kind: 어느 열기 흐름으로 보낼지 — 'vector'(SHP/CSV/KML/GPX/GeoJSON/GeoPackage), 'raster'(월드파일 이미지), 'dem'(글자 지형), 'glb'(모델)
 * files: public/samples/ 안의 파일 이름들 (raster 는 [이미지, 월드파일, .prj], 나머지는 모두 한 묶음)
 */
export const SAMPLES = [
  { id: 'csv', kind: 'vector', label: '좌표 CSV — 서울 명소 8곳 (경도·위도 열)', files: ['서울-명소.csv'] },
  { id: 'kml', kind: 'vector', label: 'KML — 구글어스 형식의 산책 경로', files: ['서울-산책.kml'] },
  { id: 'kml-height', kind: 'vector', label: 'KML — 높이가 있는 서울 상공 비행 경로 (레이어 줄 "높이"로 켜고 끄기)', files: ['서울-비행경로.kml'] },
  { id: 'gpx', kind: 'vector', label: 'GPX — GPS 달리기 기록 (한강변)', files: ['한강-달리기.gpx'] },
  { id: 'geojson', kind: 'vector', label: 'GeoJSON — 구역 3곳 (속성 포함)', files: ['서울-구역.geojson'] },
  { id: 'gpkg', kind: 'vector', label: 'GeoPackage — 한 파일에 표 4개 (명소 점·산책로 선·구역 면·높이가 있는 비행 경로, 좌표계가 섞임)', files: ['서울-지도.gpkg'] },
  { id: 'image', kind: 'raster', label: '항공사진 모양 이미지 — PNG + 월드파일 (EPSG:5186)', files: ['서울-항공사진.png', '서울-항공사진.pgw', '서울-항공사진.prj'] },
  { id: 'dem', kind: 'dem', label: '지형(DEM) — 가상의 언덕 (글자 XYZ, EPSG:5186)', files: ['가상-언덕-DEM.txt'] },
  { id: 'glb', kind: 'glb', label: 'glb 모델 — 집 (EPSG:5186 좌표가 들어 있음)', files: ['집-5186.glb'] },
];

/** 샘플 파일의 주소 (base 는 import.meta.env.BASE_URL, 하위 경로에 올려도 맞게) */
export const sampleUrl = (base, name) => `${base}samples/${encodeURIComponent(name)}`;
