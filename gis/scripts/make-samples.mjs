// "예제 열기"에 쓰는 작은 샘플 파일을 만든다: node scripts/make-samples.mjs  ->  public/samples/
// 모두 이 스크립트가 만든 가상 자료다 (실제 현장 자료 아님). 위치는 누구나 아는 공개 지점(서울 도심) 근처로 두었다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'samples');
mkdirSync(out, { recursive: true });
const write = (name, data) => writeFileSync(join(out, name), data);

// ---------------------------------------------------------------- 1) 좌표 CSV (공개 명소, 가상 수치)
const places = [
  ['서울시청', 126.9784, 37.5666, '관공서', 1200],
  ['경복궁', 126.977, 37.5796, '문화재', 5400],
  ['광화문', 126.9769, 37.5759, '문화재', 4100],
  ['남산서울타워', 126.9882, 37.5512, '전망대', 3300],
  ['동대문디자인플라자', 127.0094, 37.5667, '문화시설', 2800],
  ['여의도공원', 126.9246, 37.526, '공원', 2100],
  ['잠실 롯데월드타워', 127.1025, 37.5126, '전망대', 6200],
  ['서울역', 126.9726, 37.5547, '교통', 8800],
];
write('서울-명소.csv', ['이름,경도,위도,분류,방문자수(가상)', ...places.map((p) => p.join(','))].join('\r\n') + '\r\n');

// ---------------------------------------------------------------- 2) KML (구글어스 형식)
write(
  '서울-산책.kml',
  `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>서울 산책 예제</name>
  <Placemark><name>출발: 서울시청</name><description>가상의 산책 경로 시작점</description><Point><coordinates>126.9784,37.5666,0</coordinates></Point></Placemark>
  <Placemark><name>도착: 경복궁</name><Point><coordinates>126.977,37.5796,0</coordinates></Point></Placemark>
  <Placemark><name>산책 경로</name><LineString><tessellate>1</tessellate><coordinates>126.9784,37.5666,0 126.9781,37.5690,0 126.9775,37.5722,0 126.9769,37.5759,0 126.9770,37.5796,0</coordinates></LineString></Placemark>
  <Placemark><name>광화문 광장 일대</name><Polygon><outerBoundaryIs><LinearRing><coordinates>126.9755,37.5730,0 126.9785,37.5730,0 126.9785,37.5775,0 126.9755,37.5775,0 126.9755,37.5730,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>
`,
);

// ---------------------------------------------------------------- 2-2) 높이가 있는 KML (서울 상공 비행 경로: 높이 100~300 m)
// 레이어 줄의 "높이" 켜기/끄기(지면에 붙이기 ↔ 파일의 높이대로)를 시험해 보는 용도다.
const flight = [];
for (let i = 0; i <= 24; i++) {
  const t = i / 24;
  flight.push([126.9246 + t * 0.085, 37.5285 + Math.sin(t * Math.PI * 2) * 0.006 + t * 0.018, 100 + Math.sin(t * Math.PI) * 200]);
}
const fc = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)},${p[2].toFixed(0)}`;
write(
  '서울-비행경로.kml',
  `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>서울 상공 비행 경로 예제</name>
  <Placemark><name>이륙 (높이 ${flight[0][2].toFixed(0)} m)</name><Point><altitudeMode>absolute</altitudeMode><coordinates>${fc(flight[0])}</coordinates></Point></Placemark>
  <Placemark><name>착륙 (높이 ${flight[24][2].toFixed(0)} m)</name><Point><altitudeMode>absolute</altitudeMode><coordinates>${fc(flight[24])}</coordinates></Point></Placemark>
  <Placemark><name>비행 경로 (높이 100~300 m)</name><LineString><altitudeMode>absolute</altitudeMode><coordinates>${flight.map(fc).join(' ')}</coordinates></LineString></Placemark>
  <Placemark><name>상공 120 m의 구역</name><Polygon><altitudeMode>absolute</altitudeMode><outerBoundaryIs><LinearRing><coordinates>126.9700,37.5500,120 126.9900,37.5500,120 126.9900,37.5620,120 126.9700,37.5620,120 126.9700,37.5500,120</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>
`,
);

// ---------------------------------------------------------------- 3) GPX (GPS 트랙: 한강변을 따라 달리는 가상 기록)
const pts = [];
for (let i = 0; i <= 40; i++) {
  const t = i / 40;
  pts.push([126.9246 + t * 0.075, 37.5285 + Math.sin(t * Math.PI * 2) * 0.003 - t * 0.012, 8 + Math.sin(t * 9) * 3]);
}
write(
  '한강-달리기.gpx',
  `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="gis-viewer-kit 예제" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="${pts[0][1].toFixed(6)}" lon="${pts[0][0].toFixed(6)}"><name>출발</name></wpt>
  <wpt lat="${pts[40][1].toFixed(6)}" lon="${pts[40][0].toFixed(6)}"><name>도착</name></wpt>
  <trk><name>한강변 달리기 (가상 기록)</name><trkseg>
