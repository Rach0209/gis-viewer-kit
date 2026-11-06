/**
 * 지도 화면을 PNG로 저장한다. 지도 캔버스 아래에 한 줄(날짜, 화면 중심 좌표, 지도 출처)을 붙인다.
 * 배경 지도(OSM 등)의 출처 표기는 화면에서는 HTML 조각이라 캔버스에 안 들어가므로 이 줄에 넣어야 이미지만 써도 출처가 남는다.
 * 앞쪽 함수(파일 이름, 아래 줄 글자)는 순수 함수라 단독으로 시험한다.
 */

const pad = (n) => String(n).padStart(2, '0');

/** gis-20261106-142530.png */
export function screenshotFileName(date) {
  return `gis-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.png`;
}

/** 아래 줄 왼쪽 글자: 날짜와 화면 중심 */
export function footerLeft(date, center) {
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (!center) return d;
  return `${d} · 중심 경도 ${center.lon.toFixed(5)} 위도 ${center.lat.toFixed(5)} · 카메라 높이 ${Math.round(center.cameraHeight).toLocaleString('ko-KR')} m`;
}

/** 지도 출처(HTML일 수 있음)를 글자로 */
export function attributionText(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&copy;/gi, '©')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 캔버스를 그대로 복사하고 아래에 줄을 붙인 캔버스를 만든다. 반드시 지도를 그린(render) 직후 같은 동작 안에서 불러야 한다.
 * @param {HTMLCanvasElement} source
 * @param {{left:string, right:string}} text
 */
export function composeScreenshot(source, { left, right }) {
  const scale = Math.max(1, source.width / Math.max(1, source.clientWidth || source.width));
  const line = Math.round(24 * scale);
  const gap = Math.round(8 * scale);
  const font = `${Math.round(12 * scale)}px system-ui, "Malgun Gothic", sans-serif`;
  // 글자가 한 줄에 다 안 들어가면(폭이 좁은 화면) 출처를 둘째 줄로 내린다
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const twoLines = !!right && probe.measureText(left).width + probe.measureText(right).width + gap * 3 > source.width;
  const band = line * (twoLines ? 2 : 1) + (twoLines ? 0 : Math.round(2 * scale));
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height + band;
  const ctx = out.getContext('2d');
  ctx.drawImage(source, 0, 0);
  ctx.fillStyle = '#14191d';
  ctx.fillRect(0, source.height, out.width, band);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8edf0';
  ctx.fillText(left, gap, source.height + line / 2 + (twoLines ? 0 : 1));
  if (right) {
    ctx.fillStyle = '#9aa6ad';
    if (twoLines) {
      ctx.fillText(right, gap, source.height + line * 1.5);
    } else {
      ctx.textAlign = 'right';
      ctx.fillText(right, out.width - gap, source.height + line / 2 + 1);
    }
  }
  return out;
}

/** 캔버스를 PNG로 내려받게 한다 */
export function downloadCanvas(canvas, fileName) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('이미지를 만들 수 없습니다 (화면이 너무 크거나 지도가 아직 그려지지 않았습니다).'));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return resolve(blob.size);
    }, 'image/png');
  });
}
