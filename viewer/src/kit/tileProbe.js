/**
 * 받은 지도 타일 이미지가 "쓸 수 있는 그림"인지 가볍게 확인한다.
 *
 * 네트워크에는 PNG가 정상으로 오는데 화면에서 까맣게 보이는 경우가 있다. 지도 공급자가 키/도메인/지역이 맞지 않을 때
 * 에러 대신 **완전히 투명하거나 검은 PNG**를 돌려주면, 투명 픽셀의 색(0,0,0)이 그대로 검게 그려지기 때문이다.
 * 이미지를 8x8로 줄여 평균 투명도와 밝기를 보고, 그런 타일은 눈에 띄는 색으로 표시하고 원인을 안내한다.
 */

/**
 * 이미지를 8x8로 줄여 평균 투명도(0~1)와 불투명한 부분의 평균 밝기(0~255)를 구한다.
 * 캔버스를 쓸 수 없거나 교차 출처 이미지라 읽을 수 없으면 null (판단하지 않는다).
 * @param {CanvasImageSource} image
 * @returns {{alpha:number, luma:number}|null}
 */
export function probeImage(image) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, 8, 8);
    return summarizePixels(ctx.getImageData(0, 0, 8, 8).data);
  } catch {
    return null;
  }
}

/** RGBA 바이트 배열의 평균 투명도와 (투명도로 가중한) 평균 밝기. 순수 함수라 시험할 수 있다. */
export function summarizePixels(data) {
  let alphaSum = 0;
  let lumaSum = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    alphaSum += a;
    lumaSum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * a;
  }
  return { alpha: n ? alphaSum / n : 0, luma: alphaSum > 0 ? lumaSum / alphaSum : 0 };
}

/**
 * 검사 결과가 "쓸 수 없는 타일"이면 이유 문구, 아니면 null.
 * @param {{alpha:number, luma:number}|null} probe
 */
export function classifyProbe(probe) {
  if (!probe) return null;
  if (probe.alpha < 0.05) return '완전히 투명한 이미지';
  if (probe.luma < 3) return '완전히 검은 이미지';
  return null;
}
