/* global Cesium */
/**
 * 읽은 DEM(demLoad.js)을 Cesium 지형(terrain)으로 만든다. ion·타일 서버 없이, 격자를 브라우저가 직접 샘플링해서
 * Cesium의 CustomHeightmapTerrainProvider 에 타일마다 높이 배열을 준다. 그래서 땅에 붙인 선·면, 클릭 높이, 카메라 충돌이
 * 모두 Cesium의 지형 기능 그대로 이 DEM을 따른다.
 *
 * 격자 범위 밖은 높이 0(타원체)이다 (범위 가장자리에서 높이가 갑자기 바뀔 수 있다).
 */
import { createMosaicSampler, createSampler, lonLatExtent, projectorFor, tileHeights } from './demCore.js';
import { formatDistance } from './coordFormat.js';
import { createHillshadeProvider } from './hillshade.js';

const SIZE = 65; // 타일 한 변 샘플 수 (Cesium 기본)

/**
 * @param {Cesium.Viewer} viewer
 * @param {Awaited<ReturnType<import('./demLoad.js').readDemFile>>} dem
 * @param {{crs:string, offset?:number}} o crs: 격자 좌표계, offset: 높이 보정(m, 표고 -> 타원체고 등)
 */
export function createDemTerrain(viewer, dem, { crs, offset = 0 }) {
  const toXY = projectorFor(crs);
  const sampler = dem.tiles ? createMosaicSampler(dem.tiles, toXY) : createSampler(dem, toXY); // 도엽이 여러 장이면 각자의 격자로 겹쳐 읽는다
  const extent = lonLatExtent(dem.bbox, crs); // [west, south, east, north] 도
  const D2R = Math.PI / 180;
  const margin = 1e-4; // 도. 경계 샘플이 빠지지 않게
  const ext = { west: (extent[0] - margin) * D2R, south: (extent[1] - margin) * D2R, east: (extent[2] + margin) * D2R, north: (extent[3] + margin) * D2R };
  const scheme = new Cesium.GeographicTilingScheme();
  const flat = () => new Float32Array(SIZE * SIZE);
  let shadeOn = true;

  const provider = new Cesium.CustomHeightmapTerrainProvider({
    width: SIZE,
    height: SIZE,
    tilingScheme: scheme,
    callback(x, y, level) {
      const r = scheme.tileXYToRectangle(x, y, level);
      // 격자와 겹치지 않는 타일은 계산하지 않고 평평하게 (대부분의 낮은 레벨 타일)
      if (r.east < ext.west || r.west > ext.east || r.north < ext.south || r.south > ext.north) return flat();
      return tileHeights(r, SIZE, (lon, lat) => sampler.sampleLonLat(lon, lat), { offset, outside: 0 });
    },
    credit: new Cesium.Credit(`지형: ${dem.name} (로컬 파일)`, false),
  });

  // 음영: 배경 지도는 평평해서 위에서 보면 기복이 안 보이므로, DEM에서 계산한 그림자를 반투명하게 겹친다
  const resDeg = /^EPSG:(4326|4737|4619|4258|4269|4612)$/.test(crs) ? dem.resolution[0] : dem.resolution[0] / 111320;
  const shadeLayer = new Cesium.ImageryLayer(
    createHillshadeProvider(Cesium, (lon, lat) => {
      const h = sampler.sampleLonLat(lon, lat);
      return h == null ? null : h + offset;
    }, extent, { maximumLevel: Math.min(22, Math.max(8, Math.ceil(Math.log2(180 / (128 * resDeg))))) }),
  );
  viewer.imageryLayers.add(shadeLayer); // (ImageryLayerCollection.add 는 아무것도 돌려주지 않는다)
  let terrainOn = true;
  const ellipsoid = new Cesium.EllipsoidTerrainProvider();
  const rectangle = Cesium.Rectangle.fromDegrees(extent[0], extent[1], extent[2], extent[3]);
  viewer.terrainProvider = provider;

  return {
    provider,
    rectangle,
    extent,
    crs,
    offset,
    /** 켜면 이 지형, 끄면 평평한 지구 (레이어 켜기/끄기) */
    get show() {
      return viewer.terrainProvider === provider;
    },
    set show(v) {
      terrainOn = !!v;
      viewer.terrainProvider = v ? provider : ellipsoid;
      shadeLayer.show = terrainOn && shadeOn;
    },
    /** 음영 켜기/끄기 */
    get shade() {
      return shadeOn;
    },
    set shade(v) {
      shadeOn = !!v;
      shadeLayer.show = terrainOn && shadeOn;
    },
    /** DEM에서 직접 읽은 높이(+보정). 범위 밖이면 null. 화면에 지형 타일이 불러와지지 않았어도 쓸 수 있다. */
    heightAt(lonDeg, latDeg) {
      const h = sampler.sampleLonLat(lonDeg, latDeg);
      return h == null ? null : h + offset;
    },
    flyTo(duration = 1.2) {
      return new Promise((resolve) => {
        viewer.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(extent[0] - 0.01, extent[1] - 0.01, extent[2] + 0.01, extent[3] + 0.01), duration, complete: () => resolve(true), cancel: () => resolve(false) });
      });
    },
    dispose() {
      if (viewer.terrainProvider === provider) viewer.terrainProvider = ellipsoid;
      viewer.imageryLayers.remove(shadeLayer, true);
    },
  };
}

/** 지형 레이어 정보 [이름, 값] */
export function demInfoRows(dem, { crs, offset = 0, extent }) {
  const [rx, ry] = dem.resolution;
  const geographic = /^EPSG:(4326|4737|4619|4258|4269|4612)$/.test(crs);
  const res = geographic ? `${rx} ° (약 ${formatDistance(rx * 111320 * Math.cos((((extent[1] + extent[3]) / 2) * Math.PI) / 180))})` : `${rx} m`;
  const st = dem.stats;
  const rows = [
    ['파일', dem.name],
    ['격자', dem.tiles ? `도엽 ${dem.tiles.length}장 · 화소 ${dem.stats.valid.toLocaleString('ko-KR')}개 · 해상도 ${ry === rx ? res : `${rx} × ${ry}`}` : `${dem.width.toLocaleString('ko-KR')} × ${dem.height.toLocaleString('ko-KR')} 화소 · 해상도 ${ry === rx ? res : `${rx} × ${ry}`}`],
    ['좌표계', crs],
    ['범위', `경도 ${extent[0].toFixed(5)} ~ ${extent[2].toFixed(5)}, 위도 ${extent[1].toFixed(5)} ~ ${extent[3].toFixed(5)}`],
  ];
  if (st.min != null) rows.push(['높이(파일 값)', `최소 ${st.min.toFixed(1)} m · 최대 ${st.max.toFixed(1)} m · 평균 ${st.mean.toFixed(1)} m`]);
  if (st.invalid) rows.push(['값 없음', `${st.invalid.toLocaleString('ko-KR')}개 화소 (그 곳은 높이 0으로 둠)`]);
  rows.push(['높이 보정', `${offset >= 0 ? '+' : ''}${offset} m`]);
  return rows;
}
