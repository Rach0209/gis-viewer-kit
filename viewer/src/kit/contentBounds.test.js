import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computeContentBounds } from './contentBounds.js';

function meshAt(x, y, z, size = 2) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial());
  m.position.set(x, y, z);
  return m;
}

describe('computeContentBounds', () => {
  it('메시가 없으면 null', () => {
    expect(computeContentBounds(new THREE.Group())).toBeNull();
  });

  it('로드된 메시 전체의 범위를 월드 좌표로 구한다 (부모 변환 포함)', () => {
    const root = new THREE.Group();
    root.position.set(100, 0, 0);
    root.add(meshAt(0, 0, 0), meshAt(10, 20, -30));
    const { box, count } = computeContentBounds(root);
    expect(count).toBe(2);
    expect(box.min.x).toBeCloseTo(99);
    expect(box.max.x).toBeCloseTo(111);
    expect(box.min.z).toBeCloseTo(-31);
    expect(box.max.y).toBeCloseTo(21);
  });

  it('지면 높이는 가장 낮은 점이 아니라 낮은 백분위수다 (구덩이 하나에 끌려가지 않음)', () => {
    const root = new THREE.Group();
    for (let i = 0; i < 19; i++) root.add(meshAt(i, 50, 0)); // 바닥 49
    root.add(meshAt(0, -5000, 0)); // 이상한 점 하나
    const { box, groundY } = computeContentBounds(root, { groundPercentile: 0.1 });
    expect(box.min.y).toBeLessThan(-4990);
    expect(groundY).toBeCloseTo(49, 3);
  });

  it('메시가 하나여도 동작한다', () => {
    const root = new THREE.Group();
    root.add(meshAt(0, 10, 0));
    expect(computeContentBounds(root).groundY).toBeCloseTo(9);
  });
});
