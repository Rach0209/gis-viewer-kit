import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LayerBase } from '../layers/LayerBase.js';
import { disposeObject3D } from '../utils/dispose.js';

/**
 * 단독 glb 한 개를 그리는 레이어. 이미 해석한 장면(scene)과 배치 행렬(modelPlacement.js의 결과)을 받는다.
 *
 * 3D Tiles와 달리 LOD가 없어서 한 번에 모든 메시를 올리고, 메시 전부를 PickableRegistry에 등록한다
 * (호버 강조/클릭 정보/측정/걷기 바닥 판정이 3D Tiles와 똑같이 동작한다).
 *
 * 조명: 3D Tiles 현장 스캔은 조명 없는(unlit) 재질이 대부분이라 뷰어에 조명이 없다. 일반 glb는 PBR 재질이라
 * 조명이 없으면 검게 보이므로, 이 레이어가 있는 동안에만 조명과 환경(RoomEnvironment)을 켠다.
 */
export class ModelLayer extends LayerBase {
  /**
   * @param {Object} o
   * @param {string} o.id
   * @param {THREE.Object3D} o.scene 해석된 glTF 장면
   * @param {THREE.Matrix4} o.matrix 모델 -> 레이어 좌표 변환
   * @param {string} [o.name]
   * @param {boolean} [o.lights=true]
   */
  constructor({ id, scene, matrix, name = '', lights = true }) {
    super(id);
    this._name = name;
    this._lights = lights;
    this._viewer = null;
    this._prevEnvironment = null;
    this._env = null;
    this.pivot = new THREE.Group();
    this.pivot.name = `model:${name}`;
    this.pivot.matrixAutoUpdate = false;
    this.pivot.matrix.copy(matrix);
    this.pivot.add(scene);
    this.object3d.add(this.pivot);
    this._stats = { meshes: 0, triangles: 0 };
    scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      this._stats.meshes++;
      const g = o.geometry;
      const count = g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0);
      this._stats.triangles += Math.floor(count / 3);
    });
    this._lightGroup = null;
  }

  /** 변환을 적용한 월드(레이어) 좌표의 범위 */
  getBoundingBox() {
    this.object3d.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.pivot, true);
    return box.isEmpty() ? null : box;
  }

  /** 배치 행렬을 바꾼다 (모델 편집). 지오메트리는 그대로이고 변환만 바뀐다. */
  setMatrix(matrix) {
    this.pivot.matrix.copy(matrix);
    this.pivot.matrixWorldNeedsUpdate = true;
    this.object3d.updateMatrixWorld(true);
  }

  getStats() {
    return { ...this._stats };
  }

  /** 3D 타일 레이어와 같은 "준비됨" 호출 규약: 모델은 이미 메모리에 있으므로 바로 범위를 준다. */
  onReady(callback) {
    const box = this.getBoundingBox();
    if (box) callback(box);
  }

  /** @param {import('../core/Viewer.js').Viewer} viewer */
  onAdd(viewer) {
    this._viewer = viewer;
    this.pivot.traverse((o) => {
      if (o.isMesh) viewer.pickableRegistry?.register(o, { layerId: this.id, model: this._name }, this.id);
    });
    if (this._lights) this._addLights(viewer);
  }

  _addLights(viewer) {
    const box = this.getBoundingBox();
    const size = box ? box.getSize(new THREE.Vector3()).length() || 1 : 1;
    const center = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const group = new THREE.Group();
    group.name = 'model-lights';
    // 환경 반사(RoomEnvironment)가 이미 기본 밝기를 주므로 조명은 약하게: 너무 세면 색이 하얗게 날아간다
    group.add(new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 0.35));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(center.x + size * 0.6, center.y + size * 1.0, center.z + size * 0.4);
    sun.target.position.copy(center);
    group.add(sun, sun.target);
    this.object3d.add(group);
    this._lightGroup = group;

    // 환경 반사: 렌더러가 있을 때만 (시험 환경에는 없다)
    const renderer = viewer?.renderer;
    if (renderer && viewer.scene) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      this._env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      this._prevEnvironment = viewer.scene.environment;
      viewer.scene.environment = this._env;
    }
  }

  /** @param {import('../core/Viewer.js').Viewer} viewer */
  onRemove(viewer) {
    viewer.pickableRegistry?.unregisterByLayer(this.id);
    if (this._env && viewer.scene) {
      if (viewer.scene.environment === this._env) viewer.scene.environment = this._prevEnvironment;
      this._env.dispose();
      this._env = null;
    }
  }

  dispose() {
    disposeObject3D(this.pivot);
  }
}
