/**
 * Java 백엔드(모드 B) 클라이언트. 계약은 docs/04-backend-api.md.
 *
 * 서버는 타일셋 "목록"과 "entry 주소"만 알려주고, 타일 자체는 일반 URL과 똑같이 로드한다.
 * 그래서 로드 단계에서는 { kind: 'backend', apiUrl, id } 를 { kind: 'url' } 로 바꿔 쓰면 된다.
 */

/** 서버 프로필에서 뷰어가 이해하는 항목만 통과시킨다. */
const PROFILE_KEYS = ['mode', 'errorTarget', 'enableFade', 'origin'];

export function pickProfile(profile) {
  const out = {};
  if (!profile || typeof profile !== 'object') return out;
  for (const k of PROFILE_KEYS) {
    if (profile[k] !== undefined && profile[k] !== null) out[k] = profile[k];
  }
  if (out.mode !== undefined && out.mode !== 'model' && out.mode !== 'geo') delete out.mode;
  return out;
}

/** apiUrl 끝의 슬래시를 정리한다. */
function baseOf(apiUrl) {
  if (!apiUrl || typeof apiUrl !== 'string') throw new Error('서버 주소(apiUrl)가 필요합니다.');
  return apiUrl.replace(/\/+$/, '');
}

/** entry는 서버 루트 기준 경로이거나 절대 URL이다 (이후 CDN/서명 URL 대비). */
export function resolveEntry(apiUrl, entry) {
  const base = baseOf(apiUrl);
  const e = String(entry);
  if (/^[a-z][a-z0-9+.-]*:/i.test(e)) return new URL(e).toString(); // 절대 URL (CDN 등)
  return new URL(e.replace(/^\/+/, ''), `${base}/`).toString();
}

async function getJson(url, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, { mode: 'cors', headers: { Accept: 'application/json, application/problem+json' } });
  } catch (e) {
    throw new Error(`서버에 연결하지 못했습니다: ${url} (${e?.message ?? e})`);
  }
  if (!res.ok) {
    let detail = '';
    try {
      const p = await res.json();
      detail = p?.detail ? ` - ${p.detail}` : '';
    } catch {
      /* 본문이 JSON이 아니면 상태 코드만 */
    }
    throw new Error(`서버 오류 (HTTP ${res.status})${detail}: ${url}`);
  }
  return res.json();
}

function normalize(apiUrl, raw) {
  return {
    id: raw.id,
    name: raw.name || raw.id,
    description: raw.description || '',
    url: resolveEntry(apiUrl, raw.entry),
    profile: pickProfile(raw.profile),
    sizeBytes: raw.sizeBytes ?? null,
    updatedAt: raw.updatedAt ?? null,
  };
}

/** 서버가 가진 타일셋 목록. @returns {Promise<Array<{id,name,description,url,profile,sizeBytes,updatedAt}>>} */
export async function listBackendTilesets(apiUrl, fetchImpl = globalThis.fetch.bind(globalThis)) {
  const list = await getJson(`${baseOf(apiUrl)}/api/tilesets`, fetchImpl);
  if (!Array.isArray(list)) throw new Error('서버 응답 형식이 올바르지 않습니다 (/api/tilesets 는 배열이어야 합니다).');
  return list.map((t) => normalize(apiUrl, t));
}

export async function getBackendTileset(apiUrl, id, fetchImpl = globalThis.fetch.bind(globalThis)) {
  const raw = await getJson(`${baseOf(apiUrl)}/api/tilesets/${encodeURIComponent(id)}`, fetchImpl);
  return normalize(apiUrl, raw);
}
