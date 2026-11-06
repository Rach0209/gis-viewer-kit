import { describe, expect, it } from 'vitest';
import { attributionText, footerLeft, screenshotFileName } from './screenshot.js';

describe('screenshot helpers', () => {
  const d = new Date(2026, 10, 6, 9, 5, 7); // 2026-11-06 09:05:07
  it('파일 이름', () => {
    expect(screenshotFileName(d)).toBe('gis-20261106-090507.png');
  });
  it('아래 줄 왼쪽: 날짜, 중심 좌표, 카메라 높이', () => {
    expect(footerLeft(d, null)).toBe('2026-11-06 09:05');
    expect(footerLeft(d, { lon: 126.978, lat: 37.5665, cameraHeight: 1234.4 })).toBe('2026-11-06 09:05 · 중심 경도 126.97800 위도 37.56650 · 카메라 높이 1,234 m');
  });
  it('출처 HTML을 글자로', () => {
    expect(attributionText('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors')).toBe('© OpenStreetMap contributors');
    expect(attributionText(undefined)).toBe('');
    expect(attributionText('A &amp; B')).toBe('A & B');
  });
});
