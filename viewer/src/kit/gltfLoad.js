import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * 단독 glb 바이트를 three.js 장면으로 해석한다. Draco/KTX2/Meshopt 디코더를 항상 달아 두면
 * 로더가 파일이 선언한 확장에만 실제로 호출한다 (선언하지 않은 파일에는 비용이 없다).
 * 3D Tiles 레이어(Tiles3DLayer)와 같은 디코더 경로 규칙(`<decoderBaseUrl>draco/`, `basis/`)을 쓴다.
 *
 * @param {ArrayBuffer} buffer glb 전체
 * @param {{decoderBaseUrl?:string, renderer?:import('three').WebGLRenderer}} [opts]
 * @returns {Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTF>}
 */
export async function parseGlb(buffer, { decoderBaseUrl = '/', renderer } = {}) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${decoderBaseUrl}draco/`);
  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath(`${decoderBaseUrl}basis/`);
  if (renderer) ktx2.detectSupport(renderer);
  loader.setDRACOLoader(draco);
  loader.setKTX2Loader(ktx2);
  loader.setMeshoptDecoder(MeshoptDecoder);
  try {
    return await loader.parseAsync(buffer, '');
  } finally {
    // 해석이 끝나면 디코더 작업자(worker)는 필요 없다. 이미 만들어진 텍스처/지오메트리는 그대로 쓸 수 있다.
    draco.dispose();
    ktx2.dispose();
  }
}
