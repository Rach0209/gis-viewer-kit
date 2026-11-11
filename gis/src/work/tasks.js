/**
 * 워커에서 돌릴 수 있는 작업 목록. 워커 진입점(parse.worker.js)과, 워커를 못 쓰는 환경의 대체 실행(client.js)이 같이 쓴다.
 * 이 파일은 화면 쪽 코드가 직접 import 하지 않는다 — client.js 만 쓴다.
 *
 * 작업마다 필요한 모듈을 그때 불러온다. 벡터만 읽는 워커가 GeoTIFF 해독기까지 받지 않도록 하려는 것이다.
 */
import { ownBuffer, transferred } from './pool.js';

export const tasks = {
  /** GeoTIFF 한 개 -> DEM. 높이 배열은 복사 없이 넘긴다 */
  async demTiff({ file, limits }) {
    const { readDemFile } = await import('../demLoad.js');
    const dem = await readDemFile(file, limits);
    return transferred(dem, ownBuffer(dem.data));
  },
  /** 글자 DEM 한 개 -> 격자 한 개 */
  async demTextFile({ file, limits }) {
    const { parseDemTextFile } = await import('../demText.js');
    const r = await parseDemTextFile(file, limits);
    return transferred(r, ownBuffer(r.grid.data));
  },
  /** GeoTIFF 가 색 이미지인지(DEM 이 아닌지) 가볍게 확인 */
  async tiffProbe(args) {
    return (await import('./rasterJobs.js')).probeTiff(args);
  },
  /** 색 이미지(GeoTIFF, PNG/JPG + 월드파일)를 읽어 워커에 둔다 */
  async rasterOpen(args) {
    return (await import('./rasterJobs.js')).openRaster(args);
  },
  /** 좌표계가 정해지면 경위도 격자 RGBA 로 다시 그린다 (결과 배열은 복사 없이 넘긴다) */
  async rasterProject(args) {
    const r = (await import('./rasterJobs.js')).projectRaster(args);
    return transferred(r, ownBuffer(r.rgba));
  },
  async rasterRelease(args) {
    return (await import('./rasterJobs.js')).releaseRaster(args);
  },
  async vectorOpen(args) {
    return (await import('./vectorJobs.js')).openSource(args);
  },
  async vectorBuild(args) {
    return (await import('./vectorJobs.js')).buildItem(args);
  },
  async vectorRelease(args) {
    return (await import('./vectorJobs.js')).releaseItems(args);
  },
};

export async function runTask(name, args) {
  const fn = tasks[name];
  if (!fn) throw new Error(`알 수 없는 작업입니다: ${name}`);
  return fn(args);
}
