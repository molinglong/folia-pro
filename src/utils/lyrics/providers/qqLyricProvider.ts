// src/utils/lyrics/providers/qqLyricProvider.ts

/**
 * QQ Music lyrics provider module.
 * Provides search and download/decryption capabilities for QQ Music lyrics.
 */

import { SongResult } from '../../../types';
import { parseLyricsByFormat } from '../parserCore';
import { detectTimedLyricFormat } from '../formatDetection';
import { qrcDecrypt } from './qrcDecrypt';
import { applyDetectedChorusEffects, applyNeteaseChorusByTime } from '../chorusEffects';
import type { NeteaseChorusRange } from '../chorusEffects';
import { getOriginalCoverUrl } from '../../coverUrl';
import { getQqUpstreamProxyUrl } from '../../../services/onlineMusic/qqApiConfig';

const isElectronRuntime = (): boolean => typeof window !== 'undefined' && Boolean((window as any).electron);

const QQ_UPSTREAM_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

/**
 * 上游把「请求收到但不回答」表达成 HTTP 200 + request.code 2001（IP 频控 / 风控），
 * 裹着这个错误抛出去，搜索链路才能把它说成「稍后再试」而不是「搜索失败」。
 */
export class QQUpstreamRejectedError extends Error {
  constructor(public readonly upstreamCode: number, method: string) {
    super(`QQMusic upstream rejected ${method}: code ${upstreamCode}`);
    this.name = 'QQUpstreamRejectedError';
  }
}

// 2001：本机请求太密，这一段时间不回答。后续档位码（2000/1000）是「档位没权限」，
// 不是整体拒答，不能归到这里来。
const UPSTREAM_REJECTED_CODES = new Set([2001]);

/**
 * 选出口：网页版只能走同源 lyric-proxy（浏览器直连必被 CORS 拦）；桌面版默认直连上游，
 * 但只要配了 QQ API 后端地址，就改走那个后端的同源 lyric-proxy，把出口 IP 换到服务器。
 */
const resolveEgress = (): { url: string; proxied: boolean } => {
  if (!isElectronRuntime()) {
    return { url: `/api/lyric-proxy?url=${encodeURIComponent(QQ_UPSTREAM_URL)}`, proxied: true };
  }
  const proxyUrl = getQqUpstreamProxyUrl();
  if (!proxyUrl) return { url: QQ_UPSTREAM_URL, proxied: false };
  return { url: `${proxyUrl}?url=${encodeURIComponent(QQ_UPSTREAM_URL)}`, proxied: true };
};

/**
 * Sends a POST request to u.y.qq.com via proxy or directly in Electron.
 */
async function postQQ(url: string, body: string): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: isElectronRuntime() ? 'omit' : 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': 'tmeLoginType=-1;',
      'User-Agent': 'okhttp/3.14.9',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`QQ Music API request failed: ${response.status}`);
  }

  return response.json();
}

async function requestQQ(method: string, module: string, param: any): Promise<any> {
  const payload = {
    comm: {
      ct: 11,
      cv: "1003006",
      v: "1003006",
      os_ver: "15",
      phonetype: "24122RKC7C",
      rom: "Redmi/miro/miro:15/AE3A.240806.005/OS2.0.102.0.VOMCNXM:user/release-keys",
      tmeAppID: "qqmusiclight",
      nettype: "NETWORK_WIFI",
      udid: "0",
      uid: "0",
    },
    request: {
      method,
      module,
      param,
    },
  };

  const body = JSON.stringify(payload);
  const egress = resolveEgress();
  let data: any;
  try {
    data = await postQQ(egress.url, body);
  } catch (error) {
    // 桌面端配了远端出口却走不通（那个后端版本没有 lyric-proxy、地址写错、服务器下线）时
    // 回落到直连：配置写错不该把搜索彻底打死。网页版没有可回落的直连（必被 CORS 拦），照原样抛。
    const canFallbackToDirect = isElectronRuntime() && egress.proxied && egress.url !== QQ_UPSTREAM_URL;
    if (!canFallbackToDirect) throw error;
    console.warn('[QQMusic] upstream proxy egress failed, falling back to direct:', error);
    data = await postQQ(QQ_UPSTREAM_URL, body);
  }

  if (data.code !== 0 || data.request?.code !== 0) {
    if (UPSTREAM_REJECTED_CODES.has(Number(data.request?.code))) {
      throw new QQUpstreamRejectedError(Number(data.request?.code), method);
    }
    throw new Error(`QQ Music API error: code ${data.code || data.request?.code}`);
  }

  return data.request.data;
}

/**
 * Encodes string to Base64 in UTF-8.
 */
function toBase64(str: string): string {
  try {
    return btoa(unescape(encodeURIComponent(str)));
  } catch {
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
        String.fromCharCode(parseInt(p1, 16))
      )
    );
  }
}

/**
 * Detects if a lyric string is in QRC format.
 */
