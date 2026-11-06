import { describe, expect, it } from 'vitest';
import { labelText, matches, parseColor, parseDash, parseSld, pickRule, ruleActiveAtScale } from './sld.js';

/** QGIS가 내보내는 모양(se:/ogc: 접두사, SvgParameter, ElseFilter)을 본뜬 시험용 SLD. 이름·색은 가상의 값이다. */
const QGIS_STYLE = `<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc" xmlns:se="http://www.opengis.net/se" version="1.1.0">
  <NamedLayer>
    <se:Name>zones</se:Name>
    <UserStyle>
      <se:Name>zones</se:Name>
      <se:FeatureTypeStyle>
        <se:Rule>
          <se:Name>가구역</se:Name>
          <se:Description><se:Title>가구역</se:Title></se:Description>
          <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
            <ogc:PropertyIsEqualTo><ogc:PropertyName>KIND</ogc:PropertyName><ogc:Literal>가구역</ogc:Literal></ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <se:PolygonSymbolizer>
            <se:Fill><se:SvgParameter name="fill">#64c8c8</se:SvgParameter><se:SvgParameter name="fill-opacity">0.35</se:SvgParameter></se:Fill>
            <se:Stroke><se:SvgParameter name="stroke">#232323</se:SvgParameter><se:SvgParameter name="stroke-opacity">0.5</se:SvgParameter><se:SvgParameter name="stroke-width">2</se:SvgParameter></se:Stroke>
          </se:PolygonSymbolizer>
        </se:Rule>
        <se:Rule>
          <se:Name>나구역</se:Name>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo><ogc:PropertyName>KIND</ogc:PropertyName><ogc:Literal>나구역</ogc:Literal></ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <se:PolygonSymbolizer><se:Fill><se:SvgParameter name="fill">#96fa96</se:SvgParameter></se:Fill></se:PolygonSymbolizer>
        </se:Rule>
        <se:Rule>
          <se:Name>그 밖</se:Name>
          <se:ElseFilter/>
          <se:PolygonSymbolizer><se:Fill><se:SvgParameter name="fill">#cccccc</se:SvgParameter><se:SvgParameter name="fill-opacity">0.2</se:SvgParameter></se:Fill></se:PolygonSymbolizer>
        </se:Rule>
      </se:FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>`;

describe('parseSld (QGIS 모양)', () => {
  const style = parseSld(QGIS_STYLE);

  it('규칙 3개를 순서대로 읽는다', () => {
    expect(style.name).toBe('zones');
    expect(style.rules.map((r) => r.name)).toEqual(['가구역', '나구역', '그 밖']);
    expect(style.rules[2].isElse).toBe(true);
    expect(style.properties).toEqual(['KIND']);
    expect(style.warnings).toEqual([]);
  });

  it('채우기·테두리 값을 읽고, 없는 값은 기본값(불투명 1)', () => {
    expect(style.rules[0].polygon).toEqual({ fill: '#64c8c8', fillOpacity: 0.35, stroke: { color: '#232323', opacity: 0.5, width: 2, dash: null } });
    expect(style.rules[1].polygon).toEqual({ fill: '#96fa96', fillOpacity: 1, stroke: null });
  });

  it('속성 값으로 규칙을 고른다 (일치 -> 그 규칙, 불일치 -> ElseFilter, 속성 없음 -> ElseFilter)', () => {
    expect(pickRule(style, { KIND: '가구역' }).index).toBe(0);
    expect(pickRule(style, { KIND: '나구역' }).index).toBe(1);
    expect(pickRule(style, { KIND: '다구역' }).index).toBe(2);
    expect(pickRule(style, {}).index).toBe(2);
    expect(pickRule(style, null).index).toBe(2);
  });
});

