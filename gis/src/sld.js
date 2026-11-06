/**
 * SLD(Styled Layer Descriptor)를 읽어 "어떤 피처에 어떤 색을 칠할지" 규칙으로 바꾸는 순수 로직 (Cesium 비의존).
 * QGIS/GeoServer가 내보내는 SLD 1.0 / 1.1 을 대상으로 한다 (네임스페이스 접두사 se:, sld:, ogc: 는 무시한다).
 *
 * 지원하는 것
 *  - 규칙(Rule)의 필터: =, !=, <, >, <=, >=, Like, IsNull, Between, And, Or, Not  (피처 속성 이름 PropertyName과 값 Literal)
 *  - ElseFilter (다른 규칙에 하나도 안 맞을 때)
 *  - PolygonSymbolizer(채우기 fill/fill-opacity, 테두리 stroke/stroke-opacity/stroke-width),
 *    LineSymbolizer(stroke*), PointSymbolizer(Mark의 fill/stroke, Size)
 *  - 테두리 점선(stroke-dasharray), 규칙의 축척 범위(Min/MaxScaleDenominator)
 *  - 글자 라벨(TextSymbolizer): Label(속성 이름·고정 글자), Font(크기·굵게·기울임·글꼴), Fill, Halo, PointPlacement(앵커·이동)
 * 지원하지 않는 것(경고로 알려 준다): 무늬 채우기(GraphicFill), 함수(Function), 회전, 선을 따라 휘는 글자
 */
import { XMLParser } from 'fast-xml-parser';

const ARRAYS = new Set(['Rule', 'SvgParameter', 'CssParameter', 'PolygonSymbolizer', 'LineSymbolizer', 'PointSymbolizer', 'TextSymbolizer', 'Mark']);

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false, // "01" 같은 값을 숫자로 바꾸지 않는다
  trimValues: true,
  isArray: (name) => ARRAYS.has(name),
});

// ---------------------------------------------------------------- 유틸
const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v) => (v == null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v));

/** 객체 안 어디에 있든 이름이 같은 노드를 모두 찾는다 (NamedLayer/UserStyle/FeatureTypeStyle 단계가 파일마다 달라서) */
function findAll(node, name, out = []) {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const n of node) findAll(n, name, out);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === name) out.push(...toArray(v));
    else findAll(v, name, out);
  }
  return out;
}

/** <SvgParameter name="fill">#fff</SvgParameter> 목록 -> { fill: '#fff' } */
function params(container) {
  const out = {};
  if (!container) return out;
  for (const p of [...toArray(container.SvgParameter), ...toArray(container.CssParameter)]) {
    const name = p?.['@_name'];
    if (name) out[name] = text(p);
  }
  return out;
}

const num = (s, d) => {
  const n = Number(s);
  return s !== '' && s != null && Number.isFinite(n) ? n : d;
};

// ---------------------------------------------------------------- 필터
const COMPARE = { PropertyIsEqualTo: 'eq', PropertyIsNotEqualTo: 'ne', PropertyIsLessThan: 'lt', PropertyIsGreaterThan: 'gt', PropertyIsLessThanOrEqualTo: 'le', PropertyIsGreaterThanOrEqualTo: 'ge' };

const operand = (node) => {
  if (node?.PropertyName !== undefined) return { prop: text(node.PropertyName) };
  if (node?.Literal !== undefined) return { lit: text(node.Literal) };
  return null;
};

