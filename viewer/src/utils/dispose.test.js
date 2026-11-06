import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D } from './dispose.js';

describe('disposeObject3D', () => {
  it('disposes geometry, material, and texture maps on a single mesh', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.dispose = vi.fn();

    const texture = new THREE.Texture();
    texture.dispose = vi.fn();

    const material = new THREE.MeshBasicMaterial({ map: texture });
    material.dispose = vi.fn();

    const mesh = new THREE.Mesh(geometry, material);

    disposeObject3D(mesh);

    expect(geometry.dispose).toHaveBeenCalledTimes(1);
    expect(material.dispose).toHaveBeenCalledTimes(1);
    expect(texture.dispose).toHaveBeenCalledTimes(1);
  });

  it('recurses into nested groups and disposes every mesh found', () => {
    const root = new THREE.Group();
    const child = new THREE.Group();
    root.add(child);

    const entries = [1, 2].map(() => {
      const geometry = new THREE.PlaneGeometry();
      geometry.dispose = vi.fn();
      const material = new THREE.MeshBasicMaterial();
      material.dispose = vi.fn();
      child.add(new THREE.Mesh(geometry, material));
      return { geometry, material };
    });

    disposeObject3D(root);

    for (const { geometry, material } of entries) {
      expect(geometry.dispose).toHaveBeenCalledTimes(1);
      expect(material.dispose).toHaveBeenCalledTimes(1);
    }
  });

  it('does nothing (and does not throw) for an object with no geometry/material, e.g. a bare Group', () => {
    const group = new THREE.Group();
    expect(() => disposeObject3D(group)).not.toThrow();
  });
});
