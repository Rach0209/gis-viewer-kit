import { describe, it, expect, beforeEach } from 'vitest';
import { setScriptUrl, defaultDecoderBaseUrl } from './scriptBase.js';

describe('defaultDecoderBaseUrl', () => {
  beforeEach(() => setScriptUrl(null));

  it('등록 전에는 기존 동작(/)을 유지한다', () => {
    expect(defaultDecoderBaseUrl()).toBe('/');
  });

  it('스크립트가 있는 폴더를 돌려준다 (끝에 /)', () => {
    setScriptUrl('https://cdn.example.com/tv/1.0/tile-viewer.iife.js');
    expect(defaultDecoderBaseUrl()).toBe('https://cdn.example.com/tv/1.0/');
  });

  it('쿼리와 해시는 무시한다', () => {
    setScriptUrl('http://localhost:5176/tile-viewer.iife.js?v=3#x');
    expect(defaultDecoderBaseUrl()).toBe('http://localhost:5176/');
  });

  it('file: URL이나 잘못된 값도 예외 없이 처리한다', () => {
    setScriptUrl('file:///C:/site/tile-viewer.es.js');
    expect(defaultDecoderBaseUrl()).toBe('file:///C:/site/');
    setScriptUrl('not a url');
    expect(defaultDecoderBaseUrl()).toBe('/');
    setScriptUrl(undefined);
    expect(defaultDecoderBaseUrl()).toBe('/');
  });
});