/** 필터 XML 노드 -> 계산용 트리. 해석할 수 없으면 { op:'unsupported', name } */
function parseFilter(node) {
  if (!node || typeof node !== 'object') return null;
  const entries = Object.entries(node).filter(([k]) => !k.startsWith('@_') && k !== '#text');
  if (!entries.length) return null;
  const nodes = [];
  for (const [key, value] of entries) {
    for (const v of toArray(value)) {
      if (COMPARE[key]) {
        const left = v.PropertyName !== undefined ? { prop: text(v.PropertyName) } : null;
        const right = v.Literal !== undefined ? { lit: text(v.Literal) } : null;
        nodes.push(left && right ? { op: COMPARE[key], left, right } : { op: 'unsupported', name: key });
      } else if (key === 'PropertyIsLike') {
        nodes.push({
          op: 'like',
          prop: text(v.PropertyName),
          pattern: text(v.Literal),
          wildCard: v['@_wildCard'] ?? '%',
          singleChar: v['@_singleChar'] ?? '_',
          escape: v['@_escapeChar'] ?? v['@_escape'] ?? String.fromCharCode(92),
        });
      } else if (key === 'PropertyIsNull') {
        nodes.push({ op: 'null', prop: text(v.PropertyName) });
      } else if (key === 'PropertyIsBetween') {
        nodes.push({ op: 'between', prop: text(v.PropertyName), lower: text(v.LowerBoundary?.Literal), upper: text(v.UpperBoundary?.Literal) });
      } else if (key === 'And' || key === 'Or') {
        const children = parseFilter(v);
        nodes.push({ op: key === 'And' ? 'and' : 'or', children: children ? (children.op === 'and-list' ? children.children : [children]) : [] });
      } else if (key === 'Not') {
        nodes.push({ op: 'not', child: parseFilter(v) });
      } else {
        nodes.push({ op: 'unsupported', name: key });
      }
    }
  }
  return nodes.length === 1 ? nodes[0] : { op: 'and-list', children: nodes };
}

/** 문자열 둘이 모두 숫자면 숫자로, 아니면 문자열로 비교한다 */
function compare(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function likeToRegExp({ pattern, wildCard, singleChar, escape }) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === escape && i + 1 < pattern.length) re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (ch === wildCard) re += '.*';
    else if (ch === singleChar) re += '.';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 's');
}

const valueOf = (props, name) => {
  const v = props?.[name];
  return v == null ? '' : String(v);
};

/** @returns {boolean} 해석할 수 없는 필터는 false (칠하지 않는다) */
export function matches(filter, props) {
  if (!filter) return true;
  switch (filter.op) {
    case 'eq': return compare(valueOf(props, filter.left.prop), filter.right.lit) === 0;
    case 'ne': return compare(valueOf(props, filter.left.prop), filter.right.lit) !== 0;
    case 'lt': return compare(valueOf(props, filter.left.prop), filter.right.lit) < 0;
    case 'gt': return compare(valueOf(props, filter.left.prop), filter.right.lit) > 0;
    case 'le': return compare(valueOf(props, filter.left.prop), filter.right.lit) <= 0;
    case 'ge': return compare(valueOf(props, filter.left.prop), filter.right.lit) >= 0;
    case 'like': return likeToRegExp(filter).test(valueOf(props, filter.prop));
    case 'null': return props?.[filter.prop] == null || props[filter.prop] === '';
    case 'between': {
      const v = valueOf(props, filter.prop);
      return compare(v, filter.lower) >= 0 && compare(v, filter.upper) <= 0;
    }
    case 'and':
    case 'and-list': return filter.children.every((c) => matches(c, props));
    case 'or': return filter.children.some((c) => matches(c, props));
    case 'not': return !matches(filter.child, props);
    default: return false;
  }
}

// ---------------------------------------------------------------- 규칙
/** "5 2" / "5,2" -> [5, 2]. 비었거나 잘못되면 null (실선) */
export function parseDash(s) {
  if (s == null || s === '') return null;
  const parts = String(s).trim().split(/[\s,]+/).map(Number);
  return parts.length && parts.every((n) => Number.isFinite(n) && n >= 0) && parts.some((n) => n > 0) ? parts : null;
}

const strokeOf = (s) => ({
  color: s.stroke ?? null,
  opacity: num(s['stroke-opacity'], 1),
  width: num(s['stroke-width'], 1),
  dash: parseDash(s['stroke-dasharray']),
});

