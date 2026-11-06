import { describe, expect, it } from 'vitest';
import { classifyDrop, itemCount, kindCount } from './dropClassify.js';

describe('classifyDrop', () => {
  it('폴더 하나가 3D Tiles면 안의 glb·json은 타일 내용이라 따로 세지 않는다', () => {
    const r = classifyDrop(['tileset.json', 'tiles/0.glb', 'tiles/1.glb', 'sub/tileset.json', 'meta.json']);
    expect(r.tilesets).toEqual([{ root: '', name: '', count: 5 }]);
    expect(r.models).toEqual([]);
    expect(r.vectors).toEqual([]);
    expect(itemCount(r)).toBe(1);
  });

  it('여러 종류가 섞인 폴더: 3D Tiles 하위 폴더 + glb + SHP + GeoJSON + SLD', () => {
    const r = classifyDrop([
      '건물/tileset.json', '건물/0.b3dm', '건물/a/1.glb',
      '모델/정자.glb', '모델/소공원.GLB',
      '주제도/용도지역.shp', '주제도/용도지역.dbf', '주제도/용도지역.prj', '주제도/용도지역.cpg', '주제도/용도지역.shx', '주제도/용도지역.sbn', '주제도/용도지역.sld',
      '경계.geojson',
    ]);
    expect(r.tilesets).toEqual([{ root: '건물/', name: '건물', count: 3 }]);
    expect(r.models.map((m) => m.label)).toEqual(['정자.glb', '소공원.GLB']);
    expect(r.vectors.map((v) => [v.label, v.kind])).toEqual([['경계.geojson', 'GeoJSON'], ['용도지역', 'SHP']]);
    expect(r.vectors[1].paths).toHaveLength(5);
    expect(r.styles).toEqual(['주제도/용도지역.sld']);
    expect(r.ignored).toEqual(['주제도/용도지역.sbn']);
    expect(kindCount(r)).toBe(3);
    expect(itemCount(r)).toBe(1 + 2 + 2);
  });

  it('3D Tiles 폴더가 둘이면 각각, 안쪽 외부 tileset은 따로 세지 않는다', () => {
    const r = classifyDrop(['a/tileset.json', 'a/x/tileset.json', 'b/tileset.json', 'ab/tileset.json']);
    expect(r.tilesets.map((t) => t.root).sort()).toEqual(['a/', 'ab/', 'b/']);
  });

  it('이름이 비슷한 폴더를 같은 폴더로 보지 않는다 (a/ 와 ab/)', () => {
    const r = classifyDrop(['a/tileset.json', 'ab/한글.glb']);
    expect(r.tilesets).toHaveLength(1);
    expect(r.models.map((m) => m.path)).toEqual(['ab/한글.glb']);
  });

  it('SHP는 폴더·이름이 같은 것끼리 묶고 대소문자는 구분하지 않는다', () => {
    const r = classifyDrop(['x/A.SHP', 'x/a.dbf', 'y/a.shp', 'y/a.prj']);
    expect(r.vectors).toHaveLength(2);
    expect(r.vectors.map((v) => v.paths.length).sort()).toEqual([2, 2]);
  });

  it('짝 없는 .dbf/.prj 와 모르는 파일은 건너뛴다', () => {
    const r = classifyDrop(['lonely.dbf', 'lonely.prj', 'readme.md', 'x.zip']);
    expect(r.vectors.map((v) => v.kind)).toEqual(['ZIP']);
    expect(r.ignored.sort()).toEqual(['lonely.dbf', 'lonely.prj', 'readme.md']);
  });

  it('GeoTIFF(.tif/.tiff)는 지형(DEM)으로 분류하고 개수에 센다', () => {
    const r = classifyDrop(['지형/hill.TIF', '지형/b.tiff', 'a.glb', 'a.tif.aux.xml']);
    expect(r.dems.map((d) => d.path)).toEqual(['지형/hill.TIF', '지형/b.tiff']);
    expect(r.ignored).toEqual(['a.tif.aux.xml']);
    expect(kindCount(r)).toBe(2);
    expect(itemCount(r)).toBe(3);
  });

  it('layer.json 이 있는 폴더는 지형 타일(안의 .terrain 등은 모두 그 지형 것)', () => {
    const r = classifyDrop(['지형/layer.json', '지형/0/0/0.terrain', '지형/1/1/0.terrain', 'a.glb', '건물/tileset.json', '건물/layer.json', '지형/sub/layer.json']);
    expect(r.terrains).toEqual([{ root: '지형/', name: '지형', count: 4 }]);
    expect(r.tilesets).toHaveLength(1); // 3D Tiles 폴더 안의 layer.json 은 지형이 아니다
    expect(r.models.map((m) => m.path)).toEqual(['a.glb']);
    expect(r.ignored).toEqual([]);
    expect(kindCount(r)).toBe(3);
    expect(itemCount(r)).toBe(3);
  });

  it('폴더 하나가 지형 타일이면 루트가 빈 문자열', () => {
    const r = classifyDrop(['layer.json', '0/0/0.terrain']);
    expect(r.terrains).toEqual([{ root: '', name: '', count: 2 }]);
  });

  it('글자 DEM(.txt/.xyz/.asc)도 지형 후보로 올린다', () => {
    const r = classifyDrop(['ascii/37707.txt', 'ascii/37708.txt', 'a.xyz', 'g.asc']);
    expect(r.dems.map((d) => d.label)).toEqual(['37707.txt', '37708.txt', 'a.xyz', 'g.asc']);
    expect(r.ignored).toEqual([]);
  });

  it('아무것도 열 수 없으면 0', () => {
    expect(itemCount(classifyDrop(['a.log']))).toBe(0);
    expect(itemCount(classifyDrop([]))).toBe(0);
  });
});
