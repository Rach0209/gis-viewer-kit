import { describe, expect, it } from 'vitest';
import { DEM_MAX_PIXELS, PERF_KEY, currentPerf, demLimitHint, isLowEndDevice, loadPref, readEnv, resolvePerf, savePref } from './perfMode.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), map: m };
};

describe('isLowEndDevice', () => {
  it('코어가 4개 이하이면 저사양 (사무용 i3/펜티엄)', () => {
    expect(isLowEndDevice({ cores: 2 })).toBe(true);
    expect(isLowEndDevice({ cores: 4 })).toBe(true);
    expect(isLowEndDevice({ cores: 8 })).toBe(false);
  });
  it('메모리가 4GB 이하이면 저사양', () => {
    expect(isLowEndDevice({ cores: 16, memoryGB: 4 })).toBe(true);
    expect(isLowEndDevice({ cores: 16, memoryGB: 2 })).toBe(true);
    expect(isLowEndDevice({ cores: 16, memoryGB: 8 })).toBe(false);
  });
  it('모르는 값은 판단에 쓰지 않는다 (사파리·파이어폭스는 메모리를 알려 주지 않는다)', () => {
    expect(isLowEndDevice({})).toBe(false);
    expect(isLowEndDevice({ cores: undefined, memoryGB: undefined })).toBe(false);
    expect(isLowEndDevice({ cores: 0, memoryGB: NaN })).toBe(false);
    expect(isLowEndDevice(undefined)).toBe(false);
  });
});

describe('resolvePerf', () => {
  it('auto: 사양으로 판단', () => {
    expect(resolvePerf('auto', { cores: 2 }).lowEnd).toBe(true);
    expect(resolvePerf('auto', { cores: 16, memoryGB: 8 }).lowEnd).toBe(false);
  });
  it('low / normal: 사양과 상관없이 강제', () => {
    expect(resolvePerf('low', { cores: 32, memoryGB: 8 }).lowEnd).toBe(true);
    expect(resolvePerf('normal', { cores: 1, memoryGB: 1 }).lowEnd).toBe(false);
  });
  it('알 수 없는 선택은 auto로', () => {
    expect(resolvePerf('weird', { cores: 2 })).toMatchObject({ pref: 'auto', lowEnd: true });
  });
  it('저사양 설정: 안티앨리어싱 끔, 해상도 배율 1, 타일 품질 낮춤, DEM 상한 낮춤, MSAA 1', () => {
    const p = resolvePerf('low');
    expect(p).toMatchObject({ antialias: false, maxPixelRatio: 1, tileQualityScale: 1.5, maxDemPixels: DEM_MAX_PIXELS.low, msaaSamples: 1, label: '저사양' });
  });
  it('일반 설정은 예전과 같은 값', () => {
    const p = resolvePerf('normal');
    expect(p).toMatchObject({ antialias: true, maxPixelRatio: 2, tileQualityScale: 1, maxDemPixels: 120_000_000, msaaSamples: 4, label: '일반' });
  });
  it('이유 문장에 사양과 판단이 들어간다', () => {
    expect(resolvePerf('auto', { cores: 2, memoryGB: 4 }).reason).toBe('이 PC 사양(코어 2개, 메모리 약 4GB)으로 판단: 저사양');
    expect(resolvePerf('low', { cores: 16 }).reason).toBe('직접 선택: 저사양 (코어 16개)');
    expect(resolvePerf('auto', {}).reason).toContain('사양 정보를 알 수 없음');
  });
  it('자동으로 저사양이라 판단했는데 직접 일반으로 바꾼 경우를 구분할 수 있다', () => {
    const p = resolvePerf('normal', { cores: 2 });
    expect(p.detectedLow).toBe(true);
    expect(p.lowEnd).toBe(false);
  });
});

describe('저장', () => {
  it('저장한 값을 읽고, 없거나 이상한 값이면 auto', () => {
    const s = memStorage();
    expect(loadPref(s)).toBe('auto');
    savePref('low', s);
    expect(s.map.get(PERF_KEY)).toBe('low');
    expect(loadPref(s)).toBe('low');
    s.setItem(PERF_KEY, 'garbage');
    expect(loadPref(s)).toBe('auto');
    savePref('garbage', s);
    expect(loadPref(s)).toBe('auto');
  });
  it('저장소를 못 쓰는 환경(예외)에서도 죽지 않는다', () => {
    const broken = {
      getItem() {
        throw new Error('차단됨');
      },
      setItem() {
        throw new Error('차단됨');
      },
    };
    expect(loadPref(broken)).toBe('auto');
    expect(() => savePref('low', broken)).not.toThrow();
  });
});

describe('readEnv / currentPerf', () => {
  it('navigator 값을 읽는다', () => {
    expect(readEnv({ hardwareConcurrency: 4, deviceMemory: 2 })).toEqual({ cores: 4, memoryGB: 2 });
    expect(readEnv(null)).toEqual({ cores: undefined, memoryGB: undefined });
  });
  it('저장된 선택 + 사양을 합쳐 결과를 낸다', () => {
    const s = memStorage();
    savePref('normal', s);
    expect(currentPerf(s, { hardwareConcurrency: 2 }).lowEnd).toBe(false);
  });
});

describe('demLimitHint', () => {
  it('저사양일 때만 모드를 바꾸라는 안내를 붙인다', () => {
    expect(demLimitHint(resolvePerf('low'))).toContain('"일반"');
    expect(demLimitHint(resolvePerf('normal'))).toBe('');
  });
});
