import * as THREE from 'three';
import { LayerBase } from './LayerBase.js';
import { disposeObject3D } from '../utils/dispose.js';
import { worldSizeForScreenPx } from './markerScreenSize.js';

const PIN_FILL = '#ffd24a';
const PIN_STROKE = '#1b2027';
const SELECTED_SCALE = 1.35;

/**
 * 번호가 적힌 핀 그림을 캔버스에 그려 스프라이트(항상 카메라를 향하는 2D 아이콘)로 만든다.
 * 핀의 뾰족한 끝이 그림 맨 아래 가운데라서, 스프라이트의 `center`를 (0.5, 0)으로 두면
 * 끝이 정확히 클릭한 지점에 놓인다. 번호는 화면 왼쪽의 메모 목록 번호와 같다.
 * @param {number} number
 */
function createPinSprite(number) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = 50;
  const r = 40;

  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.8, Math.PI * 0.2, false); // 위쪽 큰 원호
  ctx.lineTo(cx, size - 4); // 뾰족한 끝
  ctx.closePath();
  ctx.fillStyle = PIN_FILL;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = PIN_STROKE;
  ctx.stroke();

  const label = String(number);
  ctx.fillStyle = PIN_STROKE;
  ctx.font = `700 ${label.length >= 3 ? 34 : label.length === 2 ? 42 : 52}px system-ui, "Malgun Gothic", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // depthTest를 끄면 건물 뒤에 있어도 항상 보인다 (메모는 가려지면 안 된다).
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 999;
  return sprite;
}

/**
 * 사용자가 클릭으로 남긴 현장 메모(짧은 텍스트)를 번호 핀으로 표시하는 레이어.
 *
 * 핀은 카메라에서 멀어져도 화면에서 항상 같은 크기(기본 40px)로 보인다. 월드 크기를 고정하면 멀어질수록
 * 작아져 사라지므로, 크기는 매 프레임 update()에서 거리에 맞춰 다시 정한다.
 * 클릭/호버는 별도 코드가 필요 없다: 스프라이트를 만들 때 PickableRegistry에 메모 텍스트를
 * metadata로 등록해두면 기존 ClickPopup/HoverHighlight가 다른 레이어와 똑같이 보여준다.
 */
export class AnnotationLayer extends LayerBase {
  /**
   * @param {Object} options
   * @param {string} options.id
   * @param {number} [options.pinPx] - 핀의 화면 높이(px). 기본 40.
   */
  constructor({ id, pinPx = 40 }) {
    super(id);
    this._pinPx = pinPx;
    this._viewer = null;
    this._nextIndex = 0;
    // getAll()로 그대로 내보내 localStorage에 저장할 수 있게, three.js 객체와 별개로
    // {position, text} 형태의 직렬화 가능한 목록도 함께 들고 있는다.
    this._annotations = [];
    /** annotations와 같은 순서의 스프라이트 */
    this._sprites = [];
    this._selected = -1;
  }

  /** @param {import('../core/Viewer.js').Viewer} viewer */
  onAdd(viewer) {
    this._viewer = viewer;
  }

  /**
   * 매 프레임: 핀이 카메라 거리와 상관없이 화면에서 같은 크기로 보이게 크기를 다시 정한다.
   * @param {import('three').Camera} camera
   */
  update(camera) {
    if (!this._viewer || !camera.isPerspectiveCamera) return;
    const viewportHeightPx = this._viewer.renderer.domElement.clientHeight;
    this._sprites.forEach((sprite, i) => {
      const distance = camera.position.distanceTo(sprite.position);
      const world = worldSizeForScreenPx({
        pixelSize: this._pinPx,
        distance,
        cameraFovDeg: camera.fov,
        viewportHeightPx,
      });
      const k = world * (i === this._selected ? SELECTED_SCALE : 1);
      sprite.scale.set(k, k, 1);
    });
  }

  /** @param {import('../core/Viewer.js').Viewer} viewer */
  onRemove(viewer) {
    viewer.pickableRegistry?.unregisterByLayer(this.id);
  }

  /**
   * @param {{x:number, y:number, z:number}} position - 실제 클릭 지점(표면) 로컬 좌표
   * @param {string} text
   * @returns {import('three').Sprite}
   */
  addAnnotation(position, text) {
    const sprite = createPinSprite(this._annotations.length + 1);
    // 처음 프레임이 그려지기 전에도 보이도록 대충의 크기를 둔다 (update가 곧바로 맞춘다)
    sprite.scale.set(1, 1, 1);
    sprite.position.set(position.x, position.y, position.z);
    this.object3d.add(sprite);

    const id = `annotation-${this._nextIndex++}`;
    this._viewer?.pickableRegistry?.register(sprite, { layerId: this.id, id, note: text }, this.id);
    this._annotations.push({ position: { x: position.x, y: position.y, z: position.z }, text });
    this._sprites.push(sprite);

    return sprite;
  }

  /** @returns {Array<{position:{x:number,y:number,z:number}, text:string}>} 저장/내보내기용 */
  getAll() {
    return this._annotations;
  }

  /** 목록에서 고른 메모의 핀을 크게 보여 준다. 범위 밖이면 선택 해제. */
  select(index) {
    this._selected = Number.isInteger(index) && index >= 0 && index < this._annotations.length ? index : -1;
  }

  /** 메모 하나를 지운다. 뒤의 메모 번호가 한 칸씩 당겨지도록 핀을 다시 만든다. */
  removeAt(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this._annotations.length) return false;
    const rest = this._annotations.filter((_, i) => i !== index);
    this.clear();
    for (const a of rest) this.addAnnotation(a.position, a.text);
    return true;
  }

  /** 지금까지 남긴 메모를 전부 지운다 (핀, 클릭/호버 등록 포함). */
  clear() {
    for (const child of [...this.object3d.children]) {
      disposeObject3D(child);
      this.object3d.remove(child);
    }
    this._viewer?.pickableRegistry?.unregisterByLayer(this.id);
    this._annotations = [];
    this._sprites = [];
    this._selected = -1;
    this._nextIndex = 0;
  }

  dispose() {
    // SpriteMaterial.map(캔버스 텍스처)도 disposeObject3D가 material 속성을 훑어
    // isTexture인 값을 찾아 같이 해제해준다(utils/dispose.js 참고) -- 따로 손댈 필요 없다.
    disposeObject3D(this.object3d);
  }
}