/** 글자 라벨 설정 읽기. @returns {{props:string[], literal:string, fontFamily:string, fontSize:number, bold:boolean, italic:boolean, fill:string, fillOpacity:number, halo:null|{radius:number, fill:string, opacity:number}, anchor:[number, number], displacement:[number, number], linePlacement:boolean}} */
function textOf(ts, warnings, ruleName) {
  const label = ts.Label;
  const props = findAll(label, 'PropertyName').map(text).filter(Boolean);
  const literals = findAll(label, 'Literal').map(text);
  const plain = typeof label === 'string' ? label : label && typeof label === 'object' ? text(label['#text']) : '';
  if (findAll(label, 'Function').length) warnings.add(`"${ruleName}": 라벨의 함수(Function)는 지원하지 않아 속성 값만 씁니다.`);
  if (ts.LabelPlacement?.PointPlacement?.Rotation !== undefined) warnings.add(`"${ruleName}": 글자 회전은 지원하지 않습니다.`);
  const font = params(ts.Font);
  const fill = params(ts.Fill);
  const halo = ts.Halo ? { radius: num(text(ts.Halo.Radius), 1), fill: params(ts.Halo.Fill).fill ?? '#ffffff', opacity: num(params(ts.Halo.Fill)['fill-opacity'], 1) } : null;
  const place = ts.LabelPlacement?.PointPlacement;
  return {
    props,
    literal: [...literals, plain].filter(Boolean).join(' '),
    fontFamily: font['font-family'] ?? '',
    fontSize: num(font['font-size'], 10),
    bold: /bold/i.test(font['font-weight'] ?? ''),
    italic: /italic|oblique/i.test(font['font-style'] ?? ''),
    fill: fill.fill ?? '#000000',
    fillOpacity: num(fill['fill-opacity'], 1),
    halo,
    anchor: [num(text(place?.AnchorPoint?.AnchorPointX), 0.5), num(text(place?.AnchorPoint?.AnchorPointY), 0.5)],
    displacement: [num(text(place?.Displacement?.DisplacementX), 0), num(text(place?.Displacement?.DisplacementY), 0)],
    linePlacement: ts.LabelPlacement?.LinePlacement !== undefined,
  };
}