describe('필터', () => {
  const wrap = (filterXml) => `<StyledLayerDescriptor xmlns:ogc="o"><Rule><Name>r</Name><ogc:Filter>${filterXml}</ogc:Filter><PolygonSymbolizer><Fill><CssParameter name="fill">#fff</CssParameter></Fill></PolygonSymbolizer></Rule></StyledLayerDescriptor>`;
  const filterOf = (xml) => parseSld(wrap(xml)).rules[0].filter;

  it('숫자는 숫자로 비교한다 (10 > 9)', () => {
    const f = filterOf('<ogc:PropertyIsGreaterThan><ogc:PropertyName>N</ogc:PropertyName><ogc:Literal>9</ogc:Literal></ogc:PropertyIsGreaterThan>');
    expect(matches(f, { N: 10 })).toBe(true);
    expect(matches(f, { N: '10' })).toBe(true);
    expect(matches(f, { N: 8 })).toBe(false);
  });

  it('문자열 같음/다름, "01" 같은 값은 숫자 1과 같다고 본다', () => {
    const eq = filterOf('<ogc:PropertyIsEqualTo><ogc:PropertyName>C</ogc:PropertyName><ogc:Literal>A</ogc:Literal></ogc:PropertyIsEqualTo>');
    const ne = filterOf('<ogc:PropertyIsNotEqualTo><ogc:PropertyName>C</ogc:PropertyName><ogc:Literal>A</ogc:Literal></ogc:PropertyIsNotEqualTo>');
    expect(matches(eq, { C: 'A' })).toBe(true);
    expect(matches(ne, { C: 'A' })).toBe(false);
    expect(matches(ne, { C: 'B' })).toBe(true);
  });

  it('Like (% 와 _), Between, IsNull', () => {
    const like = filterOf('<ogc:PropertyIsLike wildCard="%" singleChar="_" escapeChar="!"><ogc:PropertyName>T</ogc:PropertyName><ogc:Literal>제_종%주거</ogc:Literal></ogc:PropertyIsLike>');
    expect(matches(like, { T: '제1종일반주거' })).toBe(true);
    expect(matches(like, { T: '제1종일반상업' })).toBe(false);
    const between = filterOf('<ogc:PropertyIsBetween><ogc:PropertyName>N</ogc:PropertyName><ogc:LowerBoundary><ogc:Literal>1</ogc:Literal></ogc:LowerBoundary><ogc:UpperBoundary><ogc:Literal>5</ogc:Literal></ogc:UpperBoundary></ogc:PropertyIsBetween>');
    expect(matches(between, { N: 3 })).toBe(true);
    expect(matches(between, { N: 6 })).toBe(false);
    const isNull = filterOf('<ogc:PropertyIsNull><ogc:PropertyName>X</ogc:PropertyName></ogc:PropertyIsNull>');
    expect(matches(isNull, {})).toBe(true);
    expect(matches(isNull, { X: '' })).toBe(true);
    expect(matches(isNull, { X: 'a' })).toBe(false);
  });

  it('And / Or / Not', () => {
    const a = '<ogc:PropertyIsEqualTo><ogc:PropertyName>A</ogc:PropertyName><ogc:Literal>1</ogc:Literal></ogc:PropertyIsEqualTo>';
    const b = '<ogc:PropertyIsEqualTo><ogc:PropertyName>B</ogc:PropertyName><ogc:Literal>2</ogc:Literal></ogc:PropertyIsEqualTo>';
    const and = filterOf(`<ogc:And>${a}${b}</ogc:And>`);
    expect(matches(and, { A: 1, B: 2 })).toBe(true);
    expect(matches(and, { A: 1, B: 3 })).toBe(false);
    const or = filterOf(`<ogc:Or>${a}${b}</ogc:Or>`);
    expect(matches(or, { A: 0, B: 2 })).toBe(true);
    expect(matches(or, { A: 0, B: 0 })).toBe(false);
    const not = filterOf(`<ogc:Not>${a}</ogc:Not>`);
    expect(matches(not, { A: 5 })).toBe(true);
    expect(matches(not, { A: 1 })).toBe(false);
  });

  it('지원하지 않는 필터는 경고하고 칠하지 않는다', () => {
    const style = parseSld(wrap('<ogc:BBOX/>'));
    expect(style.warnings.join(' ')).toMatch(/지원하지 않는 필터/);
    expect(matches(style.rules[0].filter, { A: 1 })).toBe(false);
  });
});

