// 직접 시험해 볼 수 있는 가짜 glb 파일을 만든다 (실제 GIS 데이터가 아님).
// 실행: cd viewer && node tools/make-sample-glbs.mjs   ->   ../samples/glb/*.glb
//
// 모두 "집" 모양(넓은 몸체 + 한쪽 모서리의 높은 탑)이라서, 방향/위쪽 축/배율을 바꿨을 때 달라지는 것이 눈에 보인다.
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, '..', '..', 'samples', 'glb');
fs.mkdirSync(OUT, { recursive: true });

/** 상자 하나의 정점 8개와 삼각형 12개 (바깥쪽이 앞면). Y가 위. */
function box(cx, cy, cz, w, h, d) {
  const x = w / 2, z = d / 2;
  const v = [
    [cx - x, cy, cz - z], [cx + x, cy, cz - z], [cx + x, cy, cz + z], [cx - x, cy, cz + z],
    [cx - x, cy + h, cz - z], [cx + x, cy + h, cz - z], [cx + x, cy + h, cz + z], [cx - x, cy + h, cz + z],
  ];
  const i = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 5, 1, 0, 4, 5, 1, 6, 2, 1, 5, 6, 2, 7, 3, 2, 6, 7, 3, 4, 0, 3, 7, 4];
  return { v, i };
}

/** 여러 상자를 한 메시로 합친다. toZUp이면 (x, y, z) -> (x, -z, y) 로 바꿔 Z가 위인 모델로 만든다 (회전이라 앞면 방향은 유지). */
function build(parts, { toZUp = false } = {}) {
  const positions = [];
  const indices = [];
  for (const p of parts) {
    const base = positions.length;
    for (const [x, y, z] of p.v) positions.push(toZUp ? [x, -z, y] : [x, y, z]);
    for (const k of p.i) indices.push(base + k);
  }
  return { positions, indices };
}

function writeGlb(name, { positions, indices }, { color, extensions, translation, generator = 'gis-viewer-kit sample' }) {
  const pos = new Float32Array(positions.flat());
  const idx = new Uint16Array(indices);
  const min = [0, 1, 2].map((a) => Math.min(...positions.map((p) => p[a])));
  const max = [0, 1, 2].map((a) => Math.max(...positions.map((p) => p[a])));
  const bin = new Uint8Array(pos.byteLength + idx.byteLength);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(idx.buffer), pos.byteLength);
  const json = {
    asset: { version: '2.0', generator },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [translation ? { mesh: 0, translation } : { mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0, roughnessFactor: 0.85 } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength, target: 34963 },
    ],
    buffers: [{ byteLength: bin.byteLength }],
  };
  if (extensions) json.extensions = extensions;
  const jb = new TextEncoder().encode(JSON.stringify(json));
  const jp = new Uint8Array(Math.ceil(jb.length / 4) * 4).fill(0x20);
  jp.set(jb);
  const bp = new Uint8Array(Math.ceil(bin.length / 4) * 4);
  bp.set(bin);
  const total = 12 + 8 + jp.length + 8 + bp.length;
  const buf = Buffer.alloc(total);
  buf.writeUInt32LE(0x46546c67, 0);
  buf.writeUInt32LE(2, 4);
  buf.writeUInt32LE(total, 8);
  buf.writeUInt32LE(jp.length, 12);
  buf.writeUInt32LE(0x4e4f534a, 16);
  Buffer.from(jp).copy(buf, 20);
  const o = 20 + jp.length;
  buf.writeUInt32LE(bp.length, o);
  buf.writeUInt32LE(0x004e4942, o + 4);
  Buffer.from(bp).copy(buf, o + 8);
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(name.padEnd(28), `${(total / 1024).toFixed(1)} KB`, '크기', max.map((v, a) => (v - min[a]).toFixed(1)).join(' x '));
}

// 집: 몸체 30 x 10 x 20 (m) + 한쪽 모서리의 탑 8 x 30 x 8
const house = (scale = 1) => [
  box(0, 0, 0, 30 * scale, 10 * scale, 20 * scale),
  box(-11 * scale, 10 * scale, -6 * scale, 8 * scale, 20 * scale, 8 * scale),
];

// 1) 좌표 없는 일반 모델 (Y가 위, 미터)
writeGlb('1_house_local.glb', build(house()), { color: [0.85, 0.3, 0.25, 1] });

// 2) Z가 위인 모델: "위쪽 축"을 Y로 두면 누워서 보이고, Z로 바꾸면 바로 선다
writeGlb('2_house_zup.glb', build(house(), { toZUp: true }), { color: [0.25, 0.55, 0.85, 1] });

// 3) 파일 안에 위치가 있는 모델 (CESIUM_RTC = 시험 위치의 지구 좌표). 자동 판별 시험용
function geo2ecef(lonD, latD, h) {
  const a = 6378137, e2 = 0.00669437999014, l = (lonD * Math.PI) / 180, p = (latD * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  return [(N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l), (N * (1 - e2) + h) * Math.sin(p)];
}
writeGlb('3_house_with_position.glb', build(house()), {
  color: [0.3, 0.75, 0.4, 1],
  extensions: { CESIUM_RTC: { center: geo2ecef(126.978, 37.5665, 0) } },
});

// 4) 단위가 mm인 모델 (크기가 1000배): 크기 배율을 0.001로 줄여야 실제 크기
writeGlb('4_house_mm_units.glb', build(house(1000)), { color: [0.9, 0.75, 0.25, 1] });

// 5) 파일 안에 실제 투영 좌표(EPSG:5186 동·북)가 노드 이동값으로 들어 있는 모델 (서울 시청 부근).
//    대화상자에 "파일에서 위치 정보를 찾았습니다 → EPSG:5186"과 좌표계 선택칸이 나와야 한다.
writeGlb('5_house_embedded_5186.glb', build(house()), {
  color: [0.7, 0.4, 0.85, 1],
  translation: [198091.7, 50, -551896.1], // 동 198091.7, 높이 50, 북 551896.1 (z = -북)
});
