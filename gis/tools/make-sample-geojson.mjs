// 복잡한 모양의 GeoJSON 시험 파일(과 어울리는 SLD)을 만든다. 서울 시청 부근 약 1.5km 범위, 모두 가상의 도형이다.
// 실행: cd gis && node tools/make-sample-geojson.mjs   ->   ../samples/geojson/complex_sample.geojson, complex_sample.sld
//
// 들어 있는 것: 구멍 뚫린 면, 여러 조각(MultiPolygon, 안에 구멍 포함), 오목한 면(U자), 별 모양, 소용돌이 선,
//   여러 선(MultiLineString), 닫힌 고리 선, 점들(Point / MultiPoint), 한글 속성·숫자·불리언·빈 값·중첩 객체
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, '..', '..', 'samples', 'geojson');
fs.mkdirSync(OUT, { recursive: true });

const ORIGIN = { lon: 126.978, lat: 37.5665 };
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
/** 원점에서 동쪽 dx(m), 북쪽 dy(m) 떨어진 점 (경도, 위도) */
const at = (dx, dy) => [+(ORIGIN.lon + dx / M_PER_DEG_LON).toFixed(7), +(ORIGIN.lat + dy / M_PER_DEG_LAT).toFixed(7)];
const close = (ring) => [...ring, ring[0]];
/** 반시계 방향 정다각형/원 (중심 cx, cy, 반지름 r, 꼭짓점 n개) */
const circle = (cx, cy, r, n = 48, rot = 0) => close(Array.from({ length: n }, (_, i) => at(cx + r * Math.cos(rot + (2 * Math.PI * i) / n), cy + r * Math.sin(rot + (2 * Math.PI * i) / n))));
/** 시계 방향(구멍용) */
const hole = (cx, cy, r, n = 32) => circle(cx, cy, r, n).reverse();
/** 별 모양 (꼭짓점 k개, 바깥/안쪽 반지름) */
const star = (cx, cy, rOut, rIn, k = 7) => close(Array.from({ length: k * 2 }, (_, i) => {
  const r = i % 2 === 0 ? rOut : rIn;
  const a = Math.PI / 2 + (Math.PI * i) / k;
  return at(cx + r * Math.cos(a), cy + r * Math.sin(a));
}));

const feature = (properties, geometry) => ({ type: 'Feature', properties, geometry });

const features = [
  // 1) 구멍이 둘 뚫린 큰 면 (바깥 고리 + 구멍 2개)
  feature({ id: 1, 이름: '구멍 뚫린 공원', KIND: '가', 면적_m2: 180000, 공개: true, 비고: null, 상세: { 관리: '시험', 층수: [1, 2] } }, {
    type: 'Polygon',
    coordinates: [circle(-350, 250, 330, 72, 0.2), hole(-480, 300, 90), hole(-250, 160, 60)],
  }),
  // 2) 별 모양 (오목한 꼭짓점이 많은 면)
  feature({ id: 2, 이름: '별 광장', KIND: '나', 면적_m2: 52000, 공개: true, 비고: '', 상세: null }, {
    type: 'Polygon',
    coordinates: [star(250, 300, 260, 110, 7)],
  }),
  // 3) U자 모양 오목한 면
  feature({ id: 3, 이름: 'U자 건물군', KIND: '다', 면적_m2: 24000, 공개: false, 비고: '안뜰 있음', 상세: {} }, {
    type: 'Polygon',
    coordinates: [close([at(-400, -150), at(-400, -420), at(-120, -420), at(-120, -150), at(-190, -150), at(-190, -330), at(-330, -330), at(-330, -150)])],
  }),
  // 4) 조각 여러 개 (육각형 섬 + 삼각형 섬 + 안에 구멍 뚫린 사각 섬)
  feature({ id: 4, 이름: '세 섬', KIND: '가', 면적_m2: 31000, 공개: true, 비고: 'MultiPolygon', 상세: { 조각: 3 } }, {
    type: 'MultiPolygon',
    coordinates: [
      [circle(60, -250, 120, 6, 0)],
      [close([at(260, -160), at(430, -160), at(345, -330)])],
      [close([at(150, -420), at(420, -420), at(420, -520), at(150, -520)]), hole(285, -470, 35, 20)],
    ],
  }),
  // 5) 소용돌이 선
  feature({ id: 5, 이름: '소용돌이 산책로', KIND: '나', 길이_m: 2100 }, {
    type: 'LineString',
    coordinates: Array.from({ length: 160 }, (_, i) => {
      const t = i / 159;
      const a = t * 6 * Math.PI;
      const r = 40 + t * 300;
      return at(-650 + r * Math.cos(a), -80 + r * Math.sin(a));
    }),
  }),
  // 6) 여러 선 (격자 모양 길 + 대각선)
  feature({ id: 6, 이름: '격자 도로', KIND: '다', 길이_m: 3600 }, {
    type: 'MultiLineString',
    coordinates: [
      ...[-3, -2, -1, 0, 1].map((k) => [at(480 + k * 90, 20), at(480 + k * 90, -300)]),
      ...[0, 1, 2, 3].map((k) => [at(120, -20 - k * 90), at(560, -20 - k * 90)]),
      [at(120, 20), at(560, -300)],
    ],
  }),
  // 7) 닫힌 고리 선 (물결 모양)
  feature({ id: 7, 이름: '물결 순환로', KIND: '가', 길이_m: 1500 }, {
    type: 'LineString',
    coordinates: close(Array.from({ length: 120 }, (_, i) => {
      const a = (2 * Math.PI * i) / 120;
      const r = 190 + 45 * Math.sin(7 * a);
      return at(-50 + r * Math.cos(a), 560 + r * Math.sin(a));
    })),
  }),
  // 8) 점들: 원 모양으로 늘어선 점 (개별 Point 12개)
  ...Array.from({ length: 12 }, (_, i) => {
    const a = (2 * Math.PI * i) / 12;
    return feature({ id: 100 + i, 이름: `표지점 ${i + 1}`, KIND: ['가', '나', '다'][i % 3], 순번: i + 1, 높이: +(20 + i * 1.5).toFixed(1) }, { type: 'Point', coordinates: at(560 + 150 * Math.cos(a), 480 + 150 * Math.sin(a)) });
  }),
  // 9) MultiPoint
  feature({ id: 200, 이름: '흩어진 관측점', KIND: '다' }, {
    type: 'MultiPoint',
    coordinates: [at(-700, 480), at(-640, 540), at(-560, 500), at(-720, 380), at(-600, 400)],
  }),
];

