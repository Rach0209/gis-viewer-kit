import * as THREE from 'three';
import { LayerBase } from '../layers/LayerBase.js';
import { computeTileRange, enumerateTiles, tileXToLon, tileYToLat } from '../layers/tileMath.js';
import { disposeObject3D } from '../utils/dispose.js';
import { createGeodeticToLocal } from './geoMath.js';
import { chooseZoom, tileUrl } from './rasterProviders.js';
import { classifyProbe, probeImage as defaultProbe } from './tileProbe.js';

// 아직 받는 중/실패 색: 어두운 배경에서도 눈에 띄도록 밝게 (예전의 어두운 색은 "까맣게 보인다"는 오해를 낳았다)
const LOADING_COLOR = 0xcfd3d8;
const FAILED_COLOR = 0xd9a3a3;

/**
 * geo 모드 타일셋 아래에 까는 배경 지도(래스터 XYZ 타일).
 *
 * 위치를 정확하게 맞추는 방법: 타일 한 장의 모서리를 위경도로 구해서, 3D Tiles를 로컬로 옮길 때와
 * **같은 변환**(WGS84 타원체 -> 원점의 접평면, geoMath.createGeodeticToLocal)으로 옮긴다.
 * 타일은 장당 grid x grid 칸으로 나눠서 지구 곡률과 Mercator 세로 간격도 반영한다.
 * 기존 RasterTileLayer(proj4 + 투영좌표)와 달리 좌표계를 알 필요가 없어서, 어떤 타일셋에도 쓸 수 있다.
 *
 * 높이: 지도는 기본적으로 타원체고 `height`(m) 위에 평평하게(곡률 포함) 놓인다.
 * 타일셋 바닥 높이는 데이터마다 달라서 {@link setHeight}로 조정할 수 있게 했다.
 *
 * 이 레이어의 메시는 PickableRegistry에 등록하지 않는다 -> 호버 강조/걷기 바닥 판정/클릭 정보가
 * 지도 타일에 반응하지 않고, 3D Tiles 데이터에만 반응한다.
 */
export class BasemapLayer extends LayerBase {
  /**
   * @param {Object} o
   * @param {string} o.id
   * @param {{urlTemplate:string, maxZoom:number, attribution:string}} o.provider resolveProvider()의 결과
   * @param {{west:number,south:number,east:number,north:number}} o.bbox 덮을 영역(위경도)
   * @param {{lon:number,lat:number,alt?:number}} o.origin 로컬 좌표의 기준 원점
   * @param {number} [o.height=0] 타원체고(m)
   * @param {number} [o.maxTiles=256] 한 번에 받을 최대 타일 수 (공개 서버 부담/메모리 제한)
   * @param {number} [o.grid=4] 타일 한 장을 나눌 칸 수
   * @param {{load:Function}} [o.textureLoader] 시험용으로 바꿀 수 있다
   * @param {(image:any)=>({alpha:number,luma:number}|null)} [o.probeImage] 받은 이미지가 투명/검은지 검사 (시험용으로 바꿀 수 있다)
   * @param {number} [o.retries=1] 받기에 실패한 타일을 다시 시도할 횟수
   * @param {number} [o.retryDelayMs=1500]
   */
  constructor({ id, provider, bbox, origin, height = 0, maxTiles = 256, grid = 4, textureLoader, probeImage = defaultProbe, retries = 1, retryDelayMs = 1500 }) {
    super(id);
    this._provider = provider;
    this._bbox = bbox;
    this._origin = origin;
    this._maxTiles = maxTiles;
    this._grid = grid;
    this._loader = textureLoader ?? new THREE.TextureLoader();
    this._disposed = false;
    this._probe = probeImage;
    this._retries = retries;
    this._retryDelayMs = retryDelayMs;
    this._timers = new Set();
    /** blank: 받았지만 완전히 투명하거나 검은 이미지, retried: 재시도한 횟수, firstError: 첫 문제의 주소와 이유 */
    this._stats = { total: 0, loaded: 0, failed: 0, blank: 0, retried: 0, firstError: null };
    this._zoom = null;
    this.object3d.position.y = height;
  }

  get attribution() {
    return this._provider.attribution;
  }

  get zoom() {
    return this._zoom;
  }

  /** @returns {{total:number, loaded:number, failed:number, blank:number, retried:number, firstError:{url:string, reason:string}|null}} */
  getStats() {
    return { ...this._stats };
  }

