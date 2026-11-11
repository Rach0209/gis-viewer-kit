/**
 * 색이 있는 래스터 읽기 작업 — 워커 안에서 돈다 (Node 시험에서는 그 자리에서 돈다).
 * 읽은 RGBA 는 이 모듈 안에 두고 화면에는 번호(id)와 요약만 준다 (좌표계를 바꿔 다시 그릴 때 큰 배열을 주고받지 않으려고).
 */
import { fromArrayBuffer, fromBlob } from 'geotiff';
import { fromLonLat, registerCrs } from '../../../viewer/src/kit/crsList.js';
import { MAX_PIXELS, crsFromGeoKeys, guessDemCrs, lonLatExtent } from '../demCore.js';
import { cornersAreBlack, fitSize, isColorImage, outputSize, parseWorldFile, reprojectRgba, stretchToRgba, worldFileBbox } from '../rasterCore.js';

/** 읽을 때 줄여 두는 긴 변의 최대 화소 (더 크게 읽어도 화면에서 쓰는 이미지는 4096 이하라 메모리만 낭비다) */
const READ_MAX_DIM = 6144;
/** 16비트 이상 다밴드 영상은 값이 크고 밴드가 여러 개라 더 작게 읽는다 (4096² x 3밴드 x 2바이트 ≈ 100 MB) */
const READ_MAX_DIM_DEEP = 4096;
const store = new Map();
let seq = 0;

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp)$/i;

async function openTiff(file) {
  return typeof FileReader !== 'undefined' ? fromBlob(file) : fromArrayBuffer(await file.arrayBuffer());
}

/** GeoTIFF 가 색 이미지인지(밴드 3개 이상, 8비트 이하) 가볍게 확인한다. DEM 읽기와 길을 나누는 데 쓴다. */
export async function probeTiff({ file }) {
  let tiff;
  try {
    tiff = await openTiff(file);
  } catch (e) {
    throw new Error(`GeoTIFF로 읽을 수 없습니다 (${e.message}). .tif/.tiff 파일인지 확인하세요.`);
  }
  const image = await tiff.getImage();
  const bands = image.getSamplesPerPixel();
  const bits = image.getBitsPerSample?.(0) ?? 32;
  const format = image.getSampleFormat?.(0) ?? 1;
  return { width: image.getWidth(), height: image.getHeight(), bands, bits, format, isImage: isColorImage({ bands, bits, format }) };
}

/** 이미지 파일(png/jpg…)을 RGBA 로: 브라우저가 그림을 풀고(큰 그림은 줄여서) 화소를 꺼낸다 */
async function decodeImage(file, maxDim) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    throw new Error('이 브라우저에서는 PNG/JPG 이미지를 읽을 수 없습니다 (GeoTIFF는 됩니다).');
  }
  const bmp = await createImageBitmap(file);
  const full = { width: bmp.width, height: bmp.height };
  const fit = fitSize(bmp.width, bmp.height, maxDim);
  const canvas = new OffscreenCanvas(fit.width, fit.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, fit.width, fit.height);
  const data = ctx.getImageData(0, 0, fit.width, fit.height).data;
  bmp.close?.();
  return { rgba: data, width: fit.width, height: fit.height, full };
}

/**
 * 파일 하나를 읽어 둔다.
 * @param {{file: Blob & {name?:string}, worldText?: string|null, limits?: {maxPixels?:number, hint?:string}}} o
 *   worldText: 같이 고른 월드파일(.pgw/.jgw/.tfw/.wld) 내용. PNG/JPG 는 위치를 이것으로만 알 수 있다.
 */
