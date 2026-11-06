import * as THREE from 'three';
import { LayerBase } from './LayerBase.js';
import { disposeObject3D } from '../utils/dispose.js';
import { updateMarkerVisibilityByScreenSize } from './markerScreenSize.js';

const DEFAULT_EMOJI = '📝';
const CONNECTOR_COLOR = 0xffee55;

/**
 * emoji를 캔버스에 그려 스프라이트(항상 카메라를 향하는 2D 아이콘) 텍스처로 만든다.
 * three.js에 텍스트/이모지를 직접 그리는 기본 기능이 없어서, 2D canvas에 그린 뒤
 * 텍스처로 씌우는 표준적인 방법을 쓴다. 스프라이트는 원뿔/구 메시와 달리 항상
 * 카메라 정면을 향해 그려지므로 어느 각도에서 봐도 이모지가 찌그러지지 않는다.
 * @param {string} emoji
 * @param {number} [sizePx]
 */
function createEmojiSprite(emoji, sizePx = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = sizePx;
  canvas.height = sizePx;
  const ctx = canvas.getContext('2d');
  ctx.font = `${Math.floor(sizePx * 0.75)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, sizePx / 2, sizePx / 2 + sizePx * 0.05);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 999;
  return sprite;
}

/**
 * 사용자가 클릭으로 남긴 현장 메모(짧은 텍스트)를 이모지 아이콘으로 표시하는 레이어.
 *
 * POI 마커처럼 표면에 딱 붙이지 않고 약간 띄워서(floatHeight) 보여주고, 실제 클릭
 * 지점(표면)까지 얇은 수직선으로 이어준다 -- 지도 앱의 "핀" 마커 같은 느낌이다.
 *
 * PoiMarkerLayer와 달리 생성 시점에 고정된 목록을 받지 않는다 -- addAnnotation()을
 * AnnotationTool이 클릭할 때마다 호출해 그때그때 늘어난다. 클릭/호버는 별도 코드가
 * 필요 없다: 아이콘 스프라이트를 만들 때 PickableRegistry에 메모 텍스트를 metadata로
 * 등록해두면 기존 ClickPopup/HoverHighlight가 다른 레이어와 똑같은 방식으로 보여준다
 * (연결선은 장식용이라 등록하지 않는다 -- 클릭 대상은 아이콘이면 충분하다).
 */
export class AnnotationLayer extends LayerBase {
  /**
   * @param {Object} options
   * @param {string} options.id
   * @param {string} [options.emoji] - 마커로 쓸 이모지. 기본 '📝'.
   * @param {number} [options.iconSize] - 아이콘 스프라이트의 월드 크기(한 변), 로컬 좌표 단위. 기본 20.
   * @param {number} [options.floatHeight] - 실제 클릭 지점 위로 아이콘을 띄우는 높이. 기본 25.
   */
  constructor({ id, emoji = DEFAULT_EMOJI, iconSize = 20, floatHeight = 25 }) {
    super(id);
    this._emoji = emoji;
    this._iconSize = iconSize;
    this._floatHeight = floatHeight;
    this._viewer = null;
    this._nextIndex = 0;
    // getAll()로 그대로 내보내 localStorage에 저장할 수 있게, three.js 객체와 별개로
    // {position, text} 형태의 직렬화 가능한 목록도 함께 들고 있는다.
    this._annotations = [];
    // 아이콘이 화면에서 너무 작아져 숨겨질 때 연결선도 같이 숨기기 위해 짝을 기억해둔다.
    this._markerPairs = [];
  }

  /** @param {import('../core/Viewer.js').Viewer} viewer */
  onAdd(viewer) {
    this._viewer = viewer;
  }

  /**
   * PoiMarkerLayer와 같은 이유로, 카메라가 멀어져 아이콘이 화면에서 몇 픽셀 이하로
   * 작아지면 숨긴다(렌더링과 클릭/호버 모두 함께 꺼짐, markerScreenSize.js 참고).
   * 연결선은 그 자체로는 숨김 판정을 하지 않고, 짝지어진 아이콘의 상태를 그대로 따라간다.
   * @param {import('three').Camera} camera
   */
  update(camera) {
    if (!this._viewer) return;
    const viewportHeightPx = this._viewer.renderer.domElement.clientHeight;
    const sprites = this._markerPairs.map((pair) => pair.sprite);
    updateMarkerVisibilityByScreenSize(sprites, this._iconSize / 2, camera, viewportHeightPx);
    for (const { sprite, connector } of this._markerPairs) {
      connector.visible = sprite.visible;
    }
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
    const sprite = createEmojiSprite(this._emoji);
    sprite.scale.set(this._iconSize, this._iconSize, 1);
    sprite.position.set(position.x, position.y + this._floatHeight, position.z);
    this.object3d.add(sprite);

    const connectorGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(position.x, position.y, position.z),
      new THREE.Vector3(position.x, position.y + this._floatHeight, position.z),
    ]);
    const connectorMaterial = new THREE.LineBasicMaterial({ color: CONNECTOR_COLOR, depthTest: false });
    const connector = new THREE.Line(connectorGeometry, connectorMaterial);
    connector.renderOrder = 998;
    this.object3d.add(connector);

    this._markerPairs.push({ sprite, connector });

    const id = `annotation-${this._nextIndex++}`;
    this._viewer.pickableRegistry?.register(sprite, { layerId: this.id, id, note: text }, this.id);
    this._annotations.push({ position: { x: position.x, y: position.y, z: position.z }, text });

    return sprite;
  }

  /** @returns {Array<{position:{x:number,y:number,z:number}, text:string}>} 저장/내보내기용 */
  getAll() {
    return this._annotations;
  }

  /** 지금까지 남긴 메모를 전부 지운다 (마커, 연결선, 클릭/호버 등록 포함). */
  clear() {
    for (const child of [...this.object3d.children]) {
      disposeObject3D(child);
      this.object3d.remove(child);
    }
    this._viewer?.pickableRegistry?.unregisterByLayer(this.id);
    this._annotations = [];
    this._markerPairs = [];
  }

  dispose() {
    // SpriteMaterial.map(캔버스 텍스처)도 disposeObject3D가 material 속성을 훑어
    // isTexture인 값을 찾아 같이 해제해준다(utils/dispose.js 참고) -- 따로 손댈 필요 없다.
    disposeObject3D(this.object3d);
  }
}
