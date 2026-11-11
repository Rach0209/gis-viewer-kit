/**
 * 진단 안내(diagnose.js 의 "원인\n→ 해결" 문자열)를 화면에 그린다. DOM만 다루고 Cesium은 모른다.
 */
import { splitProblem } from './diagnose.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * 안내 하나: 원인 줄 + (있으면) "→ 해결" 줄.
 * @param {string} s problem() 문자열
 * @param {string} [cls] 바깥 요소 클래스 (기본 'warn' — 노란 글씨)
 */
export function problemNode(s, cls = 'warn') {
  const { text, hint } = splitProblem(s);
  const box = el('div', cls);
  box.append(el('div', 'p-text', text));
  if (hint) {
    const h = el('div', 'p-hint', `→ ${hint}`);
    box.append(h);
  }
  return box;
}

/**
 * 열 수 없을 때의 안내 패널: 이유와 해결 방법을 목록으로 보여 준다.
 * @param {HTMLElement} panel
 * @param {{title:string, problems:string[], onClose:()=>void}} o
 */
export function showProblemPanel(panel, { title, problems, onClose }) {
  panel.replaceChildren();
  panel.hidden = false;
  panel.append(el('h2', null, title));
  for (const p of problems) panel.append(problemNode(p, 'warn problem'));
  const actions = el('div', 'actions');
  const close = el('button', null, '닫기');
  close.type = 'button';
  close.addEventListener('click', onClose);
  actions.append(close);
  panel.append(actions);
}