export async function openRaster({ file, worldText = null, limits = {} }) {
  const { maxPixels = MAX_PIXELS, hint = '' } = limits;
  const name = file.name ?? 'image';
  let rgba;
  let width;
  let height;
  let bbox;
  let crs = null;
  let crsHint = '';
  let srcWidth;
  let srcHeight;
  let note = '';

  if (IMAGE_EXT.test(name)) {
    if (!worldText) throw new Error(`${name}: 위치를 알 수 없습니다. 같은 이름의 월드파일(.pgw/.jgw/.wld)을 같이 고르세요. (위치 정보가 든 GeoTIFF는 월드파일이 필요 없습니다)`);
    const d = await decodeImage(file, READ_MAX_DIM);
    ({ rgba, width, height } = d);
    srcWidth = d.full.width;
    srcHeight = d.full.height;
    if (srcWidth * srcHeight > maxPixels) throw new Error(`${name}: 이미지가 너무 큽니다 (${srcWidth.toLocaleString('ko-KR')}×${srcHeight.toLocaleString('ko-KR')} 화소). 쓸 지역만 잘라내거나 줄인 파일을 쓰세요.${hint}`);
    bbox = worldFileBbox(parseWorldFile(worldText), srcWidth, srcHeight);
  } else {
    let tiff;
    try {
      tiff = await openTiff(file);
    } catch (e) {
      throw new Error(`${name}: 이미지로 읽을 수 없습니다 (${e.message}). GeoTIFF(.tif) 또는 PNG/JPG(+월드파일)인지 확인하세요.`);
    }
    const image = await tiff.getImage();
    srcWidth = image.getWidth();
    srcHeight = image.getHeight();
    if (srcWidth * srcHeight > maxPixels) throw new Error(`${name}: 이미지가 너무 큽니다 (${srcWidth.toLocaleString('ko-KR')}×${srcHeight.toLocaleString('ko-KR')} 화소). 쓸 지역만 잘라내거나 줄인 파일을 쓰세요.${hint}`);
    if (worldText) {
      bbox = worldFileBbox(parseWorldFile(worldText), srcWidth, srcHeight);
    } else {
      // 타이포인트(기준점)도 변환 행렬도 없으면 위치를 알 수 없다 (getBoundingBox 는 이때도 0 기준 값을 돌려줘서 따로 확인한다)
      const dir = image.fileDirectory;
      const located = Boolean(dir?.hasTag?.('ModelTiepoint') || dir?.hasTag?.('ModelTransformation'));
      try {
        if (!located) throw new Error('no georeference');
        bbox = image.getBoundingBox();
        image.getResolution();
      } catch {
        throw new Error(`${name}: 위치 정보(지리 참조)가 없는 이미지입니다. 같은 이름의 월드파일(.tfw/.wld)을 같이 고르세요.`);
      }
    }
    const keys = image.getGeoKeys?.() ?? {};
    crs = crsFromGeoKeys(keys);
    crsHint = keys.ProjectedCSTypeGeoKey ? `EPSG:${keys.ProjectedCSTypeGeoKey}` : keys.GeographicTypeGeoKey ? `EPSG:${keys.GeographicTypeGeoKey}` : '';
    const bands = image.getSamplesPerPixel();
    const bits = image.getBitsPerSample?.(0) ?? 8;
    if (bits > 8 && bands >= 3) {
      // 16비트(또는 그 이상) 정사영상·위성 영상: 앞 3개 밴드를 빨강·초록·파랑으로 읽어 밝기를 0~255 로 늘린다.
      // 0(또는 nodata)인 곳은 투명 (영상 가장자리). 값이 크고 밴드가 많아 메모리를 아끼려고 더 작게 읽는다.
      ({ width, height } = fitSize(srcWidth, srcHeight, READ_MAX_DIM_DEEP));
      const planes = await image.readRasters({ samples: [0, 1, 2], width, height, resampleMethod: 'nearest', interleave: false });
      const s = stretchToRgba(planes, { nodata: image.getGDALNoData?.() ?? null });
      rgba = s.rgba;
      note = `${bits}비트 ${bands}밴드 영상입니다. 앞 3개 밴드를 빨강·초록·파랑으로 쓰고, 밝기는 자동으로 늘려(값 ${Math.round(s.min).toLocaleString('ko-KR')}~${Math.round(s.max).toLocaleString('ko-KR')}, 상하위 2% 제외) 보여 줍니다. 값이 0인 가장자리는 투명입니다.`;
    } else {
      ({ width, height } = fitSize(srcWidth, srcHeight, READ_MAX_DIM));
      const rgb = await image.readRGB({ width, height, resampleMethod: 'bilinear', interleave: true });
      // 밴드가 3개(RGB)로 오면 불투명 알파를 붙이고, 4개(RGBA)면 그대로 쓴다. 흑백·색표(팔레트) 이미지도 RGB 로 풀려 온다
      const per = rgb.length / (width * height);
      rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0, n = width * height; i < n; i++) {
        rgba[i * 4] = rgb[i * per];
        rgba[i * 4 + 1] = rgb[i * per + 1];
        rgba[i * 4 + 2] = rgb[i * per + 2];
        rgba[i * 4 + 3] = per >= 4 ? rgb[i * per + 3] : 255;
      }
      if (bands > 4) note = `밴드가 ${bands}개입니다. 앞 3개 밴드를 빨강·초록·파랑으로 씁니다.`;
    }
  }

  const id = ++seq;
  store.set(id, { rgba, width, height, bbox });
  return {
    id,
    name,
    srcWidth,
    srcHeight,
    width,
    height,
    bbox,
    crs,
    crsHint,
    guessedCrs: crs ?? guessDemCrs(bbox),
    blackCorners: cornersAreBlack(rgba, width, height),
    note,
  };
}

/**
 * 좌표계가 정해지면 경위도 격자로 다시 그린다.
 * @param {{id:number, crs:string, crsDef?:{code:string,def:string,label?:string}, transparentBlack?:boolean, maxDim?:number}} o
 * @returns {{rgba:Uint8ClampedArray, outW:number, outH:number, extent:number[]}}
 */
export function projectRaster({ id, crs, crsDef, transparentBlack = false, maxDim = 4096 }) {
  const r = store.get(id);
  if (!r) throw new Error('이미 닫힌 이미지입니다. 다시 열어 주세요.');
  if (crsDef) registerCrs(crsDef);
  const extent = lonLatExtent(r.bbox, crs);
  // 원본보다 잘게 그릴 이유가 없다 (작은 이미지를 4096 칸으로 늘리면 시간만 든다)
  const { outW, outH } = outputSize(extent, Math.max(16, Math.min(maxDim, Math.max(r.width, r.height))));
  const toSource = (lon, lat) => {
    const p = fromLonLat(crs, lon, lat);
    return [p.x, p.y];
  };
  const rgba = reprojectRgba({ rgba: r.rgba, width: r.width, height: r.height, bbox: r.bbox, toSource, extent, outW, outH, transparentBlack });
  return { rgba, outW, outH, extent };
}

export function releaseRaster({ id }) {
  store.delete(id);
  return true;
}

export const heldRasters = () => store.size;