  /** 타원체고(m) */
  setHeight(height) {
    this.object3d.position.y = height;
  }

  getHeight() {
    return this.object3d.position.y;
  }

  /** @param {import('../core/Viewer.js').Viewer} [viewer] */
  onAdd(viewer) {
    const { zoom } = chooseZoom(this._bbox, { maxTiles: this._maxTiles, maxZoom: this._provider.maxZoom });
    this._zoom = zoom;
    const tiles = enumerateTiles(computeTileRange(this._bbox, zoom));
    this._stats.total = tiles.length;

    const toLocal = createGeodeticToLocal(this._origin);
    const maxAniso = Math.min(viewer?.renderer?.capabilities?.getMaxAnisotropy?.() ?? 1, 8);
    for (const tile of tiles) {
      const mesh = new THREE.Mesh(this._createGeometry(tile, toLocal), this._createMaterial());
      mesh.userData.tile = tile;
      this.object3d.add(mesh);
      this._loadTexture(mesh.material, tile, maxAniso);
    }
  }

  /** 타일 한 장 = (grid+1)^2 개 꼭짓점. 꼭짓점마다 위경도 -> 로컬 변환. */
  _createGeometry(tile, toLocal) {
    const n = this._grid;
    const positions = new Float32Array((n + 1) * (n + 1) * 3);
    const uvs = new Float32Array((n + 1) * (n + 1) * 2);
    let p = 0;
    let t = 0;
    for (let j = 0; j <= n; j++) {
      const lat = tileYToLat(tile.y + j / n, tile.z); // j=0 이 북쪽 가장자리 (Mercator라 y에 선형)
      for (let i = 0; i <= n; i++) {
        const lon = tileXToLon(tile.x + i / n, tile.z);
        const v = toLocal(lon, lat, 0);
        positions[p++] = v.x;
        positions[p++] = v.y;
        positions[p++] = v.z;
        uvs[t++] = i / n;
        uvs[t++] = 1 - j / n; // 이미지 위쪽 = 북쪽
      }
    }
    const indices = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        const b = a + 1;
        const c = a + (n + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeBoundingSphere();
    return g;
  }

  _createMaterial() {
    // 이미지가 오기 전에도 범위를 알아볼 수 있게 회색으로 시작. 양면: 지도 아래에서 봐도 보인다.
    return new THREE.MeshBasicMaterial({ color: LOADING_COLOR, side: THREE.DoubleSide });
  }

  _noteProblem(url, reason) {
    this._stats.firstError ??= { url, reason };
  }

  _loadTexture(material, tile, anisotropy, attempt = 0) {
    const url = tileUrl(this._provider.urlTemplate, tile);
    this._loader.load(
      url,
      (texture) => {
        if (this._disposed) {
          texture.dispose();
          return;
        }
        // 받았지만 완전히 투명하거나 검은 이미지면 그대로 입히지 않는다: 투명 픽셀의 색(0,0,0)이 그대로 까맣게 그려지기 때문.
        // (공급자가 키/도메인/지역이 맞지 않을 때 에러 대신 그런 이미지를 돌려주는 경우가 있다.)
        const bad = classifyProbe(this._probe(texture.image));
        if (bad) {
          texture.dispose();
          material.color.set(FAILED_COLOR);
          material.needsUpdate = true;
          this._stats.blank++;
          this._noteProblem(url, bad);
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = anisotropy;
        material.map = texture;
        material.color.set(0xffffff);
        material.needsUpdate = true;
        this._stats.loaded++;
      },
      undefined,
      () => {
        if (this._disposed) return;
        if (attempt < this._retries) {
          // 일시적인 네트워크 오류일 수 있어 한 번 더 시도한다
          this._stats.retried++;
          const timer = setTimeout(() => {
            this._timers.delete(timer);
            if (!this._disposed) this._loadTexture(material, tile, anisotropy, attempt + 1);
          }, this._retryDelayMs);
          this._timers.add(timer);
          return;
        }
        // 실패한 타일을 눈에 띄게 (키 오류, 줌 범위 밖, 도메인 미등록, CORS 차단 등)
        material.color.set(FAILED_COLOR);
        material.needsUpdate = true;
        this._stats.failed++;
        this._noteProblem(url, '이미지를 받지 못함 (네트워크·CORS·키/도메인 확인)');
      },
    );
  }

  dispose() {
    this._disposed = true;
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
    disposeObject3D(this.object3d);
  }
}
