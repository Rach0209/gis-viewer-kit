/* global Cesium */
/**
 * 거리 재기 자동 맞춤(스냅). 마우스가 가까이 오면 아래 점들 중 화면에서 가장 가까운 것으로 찍는 점을 맞춘다.
 *   1) 이미 찍은 점 (다른 선의 끝점 포함)
 *   2) 열린 벡터 레이어의 점(POI)
 *   3) 열린 벡터 레이어의 꼭짓점 (면·선)
 * 거리는 **화면 픽셀** 기준(기본 12px)이라, 확대할수록 맞춤이 가리키는 실제 거리가 줄어 세밀하게 찍을 수 있다.
 *
 * 앞부분(순수 함수)은 Cesium을 몰라서 단독으로 시험한다. createSnapper 부터 Cesium을 쓴다.
 */

/**
 * (x,y,z) 3개씩 담긴 배열에서 중심 (cx,cy,cz)로부터 반지름 r 이내인 점의 번호를 모은다.
 * @param {ArrayLike<number>} xyz
 * @returns {number[]} 점 번호 (xyz 배열의 3*번호 위치)
 */
export function withinRadius(xyz, cx, cy, cz, r) {
  const r2 = r * r;
  const out = [];
  for (let i = 0, n = xyz.length / 3; i < n; i++) {
    const dx = xyz[3 * i] - cx;
    if (dx > r || dx < -r) continue; // 빠른 거르기
    const dy = xyz[3 * i + 1] - cy;
    const dz = xyz[3 * i + 2] - cz;
    if (dx * dx + dy * dy + dz * dz <= r2) out.push(i);
  }
  return out;
}

/** 후보 중 화면 거리가 가장 가까운 것 (점(POI)은 `poiBonus` 픽셀만큼 유리하게) */
export function pickBest(cands, poiBonus = 3) {
  let best = null;
  for (const c of cands) {
    const score = c.px - (c.kind === 'poi' ? poiBonus : 0);
    if (!best || score < best.score) best = { ...c, score };
  }
  return best;
}

// ---------------------------------------------------------------- Cesium 연동
const LABELS = { measure: '이전에 찍은 점', poi: '점(POI)', vertex: '꼭짓점' };

/**
 * @param {Cesium.Viewer} viewer
 * @param {{ getSources: () => Cesium.DataSource[], getMeasurePoints: () => Cesium.Cartesian3[], radiusPx?: number }} o
 *   getSources: 지금 보이는 벡터 레이어들의 데이터 소스. 꼭짓점은 **화면에 보이는 엔티티**(entity.show)에서만 가져온다:
 *   범례에서 끈 규칙, SLD에 안 맞아 감춘 피처, 축척 범위 밖인 규칙의 도형은 맞춤 대상이 아니다.
 */
export function createSnapper(viewer, { getSources, getMeasurePoints, radiusPx = 12 }) {
  const cache = new WeakMap(); // 데이터 소스 -> { n: 엔티티 수, entries }

  /** 엔티티마다 꼭짓점 좌표(xyz)와 감싸는 구를 한 번만 만든다. 엔티티 수가 바뀌면(스타일을 입혀 테두리·글자가 생김 등) 다시 만든다. */
  function entriesOf(ds) {
    const all = ds.entities.values;
    const hit = cache.get(ds);
    if (hit && hit.n === all.length) return hit.entries;
    const now = Cesium.JulianDate.now();
    const entries = [];
    const add = (entity, kind, positions) => {
      if (!positions?.length) return;
      const xyz = new Float64Array(positions.length * 3);
      positions.forEach((p, i) => {
        xyz[3 * i] = p.x;
        xyz[3 * i + 1] = p.y;
        xyz[3 * i + 2] = p.z;
      });
      const bs = Cesium.BoundingSphere.fromPoints(positions);
      entries.push({ entity, kind, xyz, center: bs.center, radius: bs.radius });
    };
    for (const e of all) {
      if (e.__companion) continue; // 테두리 선·글자는 원래 피처가 대표한다
      if (e.polygon) {
        const h = e.polygon.hierarchy?.getValue(now);
        if (h) add(e, 'vertex', [...h.positions, ...(h.holes ?? []).flatMap((x) => x.positions)]);
      } else if (e.polyline) add(e, 'vertex', e.polyline.positions?.getValue(now));
      else if (e.position) {
        const p = e.position.getValue(now);
        if (p) add(e, 'poi', [p]);
      }
    }
    cache.set(ds, { n: all.length, entries });
    return entries;
  }

  const toScreen = (cart) => Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, cart);

  /** 벡터의 점은 높이가 0이라, 지형이 있으면 그 지형 높이로 올려서 화면 위치와 찍히는 점이 땅 위에 오게 한다 */
  const toTerrain = (cart) => {
    if (viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider) return cart;
    const c = Cesium.Cartographic.fromCartesian(cart);
    const h = viewer.scene.globe.getHeight(c);
    return h == null ? cart : Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, h);
  };

  return {
    radiusPx,
    /**
     * @param {Cesium.Cartesian2} windowPos 마우스 화면 위치
     * @param {Cesium.Cartesian3|null} world 그 위치가 가리키는 세계 좌표 (없으면 측정 점만 맞춘다)
     * @returns {{cartesian:Cesium.Cartesian3, kind:'measure'|'poi'|'vertex', label:string}|null}
     */
    find(windowPos, world) {
      const cands = [];
      const consider = (cart, kind) => {
        const s = toScreen(cart);
        if (!s) return;
        const px = Math.hypot(s.x - windowPos.x, s.y - windowPos.y);
        if (px <= radiusPx) cands.push({ cartesian: cart, kind, px });
      };
      for (const p of getMeasurePoints()) consider(p, 'measure');

      if (world) {
        // 가리키는 곳의 지표면 점을 기준으로, 화면 반경이 실제로 몇 m인지 환산해서 가까운 후보만 거른다
        const c = Cesium.Cartographic.fromCartesian(world);
        const ground = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 0);
        const canvas = viewer.scene.canvas;
        const mPerPx = viewer.camera.getPixelSize(new Cesium.BoundingSphere(ground, 0), canvas.clientWidth, canvas.clientHeight);
        const r = radiusPx * mPerPx * 1.5;
        if (Number.isFinite(r) && r > 0) {
          for (const ds of getSources()) {
            for (const en of entriesOf(ds)) {
              if (!en.entity.show) continue; // 꺼진 규칙·감춘 피처
              if (Cesium.Cartesian3.distance(en.center, ground) > en.radius + r) continue; // 멀리 있는 엔티티는 건너뜀
              for (const i of withinRadius(en.xyz, ground.x, ground.y, ground.z, r)) consider(toTerrain(new Cesium.Cartesian3(en.xyz[3 * i], en.xyz[3 * i + 1], en.xyz[3 * i + 2])), en.kind);
            }
          }
        }
      }
      const best = pickBest(cands);
      return best ? { cartesian: best.cartesian, kind: best.kind, label: LABELS[best.kind] } : null;
    },
  };
}
