/* global Cesium */
/**
 * 거리 재기 / 면적 재기. 지도에서 점을 찍으면 선과 구간 길이가 그려진다.
 *  - 수평 거리: 지구 타원체 표면을 따라 잰 길이 (높이는 무시)
 *  - 직선 거리: 두 점 사이의 3차원 직선 길이 (높이 차이 포함)
 *  - 면적(면적 재기): 점들을 이은 다각형의 타원체 표면 넓이 (높이 무시), 둘레는 수평 거리의 합
 * 점은 3D 타일·모델 위에서는 그 표면의 점(높이 포함), 아니면 지구 표면의 점이다.
 *
 * 화면(DOM)은 모르고, 바뀔 때마다 onChange(요약)을 부른다.
 */
import { formatArea, formatDistance } from './coordFormat.js';
import { polygonAreaM2 } from './areaCalc.js';
import { polygonLabelPoint } from './geomLabel.js';

const CYAN = () => Cesium.Color.fromCssColorString('#00e5ff');

/** 두 점 사이: 수평(타원체 표면) 거리, 3차원 직선 거리, 높이 차이 */
export function segmentInfo(a, b) {
  const ca = Cesium.Cartographic.fromCartesian(a);
  const cb = Cesium.Cartographic.fromCartesian(b);
  const horizontal = new Cesium.EllipsoidGeodesic(new Cesium.Cartographic(ca.longitude, ca.latitude, 0), new Cesium.Cartographic(cb.longitude, cb.latitude, 0)).surfaceDistance;
  return { horizontal, straight: Cesium.Cartesian3.distance(a, b), dHeight: cb.height - ca.height };
}

/**
 * 두 점 사이 지표면을 따라간 곳의 가운데 점 (높이는 두 점의 평균).
 * 먼 두 점의 직선 가운데 점은 땅속에 있어서, 구간 길이 글자를 놓을 때는 이것을 쓴다.
 */
export function surfaceMidpoint(a, b) {
  const ca = Cesium.Cartographic.fromCartesian(a);
  const cb = Cesium.Cartographic.fromCartesian(b);
  const g = new Cesium.EllipsoidGeodesic(new Cesium.Cartographic(ca.longitude, ca.latitude, 0), new Cesium.Cartographic(cb.longitude, cb.latitude, 0));
  const m = g.interpolateUsingFraction(0.5);
  return Cesium.Cartesian3.fromRadians(m.longitude, m.latitude, (ca.height + cb.height) / 2);
}

/** 점들의 구간별 정보와 합계 */
export function summarize(points) {
  const segments = [];
  let horizontal = 0;
  let straight = 0;
  for (let i = 1; i < points.length; i++) {
    const s = segmentInfo(points[i - 1], points[i]);
    segments.push(s);
    horizontal += s.horizontal;
    straight += s.straight;
  }
  return { segments, horizontal, straight };
}

/**
 * @param {Cesium.Viewer} viewer
 * @param {{ onChange: (state:{active:boolean, lines:Array<{points:number, horizontal:number, straight:number, segments:object[], done:boolean}>}) => void }} o
 */
/** 점들을 [경도, 위도] (도) 로 */
const toLonLatDeg = (cartesian) => {
  const c = Cesium.Cartographic.fromCartesian(cartesian);
  return [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)];
};

