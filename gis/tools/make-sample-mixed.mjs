// 끌어놓기 시험용 "섞인 폴더"를 만든다: 3D Tiles 폴더 + glb 여러 개 + GeoJSON + SLD + 열 수 없는 부속 파일.
// 먼저 samples/glb 와 samples/geojson 이 있어야 한다 (viewer/tools/make-sample-glbs.mjs, gis/tools/make-sample-geojson.mjs).
// 실행: node gis/tools/make-sample-mixed.mjs   ->   samples/mixed/ (git에는 올리지 않는다)
//
// 3D Tiles는 samples의 집 모양 glb 하나를 서울 시청 부근(복잡한 GeoJSON 샘플과 같은 곳)에 놓은 가상의 타일셋이다.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..', '..', 'samples');
const OUT = path.join(ROOT, 'mixed');
const need = (p) => {
  if (!fs.existsSync(p)) throw new Error(`없는 파일: ${p}\n먼저 샘플 glb/GeoJSON 만드는 스크립트를 실행하세요.`);
  return p;
};
const put = (rel, from) => {
  const to = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(need(from), to);
};

// 동북위(ENU) → 지구 중심 좌표(ECEF) 4x4 (열 우선). WGS84, 높이 0
function enuToEcef(lonDeg, latDeg) {
  const a = 6378137;
  const e2 = 0.00669437999014;
  const l = (lonDeg * Math.PI) / 180;
  const p = (latDeg * Math.PI) / 180;
  const n = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  const pos = [n * Math.cos(p) * Math.cos(l), n * Math.cos(p) * Math.sin(l), n * (1 - e2) * Math.sin(p)];
  const east = [-Math.sin(l), Math.cos(l), 0];
  const north = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)];
  const up = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
  return [...east, 0, ...north, 0, ...up, 0, ...pos, 1];
}

fs.rmSync(OUT, { recursive: true, force: true });

// 1) 3D Tiles 폴더
put('건물_타일셋/house.glb', path.join(ROOT, 'glb', '1_house_local.glb'));
fs.writeFileSync(
  path.join(OUT, '건물_타일셋', 'tileset.json'),
  JSON.stringify(
    {
      asset: { version: '1.1' },
      geometricError: 100,
      root: {
        transform: enuToEcef(126.978, 37.5665),
        boundingVolume: { sphere: [0, 0, 15, 40] },
        geometricError: 0,
        refine: 'ADD',
        content: { uri: 'house.glb' },
      },
    },
    null,
    2,
  ),
);

// 2) glb (위치를 직접 정하는 것들)
put('모델/집_Y축.glb', path.join(ROOT, 'glb', '1_house_local.glb'));
put('모델/집_Z축.glb', path.join(ROOT, 'glb', '2_house_zup.glb'));
put('모델/집_mm단위.glb', path.join(ROOT, 'glb', '4_house_mm_units.glb'));

// 3) 벡터 + SLD + 열 수 없는 부속 파일
put('주제도/complex_sample.geojson', path.join(ROOT, 'geojson', 'complex_sample.geojson'));
put('주제도/complex_sample.sld', path.join(ROOT, 'geojson', 'complex_sample.sld'));
fs.writeFileSync(path.join(OUT, '주제도', 'complex_sample.sbn'), 'not a real sbn'); // 건너뛰는지 보기 위한 가짜 파일
fs.writeFileSync(path.join(OUT, '주제도', '설명.txt'), '끌어놓기 시험용 폴더입니다.');

console.log(`만들었습니다: ${OUT}`);