describe('기타 심볼라이저와 경고', () => {
  it('선과 점, 점선, 축척 범위를 읽는다 (경고 없음)', () => {
    const style = parseSld(`<StyledLayerDescriptor><Rule><Name>선</Name><MinScaleDenominator>1000</MinScaleDenominator><MaxScaleDenominator>50000</MaxScaleDenominator>
      <LineSymbolizer><Stroke><SvgParameter name="stroke">#ff0000</SvgParameter><SvgParameter name="stroke-width">3</SvgParameter><SvgParameter name="stroke-dasharray">5 2</SvgParameter></Stroke></LineSymbolizer>
      <PointSymbolizer><Graphic><Mark><Fill><SvgParameter name="fill">#00ff00</SvgParameter></Fill></Mark><Size>12</Size></Graphic></PointSymbolizer></Rule></StyledLayerDescriptor>`);
    expect(style.rules[0].line).toEqual({ color: '#ff0000', opacity: 1, width: 3, dash: [5, 2] });
    expect(style.rules[0].point).toMatchObject({ fill: '#00ff00', size: 12 });
    expect([style.rules[0].minScale, style.rules[0].maxScale]).toEqual([1000, 50000]);
    expect(style.warnings).toEqual([]);
  });

  it('필터가 없는 규칙은 모든 피처에 맞는다', () => {
    const style = parseSld('<StyledLayerDescriptor><Rule><Name>전체</Name><PolygonSymbolizer><Fill><SvgParameter name="fill">#123456</SvgParameter></Fill></PolygonSymbolizer></Rule></StyledLayerDescriptor>');
    expect(pickRule(style, { A: 1 }).index).toBe(0);
  });

  it('SLD가 아니거나 규칙이 없으면 오류', () => {
    expect(() => parseSld('<foo/>')).toThrow(/SLD 파일이 아닙니다/);
    expect(() => parseSld('<StyledLayerDescriptor/>')).toThrow(/규칙/);
  });
});