const collection = {
  type: 'FeatureCollection',
  name: 'complex_sample',
  features,
};

fs.writeFileSync(path.join(OUT, 'complex_sample.geojson'), JSON.stringify(collection, null, 1));

// 어울리는 SLD: KIND 값(가/나/다)에 따라 색을 칠한다 (면 채우기, 선 색, 점 색)
// 면은 채우기 + 테두리(나 종류는 점선), 선·점도 칠하고, 모든 피처에 "이름" 글자 라벨(굵은 글씨 + 흰 후광).
// 다 종류는 축척 범위(1:3000보다 크게 확대했을 때만)가 있어서, 멀리서는 사라진다.
const rule = (kind, title, color, { dash = '', maxScale = null } = {}) => `        <se:Rule>
          <se:Name>${title}</se:Name>
          <se:Description><se:Title>${title}</se:Title></se:Description>
          <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>KIND</ogc:PropertyName><ogc:Literal>${kind}</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>${maxScale ? `
          <se:MaxScaleDenominator>${maxScale}</se:MaxScaleDenominator>` : ''}
          <se:PolygonSymbolizer>
            <se:Fill><se:SvgParameter name="fill">${color}</se:SvgParameter><se:SvgParameter name="fill-opacity">0.45</se:SvgParameter></se:Fill>
            <se:Stroke><se:SvgParameter name="stroke">#1b1b1b</se:SvgParameter><se:SvgParameter name="stroke-width">2</se:SvgParameter>${dash ? `<se:SvgParameter name="stroke-dasharray">${dash}</se:SvgParameter>` : ''}</se:Stroke>
          </se:PolygonSymbolizer>
          <se:LineSymbolizer><se:Stroke><se:SvgParameter name="stroke">${color}</se:SvgParameter><se:SvgParameter name="stroke-width">4</se:SvgParameter></se:Stroke></se:LineSymbolizer>
          <se:PointSymbolizer><se:Graphic><se:Mark><se:Fill><se:SvgParameter name="fill">${color}</se:SvgParameter></se:Fill></se:Mark><se:Size>10</se:Size></se:Graphic></se:PointSymbolizer>
          <se:TextSymbolizer>
            <se:Label><ogc:PropertyName>이름</ogc:PropertyName></se:Label>
            <se:Font><se:SvgParameter name="font-family">Malgun Gothic</se:SvgParameter><se:SvgParameter name="font-size">14</se:SvgParameter><se:SvgParameter name="font-weight">bold</se:SvgParameter></se:Font>
            <se:Halo><se:Radius>2</se:Radius><se:Fill><se:SvgParameter name="fill">#ffffff</se:SvgParameter></se:Fill></se:Halo>
            <se:Fill><se:SvgParameter name="fill">#222222</se:SvgParameter></se:Fill>
          </se:TextSymbolizer>
        </se:Rule>`;
const sld = `<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc" xmlns:se="http://www.opengis.net/se" version="1.1.0">
  <NamedLayer>
    <se:Name>complex_sample</se:Name>
    <UserStyle>
      <se:Name>complex_sample</se:Name>
      <se:FeatureTypeStyle>
${rule('가', '가 종류 (빨강)', '#e63946')}
${rule('나', '나 종류 (파랑, 점선 테두리)', '#1d7cf2', { dash: '8 4' })}
${rule('다', '다 종류 (초록, 1:3000 보다 확대했을 때만)', '#2a9d4b', { maxScale: 3000 })}
      </se:FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
`;
fs.writeFileSync(path.join(OUT, 'complex_sample.sld'), sld);

const counts = features.reduce((a, f) => ({ ...a, [f.geometry.type]: (a[f.geometry.type] ?? 0) + 1 }), {});
console.log('피처', features.length, JSON.stringify(counts));
console.log('->', OUT);