${pts.map(([x, y, z]) => `    <trkpt lat="${y.toFixed(6)}" lon="${x.toFixed(6)}"><ele>${z.toFixed(1)}</ele></trkpt>`).join('\n')}
  </trkseg></trk>
</gpx>
`,
);

// ---------------------------------------------------------------- 4) GeoJSON (구역 세 곳, 속성 포함)
const box = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
write(
  '서울-구역.geojson',
  JSON.stringify(
    {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { 이름: '구역 가', 용도: '주거', 면적비율: 0.42 }, geometry: { type: 'Polygon', coordinates: box(126.96, 37.555, 126.985, 37.572) } },
        { type: 'Feature', properties: { 이름: '구역 나', 용도: '상업', 면적비율: 0.31 }, geometry: { type: 'Polygon', coordinates: box(126.985, 37.555, 127.01, 37.572) } },
        { type: 'Feature', properties: { 이름: '구역 다', 용도: '공원', 면적비율: 0.27 }, geometry: { type: 'Polygon', coordinates: box(126.96, 37.572, 127.01, 37.585) } },
      ],
    },
    null,
    2,
  ),
);

// ---------------------------------------------------------------- 5) 항공사진 모양 PNG + 월드파일 + .prj (EPSG:5186, 2 m 화소, 1 km)
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const W = 500;
const H = 500;
const px = new Uint8Array(W * H * 3);
const set = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const p = (y * W + x) * 3;
  px[p] = r;
  px[p + 1] = g;
  px[p + 2] = b;
};
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const n = Math.floor(rnd() * 4) * 5; // 잡음을 몇 단계로 줄여 파일을 작게
  set(x, y, 88 + n, 120 + n, 70 + n); // 풀밭
}
const rect = (x0, y0, x1, y1, f) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, ...f(x, y));
};
// 강: 대각선 띠
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.abs(x - y * 0.8 - 130) < 22) set(x, y, 52 + Math.floor(rnd() * 3) * 4, 98 + Math.floor(rnd() * 3) * 4, 150 + Math.floor(rnd() * 3) * 4);
// 길: 격자
for (const g of [90, 210, 330, 440]) {
  rect(g, 0, g + 7, H, () => [168, 166, 160]);
  rect(0, g, W, g + 7, () => [168, 166, 160]);
}
// 건물: 길 사이에 무작위 사각형
for (let i = 0; i < 90; i++) {
  const x = Math.floor(rnd() * (W - 30));
  const y = Math.floor(rnd() * (H - 30));
  const w = 10 + Math.floor(rnd() * 20);
  const h = 10 + Math.floor(rnd() * 20);
  const c = 150 + Math.floor(rnd() * 70);
  rect(x, y, x + w, y + h, () => [c, c - 20, c - 35]);
}
// 검은 테두리 (사진 둘레): "검은색을 투명으로" 옵션을 보여 준다
rect(0, 0, W, 6, () => [0, 0, 0]);
rect(0, H - 6, W, H, () => [0, 0, 0]);
rect(0, 0, 6, H, () => [0, 0, 0]);
rect(W - 6, 0, W, H, () => [0, 0, 0]);

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0; // 필터 없음
  Buffer.from(px.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // 비트 깊이
ihdr[9] = 2; // 색 유형: RGB
write('서울-항공사진.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
// 월드파일: 화소 2 m, 왼쪽 위 화소 중심 = (좌상단 + 1 m). 좌상단 = 서울시청 근처 5186 좌표 (197600, 552400)
write('서울-항공사진.pgw', '2\n0\n0\n-2\n197601\n552399\n');
write(
  '서울-항공사진.prj',
  'PROJCS["Korea_2000_Korea_Central_Belt_2010",GEOGCS["GCS_Korea_2000",DATUM["D_Korea_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000.0],PARAMETER["False_Northing",600000.0],PARAMETER["Central_Meridian",127.0],PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",38.0],UNIT["Meter",1.0],AUTHORITY["EPSG","5186"]]',
);

// ---------------------------------------------------------------- 6) 지형 DEM (글자 XYZ, EPSG:5186, 30 m 격자 50x50: 가상의 언덕 두 개)
const dem = [];
const x0 = 197200;
const y0 = 553000;
for (let r = 0; r < 50; r++) for (let c = 0; c < 50; c++) {
  const x = x0 + c * 30;
  const y = y0 - r * 30;
  const h1 = 90 * Math.exp(-(((c - 17) ** 2 + (r - 18) ** 2) / 100));
  const h2 = 60 * Math.exp(-(((c - 36) ** 2 + (r - 32) ** 2) / 70));
  dem.push(`${x} ${y} ${(20 + h1 + h2 + Math.sin(c / 4) * 1.5).toFixed(1)}`);
}
write('가상-언덕-DEM.txt', dem.join('\n') + '\n');

console.log('samples ->', out);