it('parseColor', () => {
  expect(parseColor('#ff8000', 0.5)).toEqual({ r: 1, g: 128 / 255, b: 0, a: 0.5 });
  expect(parseColor('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
  expect(parseColor('red')).toBeNull();
  expect(parseColor(null)).toBeNull();
});

describe('점선 / 축척', () => {
  it('parseDash', () => {
    expect(parseDash('5 2')).toEqual([5, 2]);
    expect(parseDash('4,1,1,1')).toEqual([4, 1, 1, 1]);
    expect(parseDash('')).toBeNull();
    expect(parseDash('a b')).toBeNull();
    expect(parseDash('0 0')).toBeNull();
    expect(parseDash(undefined)).toBeNull();
  });
  it('ruleActiveAtScale: Min <= 분모 < Max', () => {
    const r = { minScale: 1000, maxScale: 50000 };
    expect(ruleActiveAtScale(r, 999)).toBe(false);
    expect(ruleActiveAtScale(r, 1000)).toBe(true);
    expect(ruleActiveAtScale(r, 49999)).toBe(true);
    expect(ruleActiveAtScale(r, 50000)).toBe(false);
    expect(ruleActiveAtScale({ minScale: null, maxScale: null }, 1e9)).toBe(true);
    expect(ruleActiveAtScale({ minScale: null, maxScale: 100 }, 50)).toBe(true);
  });
});

describe('TextSymbolizer (글자 라벨)', () => {
  const sld = (inner) => `<StyledLayerDescriptor xmlns:ogc="o" xmlns:se="s"><Rule><Name>r</Name>${inner}</Rule></StyledLayerDescriptor>`;
  it('QGIS 모양: 속성 이름, 글꼴, 색, 후광, 앵커·이동', () => {
    const style = parseSld(sld(`<se:TextSymbolizer>
      <se:Label><ogc:PropertyName>이름</ogc:PropertyName></se:Label>
      <se:Font><se:SvgParameter name="font-family">Malgun Gothic</se:SvgParameter><se:SvgParameter name="font-size">14</se:SvgParameter><se:SvgParameter name="font-weight">bold</se:SvgParameter><se:SvgParameter name="font-style">italic</se:SvgParameter></se:Font>
      <se:Halo><se:Radius>2</se:Radius><se:Fill><se:SvgParameter name="fill">#ffffff</se:SvgParameter></se:Fill></se:Halo>
      <se:LabelPlacement><se:PointPlacement><se:AnchorPoint><se:AnchorPointX>0</se:AnchorPointX><se:AnchorPointY>1</se:AnchorPointY></se:AnchorPoint><se:Displacement><se:DisplacementX>3</se:DisplacementX><se:DisplacementY>-4</se:DisplacementY></se:Displacement></se:PointPlacement></se:LabelPlacement>
      <se:Fill><se:SvgParameter name="fill">#112233</se:SvgParameter></se:Fill>
    </se:TextSymbolizer>`));
    expect(style.warnings).toEqual([]);
    expect(style.rules[0].text).toEqual({
      props: ['이름'],
      literal: '',
      fontFamily: 'Malgun Gothic',
      fontSize: 14,
      bold: true,
      italic: true,
      fill: '#112233',
      fillOpacity: 1,
      halo: { radius: 2, fill: '#ffffff', opacity: 1 },
      anchor: [0, 1],
      displacement: [3, -4],
      linePlacement: false,
    });
  });
  it('고정 글자와 속성 섞기, 기본값', () => {
    const style = parseSld(sld(`<TextSymbolizer><Label>No.<ogc:PropertyName>id</ogc:PropertyName></Label></TextSymbolizer>`));
    const t = style.rules[0].text;
    expect(t.literal).toBe('No.');
    expect(t.props).toEqual(['id']);
    expect(t).toMatchObject({ fontSize: 10, bold: false, fill: '#000000', halo: null, anchor: [0.5, 0.5] });
    expect(labelText(t, { id: 7 })).toBe('No. 7');
  });
  it('labelText: 값이 없으면 빈 글자, 객체는 JSON', () => {
    const t = { literal: '', props: ['a', 'b'] };
    expect(labelText(t, { a: '가', b: '' })).toBe('가');
    expect(labelText(t, {})).toBe('');
    expect(labelText(t, null)).toBe('');
    expect(labelText({ literal: '', props: ['o'] }, { o: { x: 1 } })).toBe('{"x":1}');
  });
  it('고정 글자만 있는 라벨, 함수·회전은 경고', () => {
    expect(parseSld(sld('<TextSymbolizer><Label>고정</Label></TextSymbolizer>')).rules[0].text.literal).toBe('고정');
    const w = parseSld(sld(`<TextSymbolizer><Label><ogc:Function name="strConcat"><ogc:PropertyName>a</ogc:PropertyName></ogc:Function></Label><LabelPlacement><PointPlacement><Rotation>45</Rotation></PointPlacement></LabelPlacement></TextSymbolizer>`)).warnings.join(' ');
    expect(w).toMatch(/Function/);
    expect(w).toMatch(/회전/);
  });
  it('TextSymbolizer가 없는 규칙의 text는 null', () => {
    expect(parseSld(sld('<PolygonSymbolizer><Fill><CssParameter name="fill">#fff</CssParameter></Fill></PolygonSymbolizer>')).rules[0].text).toBeNull();
  });
});
