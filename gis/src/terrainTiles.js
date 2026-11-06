/* global Cesium */
/**
 * 로컬 폴더의 Cesium 지형 타일(layer.json + {z}/{x}/{y}.terrain)을 연다. 3D Tiles 폴더와 같은 방식으로 폴더를 가짜 주소에
 * 연결해서 Cesium의 CesiumTerrainProvider 가 서버처럼 읽게 한다 (gzip으로 저장된 타일은 virtualFiles.js가 풀어 준다).
 * 옛 Cesium으로 만든 quantized-mesh / heightmap 타일도 같은 형식이라 그대로 읽힌다.
 */
import { readAs } from './virtualFiles.js';
import { dirOfEntry, findLayerJson, summarizeLayerJson } from './terrainTilesCore.js';

/** 음영(법선 조명) 때 쓰는 시각: 한국 한낮(정오 무렵) 태양이 남쪽 높이 뜬 모습 */
const NOON_KST = '2026-06-21T03:00:00Z';

/**
 * @param {Cesium.Viewer} viewer
 * @param {ReturnType<import('./virtualFiles.js').createVirtualFolders>} folders
 * @param {Map<string, File>} files 폴더 안 상대경로 -> File
 */
export async function openTerrainTiles(viewer, folders, files) {
  const entry = findLayerJson(files.keys());
  if (!entry) throw new Error('선택한 폴더에서 layer.json 을 찾지 못했습니다. Cesium 지형 타일 폴더(layer.json과 0/, 1/ … 폴더가 있는 곳)를 고르세요.');
  const reg = folders.register(files);
  try {
    let json;
    try {
      json = await readAs(files.get(entry), 'json');
    } catch (e) {
      throw new Error(`layer.json 을 읽을 수 없습니다 (${e.message})`);
    }
    const summary = summarizeLayerJson(json);
    const dir = dirOfEntry(entry);
    const base = reg.urlFor(dir);
    const url = base.endsWith('/') ? base : `${base}/`; // layer.json 이 든 폴더 주소 (Cesium이 layer.json 을 덧붙여 읽는다)
    const provider = await Cesium.CesiumTerrainProvider.fromUrl(url, { requestVertexNormals: true, requestWaterMask: false });
    const ellipsoid = new Cesium.EllipsoidTerrainProvider();
    const savedTime = viewer.clock.currentTime.clone();
    const canShade = !!provider.hasVertexNormals;
    let shadeOn = false;
    let terrainOn = true;
    const applyShade = () => {
      const on = canShade && shadeOn && terrainOn;
      viewer.scene.globe.enableLighting = on;
      if (on) viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(NOON_KST);
      else viewer.clock.currentTime = savedTime.clone();
    };
    viewer.terrainProvider = provider;

    return {
      provider,
      summary,
      fileCount: files.size,
      hasNormals: canShade,
      hasWaterMask: !!provider.hasWaterMask,
      extent: summary.extent,
      canShade,
      get show() {
        return viewer.terrainProvider === provider;
      },
      set show(v) {
        terrainOn = !!v;
        viewer.terrainProvider = v ? provider : ellipsoid;
        applyShade();
      },
      /** 법선(음영)이 있는 타일이면 태양 조명으로 입체감을 낸다 (3D 타일·모델도 같은 조명을 받는다) */
      get shade() {
        return shadeOn;
      },
      set shade(v) {
        shadeOn = !!v;
        applyShade();
      },
      /** 화면에 불러온 지형 타일에서 읽은 높이. 아직 안 불러왔으면 null */
      heightAt(lonDeg, latDeg) {
        const h = viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(lonDeg, latDeg));
        return h == null ? null : h;
      },
      flyTo(duration = 1.2) {
        if (!summary.extent) return Promise.resolve(false);
        const [w, s, e, n] = summary.extent;
        const pad = Math.max(e - w, n - s) * 0.15; // 가장자리 여유
        return new Promise((resolve) => {
          viewer.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(w - pad, Math.max(-89.9, s - pad), e + pad, Math.min(89.9, n + pad)), duration, complete: () => resolve(true), cancel: () => resolve(false) });
        });
      },
      dispose() {
        if (viewer.terrainProvider === provider) viewer.terrainProvider = ellipsoid;
        viewer.scene.globe.enableLighting = false;
        viewer.clock.currentTime = savedTime.clone();
        folders.release(reg.id);
      },
    };
  } catch (e) {
    folders.release(reg.id);
    throw e;
  }
}