function detectIsQrc(content: string): boolean {
  return content.includes('(') && content.includes(')') && /\[\d+,\d+\]/.test(content);
}

/**
 * Searches songs on QQ Music. Rejects on transport or API failure; callers decide
 * whether to swallow it (lyric matching) or surface it (song search).
 */
async function doSearchQQ(keyword: string, page: number, pageSize: number): Promise<SongResult[]> {
  const safeKeyword = keyword.trim();
  if (!safeKeyword) return [];

  const pagesize = pageSize;
  const param = {
    search_id: String(
      Math.floor(
        Math.random() * 100000000000000 + Date.now() % 86400000
      )
    ),
    remoteplace: "search.android.keyboard",
    query: safeKeyword.length > 60 ? safeKeyword.slice(0, 60) : safeKeyword,
    search_type: 0, // 0 = SONG
    num_per_page: pagesize,
    page_num: page,
    highlight: 0,
    nqc_flag: 0,
    page_id: 1,
    grp: 1,
  };

  const data = await requestQQ("DoSearchForQQMusicLite", "music.search.SearchCgiService", param);
  const songs = data?.body?.item_song || [];

  return songs.map((info: any) => {
    const artists = (info.singer || []).map((s: any, idx: number) => ({
      id: s.id || idx,
      name: s.name || 'Unknown Artist',
    }));

    const albumMid = info.album?.mid;
    const picUrl = albumMid
      ? getOriginalCoverUrl(`https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg?max_age=2592000`)
      : undefined;

    return {
      id: Number(info.id || 0),
      name: info.title || 'Unknown Song',
      artists,
      album: {
        id: Number(info.album?.id || 0),
        name: info.album?.name || 'Unknown Album',
        coverUrl: picUrl,
      },
      durationMs: (info.interval || 0) * 1000,
      qqMid: info.mid,
      // The MV vid rides along as an extra field; the provider normalizer reads it to
      // persist sourceRef.providerData.mvVid for the MV background type.
      mvVid: info.mv?.vid || undefined,
    };
  });
}

/**
 * Lyric-matching path: keeps the legacy behavior of reading transport failures as
 * "no candidates" so a broken backend cannot block lyric matching.
 */
export async function searchQQLyrics(keyword: string, page = 1, pageSize = 20): Promise<SongResult[]> {
  try {
    return await doSearchQQ(keyword, page, pageSize);
  } catch (error) {
    console.error('[QQMusic] Search failed:', error);
    return [];
  }
}

/**
 * Song-search path: failures propagate so the search overlay can show its retry UI.
 */
export async function searchQQSongs(keyword: string, page = 1, pageSize = 20): Promise<SongResult[]> {
  return doSearchQQ(keyword, page, pageSize);
}

/**
 * Fetches and decrypts QQ Music lyrics.
 */
export async function fetchQQLyrics(
  song: SongResult,
  options: { chorusRanges?: NeteaseChorusRange[] } = {}
): Promise<any | null> {
  if (!song.id || !song.qqMid) {
    throw new Error('Missing song ID or mid');
  }

  const artistsStr = song.artists?.map(a => a.name).join(', ') || '';
  
  const param = {
    albumName: toBase64(song.album?.name || ''),
    crypt: 1,
    ct: 19,
    cv: 2111,
    interval: Math.floor(song.durationMs / 1000),
    lrc_t: 0,
    qrc: 1,
    qrc_t: 0,
    roma: 1,
    roma_t: 0,
    singerName: toBase64(artistsStr),
    songID: Number(song.id),
    songName: toBase64(song.name),
    trans: 1,
    trans_t: 0,
    type: 0,
  };

  try {
    const data = await requestQQ("GetPlayLyricInfo", "music.musichallSong.PlayLyricInfo", param);
    const encryptedLyricHex = data?.lyric;
    const encryptedTransHex = data?.trans;
    const encryptedRomanizationHex = data?.roma;

    if (!encryptedLyricHex) {
      return null;
    }

    const decryptedLyric = await qrcDecrypt(encryptedLyricHex);
    const decryptedTrans = encryptedTransHex ? await qrcDecrypt(encryptedTransHex) : '';
    const decryptedRomanization = encryptedRomanizationHex ? await qrcDecrypt(encryptedRomanizationHex) : '';

    const isQrc = detectIsQrc(decryptedLyric);
    const format = isQrc ? 'qrc' : detectTimedLyricFormat(decryptedLyric);

    const parsed = parseLyricsByFormat(format, decryptedLyric, decryptedTrans, {}, decryptedRomanization);
    if (!parsed) {
      return null;
    }
    parsed.isWordByWord = isQrc;
    if (options.chorusRanges && options.chorusRanges.length > 0) {
      return applyNeteaseChorusByTime(parsed, options.chorusRanges);
    }
    return applyDetectedChorusEffects(parsed, decryptedLyric);
  } catch (error) {
    console.error('[QQMusic] Fetch lyrics failed:', error);
    return null;
  }
}