/** 피처 속성으로 라벨 글자를 만든다 (고정 글자 + 속성 값들을 공백으로 이어서). 빈 글자면 '' */
export function labelText(text, props) {
  const parts = [];
  if (text.literal) parts.push(text.literal);
  for (const p of text.props) {
    const v = props?.[p];
    if (v != null && v !== '') parts.push(typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return parts.join(' ').trim();
}

/** 규칙이 이 축척(분모)에서 켜지는가. OGC 규칙: Min <= 축척분모 < Max (없는 쪽은 제한 없음) */
export function ruleActiveAtScale(rule, denom) {
  if (rule.minScale != null && denom < rule.minScale) return false;
  if (rule.maxScale != null && denom >= rule.maxScale) return false;
  return true;
}

function symbolizersOf(rule, warnings, ruleName) {
  const out = { polygon: null, line: null, point: null, text: null };
  const poly = toArray(rule.PolygonSymbolizer)[0];
  if (poly) {
    const fill = params(poly.Fill);
    if (poly.Fill?.GraphicFill) warnings.add(`"${ruleName}": 무늬 채우기(GraphicFill)는 지원하지 않습니다.`);
    out.polygon = {
      fill: poly.Fill ? (fill.fill ?? '#808080') : null,
      fillOpacity: num(fill['fill-opacity'], 1),
      stroke: poly.Stroke ? strokeOf(params(poly.Stroke)) : null,
    };
  }
  const line = toArray(rule.LineSymbolizer)[0];
  if (line) out.line = strokeOf(params(line.Stroke));
  const point = toArray(rule.PointSymbolizer)[0];
  if (point) {
    const mark = toArray(point.Graphic?.Mark)[0];
    const fill = params(mark?.Fill);
    out.point = {
      fill: fill.fill ?? '#808080',
      fillOpacity: num(fill['fill-opacity'], 1),
      stroke: mark?.Stroke ? strokeOf(params(mark.Stroke)) : null,
      size: num(text(point.Graphic?.Size), 8),
    };
  }
  const ts = toArray(rule.TextSymbolizer)[0];
  if (ts) out.text = textOf(ts, warnings, ruleName);
  return out;
}

/**
 * @typedef {{name:string, title:string, filter:object|null, isElse:boolean, minScale:number|null, maxScale:number|null, text:object|null,
 *   polygon:null|{fill:string|null, fillOpacity:number, stroke:null|{color:string|null, opacity:number, width:number}},
 *   line:null|{color:string|null, opacity:number, width:number},
 *   point:null|{fill:string, fillOpacity:number, stroke:object|null, size:number}}} SldRule
 *
 * @param {string} xmlText
 * @returns {{name:string, rules:SldRule[], warnings:string[], properties:string[]}}
 */
export function parseSld(xmlText) {
  let doc;
  try {
    doc = parser.parse(xmlText);
  } catch (e) {
    throw new Error(`SLD(XML)를 읽을 수 없습니다 (${e.message})`);
  }
  if (!doc || typeof doc !== 'object' || !('StyledLayerDescriptor' in doc)) throw new Error('SLD 파일이 아닙니다 (StyledLayerDescriptor가 없음).');

  const warnings = new Set();
  const ruleNodes = findAll(doc.StyledLayerDescriptor, 'Rule');
  if (!ruleNodes.length) throw new Error('SLD에 규칙(Rule)이 없습니다.');

  const rules = ruleNodes.map((r, i) => {
    const name = text(r.Name) || text(r.Title) || text(r.Description?.Title) || `규칙 ${i + 1}`;
    const title = text(r.Description?.Title) || text(r.Title) || name;
    const minScale = r.MinScaleDenominator !== undefined ? num(text(r.MinScaleDenominator), null) : null;
    const maxScale = r.MaxScaleDenominator !== undefined ? num(text(r.MaxScaleDenominator), null) : null;
    const filter = r.Filter ? parseFilter(r.Filter) : null;
    const unsupported = JSON.stringify(filter ?? {}).match(/"unsupported","name":"([^"]+)"/);
    if (unsupported) warnings.add(`"${name}": 지원하지 않는 필터(${unsupported[1]})가 있어 이 규칙은 칠하지 않습니다.`);
    return { name, title, filter, isElse: r.ElseFilter !== undefined, minScale, maxScale, ...symbolizersOf(r, warnings, name) };
  });

  const props = new Set();
  const collect = (f) => {
    if (!f) return;
    if (f.left?.prop) props.add(f.left.prop);
    if (f.prop) props.add(f.prop);
    (f.children ?? []).forEach(collect);
    collect(f.child);
  };
  rules.forEach((r) => collect(r.filter));

  const layerName = text(findAll(doc.StyledLayerDescriptor, 'NamedLayer')[0]?.Name);
  return { name: layerName, rules, warnings: [...warnings], properties: [...props] };
}

/**
 * 피처 하나에 적용할 규칙. 필터가 맞는 첫 규칙, 없으면 ElseFilter 규칙, 그것도 없으면 null (칠하지 않음).
 * @returns {{rule:SldRule, index:number}|null}
 */
export function pickRule(style, props) {
  let elseHit = null;
  for (let i = 0; i < style.rules.length; i++) {
    const r = style.rules[i];
    if (r.isElse) {
      elseHit ??= { rule: r, index: i };
      continue;
    }
    if (matches(r.filter, props)) return { rule: r, index: i };
  }
  return elseHit;
}

/** '#rrggbb' + 불투명도 -> {r,g,b,a} (0~1). 색이 없거나 형식이 다르면 null */
export function parseColor(hex, opacity = 1) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: opacity };
}