export function createMeasure(viewer, { onChange }) {
  const ds = new Cesium.CustomDataSource('measure');
  viewer.dataSources.add(ds);
  /** @type {{points:Cesium.Cartesian3[], done:boolean, entities:Cesium.Entity[]}[]} */
  let lines = [];
  let current = null; // 찍는 중인 선
  let hover = null; // 마우스가 있는 곳 (고무줄 선)
  let active = false;
  /** 'distance' | 'area' : 지금 재는 종류 (새로 찍는 선/면이 이 종류가 된다) */
  let mode = 'distance';
  let snapEntity = null; // 맞춤 대상을 알리는 표시 (노란 고리)
  /** 패널에서 고른 구간(seg 번호) 또는 선 전체(seg null) 강조 */
  let selected = null; // { line:number, seg:number|null }
  let selEntities = [];

  const state = () => ({
    active,
    selected,
    mode,
    lines: lines.map((l) => {
      const closed = l.kind === 'area' && l.done; // 끝낸 면은 마지막 점에서 첫 점으로 닫는 구간도 센다
      const sm = summarize(closed ? [...l.points, l.points[0]] : l.points);
      const area = l.kind === 'area' && l.points.length >= 3 ? polygonAreaM2(l.points.map(toLonLatDeg)) : null;
      return { kind: l.kind, points: l.points.length, done: l.done, ...sm, area, perimeter: l.kind === 'area' ? sm.horizontal : null };
    }),
  });
  const notify = () => onChange(state());

  const label = (position, text, big = false) =>
    ds.entities.add({
      position,
      label: {
        text,
        font: big ? '14px sans-serif' : '12px sans-serif',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#14191d').withAlpha(0.85),
        pixelOffset: new Cesium.Cartesian2(0, big ? -22 : -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

  function newLine() {
    const line = { kind: mode, points: [], done: false, entities: [] };
    // 그리는 중에는 마우스 위치까지 잇는 고무줄 선. 면이면 마지막에 첫 점으로 닫는다
    const positions = () => {
      if (line.kind === 'area') {
        if (line.done) return [...line.points, line.points[0]];
        const pts = line === current && hover && line.points.length ? [...line.points, hover] : line.points;
        return pts.length >= 2 ? [...pts, line.points[0]] : pts;
      }
      return line === current && hover && line.points.length ? [...line.points, hover] : line.points;
    };
    line.entities.push(
      ds.entities.add({
        polyline: {
          positions: new Cesium.CallbackProperty(positions, false),
          width: 4,
          // 땅(지형, 올려 둔 DEM 포함)과 3D 타일 표면에 붙여 그린다. 지구 곡률을 따라가고 위에서 봐도 안 사라진다.
          clampToGround: true,
          classificationType: Cesium.ClassificationType.BOTH,
          material: CYAN(),
        },
      }),
    );
    lines.push(line);
    current = line;
    return line;
  }

  const marker = (position) =>
    ds.entities.add({
      position,
      point: { pixelSize: 9, color: CYAN(), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    });

  function dropSelection() {
    for (const e of selEntities) ds.entities.remove(e);
    selEntities = [];
    selected = null;
  }

  /** 지우려는 선이 강조 중이면 강조도 지운다 */
  function dropSelectionOf(line) {
    if (selected && lines[selected.line] === line) dropSelection();
  }

  function finishCurrent() {
    if (!current) return;
    const line = current;
    current = null;
    hover = null;
    const need = line.kind === 'area' ? 3 : 2;
    if (line.points.length < need) {
      // 점이 모자란 선(면은 3개 미만)은 버린다
      dropSelectionOf(line);
      for (const e of line.entities) ds.entities.remove(e);
      lines = lines.filter((l) => l !== line);
    } else if (line.kind === 'area') {
      line.done = true;
      const first = line.points[0];
      const last = line.points[line.points.length - 1];
      const closing = segmentInfo(last, first);
      line.entities.push(label(surfaceMidpoint(last, first), formatDistance(closing.horizontal))); // 닫는 구간 길이
      line.entities.push(
        ds.entities.add({
          polygon: { hierarchy: new Cesium.PolygonHierarchy([...line.points]), material: CYAN().withAlpha(0.22), classificationType: Cesium.ClassificationType.BOTH, zIndex: 1 },
        }),
      );
      const ll = line.points.map(toLonLatDeg);
      const center = polygonLabelPoint(ll);
      const avgH = line.points.reduce((a, p) => a + Cesium.Cartographic.fromCartesian(p).height, 0) / line.points.length;
      line.entities.push(label(Cesium.Cartesian3.fromDegrees(center[0], center[1], avgH), `면적 ${formatArea(polygonAreaM2(ll))}`, true));
    } else {
      line.done = true;
      const s = summarize(line.points);
      line.entities.push(label(line.points[line.points.length - 1], `합계 ${formatDistance(s.horizontal)}`, true));
    }
    notify();
  }

  return {
    get active() {
      return active;
    },
    get mode() {
      return mode;
    },
    /**
     * 재기 시작/끝 (끝낼 때 찍던 선은 마무리하고, 그려 둔 것은 남긴다).
     * 시작할 때 kind('distance'|'area')를 주면 그 종류로 잰다. 재는 중에 다른 종류를 주면 찍던 것을 마무리하고 바꾼다.
     */
    setActive(on, kind) {
      if (on && kind && kind !== mode) {
        finishCurrent();
        mode = kind;
        if (active) notify();
      }
      if (on === active) return;
      if (!on) {
        finishCurrent();
        this.setSnap(null);
      }
      active = on;
      notify();
    },
    /** 점 하나 추가 (지도를 클릭했을 때) */
    addPoint(position) {
      if (!active) return;
      const line = current ?? newLine();
      const prev = line.points[line.points.length - 1];
      if (prev && Cesium.Cartesian3.equalsEpsilon(prev, position, 0, 0.01)) return; // 같은 자리 두 번
      line.points.push(position);
      line.entities.push(marker(position));
      if (prev) {
        const s = segmentInfo(prev, position);
        line.entities.push(label(surfaceMidpoint(prev, position), formatDistance(s.horizontal)));
      }
      notify();
    },
    /** 마우스가 움직일 때 고무줄 선 끝 (없으면 null) */
    setHover(position) {
      hover = position;
    },
    /** 찍던 선 마무리 (오른쪽 클릭, Enter) */
    finish: finishCurrent,
    /** 찍던 선을 취소 (Esc) */
    cancelCurrent() {
      if (!current) return;
      const line = current;
      current = null;
      hover = null;
      dropSelectionOf(line);
      for (const e of line.entities) ds.entities.remove(e);
      lines = lines.filter((l) => l !== line);
      notify();
    },
    /** 그려 둔 것을 모두 지운다 */
    clear() {
      ds.entities.removeAll();
      snapEntity = null;
      selEntities = [];
      selected = null;
      lines = [];
      current = null;
      hover = null;
      notify();
    },
    /** 맞출 수 있는 이미 찍은 점들 (찍는 중인 선의 마지막 점은 빼고: 같은 자리를 또 찍을 일이 없다) */
    snapPoints() {
      const out = [];
      for (const l of lines) {
        const n = l === current ? l.points.length - 1 : l.points.length;
        for (let i = 0; i < n; i++) out.push(l.points[i]);
      }
      return out;
    },
    /** 맞춤 표시를 켠다 (position이 null이면 끈다) */
    setSnap(position, text = '') {
      if (!position) {
        if (snapEntity) snapEntity.show = false;
        return;
      }
      if (!snapEntity || !ds.entities.contains(snapEntity)) {
        snapEntity = ds.entities.add({
          position,
          point: { pixelSize: 18, color: Cesium.Color.TRANSPARENT, outlineColor: Cesium.Color.fromCssColorString('#ffe600'), outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
          label: {
            font: '12px sans-serif',
            fillColor: Cesium.Color.fromCssColorString('#ffe600'),
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('#14191d').withAlpha(0.85),
            pixelOffset: new Cesium.Cartesian2(0, 22),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
      snapEntity.position = position;
      snapEntity.label.text = text;
      snapEntity.show = true;
    },
    /**
     * 구간 하나(seg 번호) 또는 선 전체(seg가 null)를 강조한다. 같은 것을 다시 고르면 강조를 끈다.
     * @returns {{points:Cesium.Cartesian3[]}|null} 강조한 부분의 점들 (카메라 이동용), 끄면 null
     */
    select(lineIndex, seg = null) {
      const line = lines[lineIndex];
      if (!line) return null;
      if (selected && selected.line === lineIndex && selected.seg === seg) {
        dropSelection();
        notify();
        return null;
      }
      // 끝낸 면은 닫는 구간(마지막 점 -> 첫 점)도 하나의 구간이다
      const ring = line.kind === 'area' && line.done ? [...line.points, line.points[0]] : line.points;
      const points = seg == null ? ring : ring.slice(seg, seg + 2);
      if (points.length < 2) return null;
      dropSelection();
      selected = { line: lineIndex, seg };
      const yellow = Cesium.Color.fromCssColorString('#ffe600');
      const add = (width, color, z) =>
        selEntities.push(
          ds.entities.add({
            polyline: { positions: points, width, clampToGround: true, classificationType: Cesium.ClassificationType.BOTH, material: color, zIndex: z },
          }),
        );
      add(11, Cesium.Color.BLACK.withAlpha(0.85), 10); // 검정 바탕 위에 노란 선: 어떤 배경에서도 보이게
      add(6, yellow, 11);
      for (const p of [points[0], points[points.length - 1]]) {
        selEntities.push(ds.entities.add({ position: p, point: { pixelSize: 14, color: yellow, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
      }
      notify();
      return { points };
    },
    clearSelection() {
      if (!selected) return;
      dropSelection();
      notify();
    },
    hasLines: () => lines.length > 0,
    isDrawing: () => !!current,
    state,
  };
}
