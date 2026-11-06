import { describe, expect, it } from 'vitest';
import { classifyProbe, summarizePixels } from './tileProbe.js';

const px = (r, g, b, a, n = 64) => new Uint8ClampedArray(Array.from({ length: n }, () => [r, g, b, a]).flat());

describe('summarizePixels', () => {
  it('불투명한 흰색: 투명도 1, 밝기 255', () => {
    const s = summarizePixels(px(255, 255, 255, 255));
    expect(s.alpha).toBeCloseTo(1);
    expect(s.luma).toBeCloseTo(255, 0);
  });

  it('완전히 투명한 픽셀은 색이 (0,0,0)이어도 밝기를 0으로 끌어내리지 않는다', () => {
    const s = summarizePixels(px(0, 0, 0, 0));
    expect(s.alpha).toBe(0);
    expect(s.luma).toBe(0);
  });

  it('절반이 투명하면 투명도 0.5, 밝기는 불투명한 부분만으로 계산한다', () => {
    const data = new Uint8ClampedArray([...px(200, 200, 200, 255, 32), ...px(0, 0, 0, 0, 32)]);
    const s = summarizePixels(data);
    expect(s.alpha).toBeCloseTo(0.5);
    expect(s.luma).toBeCloseTo(200, 0);
  });

  it('빈 배열도 터지지 않는다', () => {
    expect(summarizePixels(new Uint8ClampedArray(0))).toEqual({ alpha: 0, luma: 0 });
  });
});

describe('classifyProbe', () => {
  it('정상적인 지도 타일(밝은 불투명)은 통과', () => {
    expect(classifyProbe({ alpha: 1, luma: 220 })).toBeNull();
  });

  it('어두운 지도(야간 스타일)도 완전히 검지만 않으면 통과', () => {
    expect(classifyProbe({ alpha: 1, luma: 40 })).toBeNull();
  });

  it('투명한 타일과 검은 타일은 이유를 돌려준다', () => {
    expect(classifyProbe({ alpha: 0, luma: 0 })).toMatch(/투명/);
    expect(classifyProbe({ alpha: 1, luma: 0.5 })).toMatch(/검은/);
  });

  it('검사할 수 없으면(null) 판단하지 않는다', () => {
    expect(classifyProbe(null)).toBeNull();
  });
});
