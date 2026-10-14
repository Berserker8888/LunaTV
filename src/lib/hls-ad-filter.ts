export interface HlsAdFilterResult {
  content: string;
  removedSegments: number;
}

const MAX_CUE_OUT_SEGMENTS_WITHOUT_CUE_IN = 6;

/**
 * 分段 URL 廣告特徵關鍵字（轉小寫後比對）。
 * 涵蓋常見廣告目錄、商用標記、國內主流採集站常用拼音及切片命名：
 * - `/adjump`、`/ad/`、`/ads/`、`/adv/`、`/advert`
 * - `guanggao`（廣告拼音）、`/gg/`、`_gg.`、`gg_`
 * - `sponsor`、`redtraffic`、`/dsp/`、`/union/`、`adbanner`
 * - `cache-ad`、`ts-ad`、`ts.ad`、`ad-ts`、`shortvideo`
 */
const AD_URL_KEYWORDS = [
  '/adjump',
  '/ad/',
  '/ads/',
  '/adv/',
  '/advert',
  '/guanggao',
  'guanggao',
  'sponsor',
  'redtraffic',
  '/dsp/',
  '/union/',
  '/adbanner',
  'cache-ad',
  'ts-ad',
  'ts.ad',
  'ad-ts',
  'shortvideo',
];

/**
 * 檢查分段 URL 是否命中廣告特徵。
 * 使用前後邊界保護，防止誤殺正常切片（如 adapter.ts、download.ts、leadership.ts）。
 */
export const isAdSegmentUrl = (url: string): boolean => {
  const lower = url.toLowerCase();

  for (const keyword of AD_URL_KEYWORDS) {
    if (lower.includes(keyword)) return true;
  }

  // 檔名或路徑特徵（以邊界分隔符開始，避免誤傷含有 ad 子字串的正常單詞）
  // 匹配：/ad.ts, /ad1.ts, ad_01.ts, seg-ad.ts, _ad.ts, /adv1.ts, /gg1.ts
  if (/(^|[/_.-])ad\d*\.(ts|mp4|m4s)(\?|$)/i.test(lower)) {
    return true;
  }
  if (/(^|[/_.-])(adv|gg|dsp)\d*\.(ts|mp4|m4s)(\?|$)/i.test(lower)) {
    return true;
  }

  return false;
};

interface RawSegment {
  tags: string[];
  uri: string;
  duration: number;
  hasDiscontinuityBefore: boolean;
  isCueOut: boolean;
  hostname?: string;
  pathPrefix?: string;
}

function extractHostname(uri: string): string | undefined {
  const match = uri.match(/^https?:\/\/([^/:]+)/i);
  return match ? match[1].toLowerCase() : undefined;
}

function extractPathPrefix(uri: string): string {
  try {
    const path = uri.startsWith('http') ? new URL(uri).pathname : uri;
    const lastSlash = path.lastIndexOf('/');
    return lastSlash !== -1 ? path.slice(0, lastSlash) : '';
  } catch {
    return '';
  }
}

export function filterAdsFromM3U8Detailed(
  m3u8Content: string
): HlsAdFilterResult {
  if (!m3u8Content) return { content: '', removedSegments: 0 };

  const lines = m3u8Content.split('\n');

  // 第一階段：解析所有切片與標籤結構
  const headerLines: string[] = [];
  const footerLines: string[] = [];
  const segments: RawSegment[] = [];

  let pendingTags: string[] = [];
  let inAdBreak = false;
  let keyStartedAdBreak = false;
  let hasEncryptedContent = false;
  let cueOutSegmentCount = 0;
  let currentSegmentHasDiscontinuity = false;
  let seenFirstSegment = false;

  const isSegmentUri = (line: string) =>
    Boolean(line.trim()) && !line.trim().startsWith('#');

  const isDiscontinuity = (line: string) =>
    /^#EXT-X-DISCONTINUITY\b/i.test(line);

  const isCueOut = (line: string) =>
    /^#EXT-X-CUE-OUT\b/i.test(line) || /^#EXT-X-CUE-OUT-CONT\b/i.test(line);

  const isCueIn = (line: string) => /^#EXT-X-CUE-IN\b/i.test(line);

  const isKeyTag = (line: string) => /^#EXT-X-KEY\b/i.test(line);

  const isPlaylistEndTag = (line: string) => /^#EXT-X-ENDLIST\b/i.test(line);

  const getKeyMethod = (line: string) => {
    const match = line.match(/\bMETHOD=([^,\s]+)/i);
    return match?.[1]?.replace(/^"|"$/g, '').toUpperCase() || '';
  };

  const isAdDaterange = (line: string) =>
    /^#EXT-X-DATERANGE\b/i.test(line) &&
    /(CLASS="?com\.apple\.hls\.interstitial|CLASS="?ad|SCTE35|X-ASSET-URI|X-ASSET-LIST|X-AD|AD-ID|CUE-OUT)/i.test(
      line
    );

  const isDaterangeAdEnd = (line: string) =>
    /^#EXT-X-DATERANGE\b/i.test(line) && /(SCTE35-IN|CUE-IN)/i.test(line);

  const isAdMetadata = (line: string) =>
    /^#EXT-OATCLS-SCTE35\b/i.test(line) ||
    /^#EXT-X-SPLICEPOINT-SCTE35\b/i.test(line) ||
    /^#EXT-X-ASSET\b/i.test(line) ||
    isAdDaterange(line);

  for (const line of lines) {
    if (isPlaylistEndTag(line)) {
      footerLines.push(line);
      continue;
    }

    if (isDiscontinuity(line)) {
      currentSegmentHasDiscontinuity = true;
      pendingTags.push(line);
      continue;
    }

    if (isCueOut(line)) {
      inAdBreak = true;
      cueOutSegmentCount = 0;
      continue;
    }

    if (isCueIn(line) || isDaterangeAdEnd(line)) {
      inAdBreak = false;
      keyStartedAdBreak = false;
      cueOutSegmentCount = 0;
      continue;
    }

    if (isKeyTag(line)) {
      const method = getKeyMethod(line);
      const isEncryptedMethod = method && method !== 'NONE';

      if (
        method === 'NONE' &&
        hasEncryptedContent &&
        currentSegmentHasDiscontinuity
      ) {
        inAdBreak = true;
        keyStartedAdBreak = true;
        cueOutSegmentCount = 0;
        continue;
      }

      if (keyStartedAdBreak && isEncryptedMethod) {
        inAdBreak = false;
        keyStartedAdBreak = false;
        cueOutSegmentCount = 0;
        hasEncryptedContent = true;
        pendingTags.push(line);
        continue;
      }

      if (isEncryptedMethod) {
        hasEncryptedContent = true;
      }

      if (!inAdBreak) {
        pendingTags.push(line);
      }
      continue;
    }

    if (isAdMetadata(line)) {
      continue;
    }

    if (isSegmentUri(line)) {
      seenFirstSegment = true;
      const uri = line.trim();

      // 解析時長
      let duration = 0;
      for (const tag of pendingTags) {
        const infMatch = tag.match(/^#EXTINF:\s*([0-9.]+)/i);
        if (infMatch) {
          duration = parseFloat(infMatch[1]) || 0;
          break;
        }
      }

      const isCurrentCueOut =
        inAdBreak && cueOutSegmentCount < MAX_CUE_OUT_SEGMENTS_WITHOUT_CUE_IN;
      if (inAdBreak) {
        cueOutSegmentCount++;
        if (cueOutSegmentCount >= MAX_CUE_OUT_SEGMENTS_WITHOUT_CUE_IN) {
          inAdBreak = false;
          keyStartedAdBreak = false;
        }
      }

      segments.push({
        tags: [...pendingTags],
        uri,
        duration,
        hasDiscontinuityBefore: currentSegmentHasDiscontinuity,
        isCueOut: isCurrentCueOut,
        hostname: extractHostname(uri),
        pathPrefix: extractPathPrefix(uri),
      });

      pendingTags = [];
      currentSegmentHasDiscontinuity = false;
      continue;
    }

    // 尚未遇到第一個切片前的頭部全域標籤
    if (!seenFirstSegment) {
      headerLines.push(line);
    } else {
      pendingTags.push(line);
    }
  }

  if (segments.length === 0) {
    return {
      content: [...headerLines, ...pendingTags, ...footerLines].join('\n'),
      removedSegments: 0,
    };
  }

  // 第二階段：主機名稱統計（多數決網域分析）
  const hostCounts = new Map<string, number>();
  let totalAbsoluteHostSegments = 0;
  for (const seg of segments) {
    if (seg.hostname) {
      hostCounts.set(seg.hostname, (hostCounts.get(seg.hostname) || 0) + 1);
      totalAbsoluteHostSegments++;
    }
  }

  let dominantHost: string | undefined;
  if (totalAbsoluteHostSegments >= 8) {
    for (const [host, count] of hostCounts.entries()) {
      if (count / totalAbsoluteHostSegments >= 0.65) {
        dominantHost = host;
        break;
      }
    }
  }

  // 第三階段：分段標記廣告（三重防線判定）
  const isAdSegment = new Array<boolean>(segments.length).fill(false);

  // 1. 命中標準 CUE-OUT 或明確廣告關鍵字
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.isCueOut || isAdSegmentUrl(seg.uri)) {
      isAdSegment[i] = true;
    }
  }

  // 2. 跨網域廣告切片識別（少數切片來自第三方廣告 CDN）
  if (dominantHost && totalAbsoluteHostSegments >= 10) {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.hostname && seg.hostname !== dominantHost) {
        const hostCount = hostCounts.get(seg.hostname) || 0;
        // 該少數網域切片數 <= 8 且總佔比 < 15%
        if (hostCount <= 8 && hostCount / totalAbsoluteHostSegments < 0.15) {
          // 若有轉場中斷、時長短小（<= 35s）或具備廣告特徵，標記為廣告
          if (
            seg.hasDiscontinuityBefore ||
            seg.duration <= 35 ||
            isAdSegmentUrl(seg.uri)
          ) {
            isAdSegment[i] = true;
          }
        }
      }
    }
  }

  // 3. 中途 Discontinuity 孤島智慧切除（Mid-roll Discontinuity Island）
  // 尋找被 DISCONTINUITY 夾擊的中間短片段（1~6 段，總長度 <= 35 秒）
  let i = 0;
  while (i < segments.length) {
    // 必須由 DISCONTINUITY 開啟區間
    if (segments[i].hasDiscontinuityBefore && i > 0) {
      const blockStartIndex = i;
      let blockEndIndex = i;
      let blockDuration = 0;

      // 尋找下一個 DISCONTINUITY 或尾端
      while (
        blockEndIndex < segments.length &&
        (blockEndIndex === blockStartIndex ||
          !segments[blockEndIndex].hasDiscontinuityBefore)
      ) {
        blockDuration += segments[blockEndIndex].duration;
        blockEndIndex++;
        // 若區間超過 6 段或時長超過 35 秒，便不是典型插播廣告，立即終止該區間探測
        if (blockEndIndex - blockStartIndex > 6 || blockDuration > 35) {
          break;
        }
      }

      const blockSize = blockEndIndex - blockStartIndex;
      const isMidRollIsland =
        blockEndIndex < segments.length &&
        segments[blockEndIndex].hasDiscontinuityBefore;

      // 判斷該孤島是否具有廣告特徵：
      // (a) 區間內有任何一段命中廣告關鍵字
      // (b) 區間內網域與正片主網域不同
      // (c) 它是中途前後雙中斷夾擊（isMidRollIsland），且總長度在 5~35 秒之間，路徑與前後正片不連貫
      if (blockSize >= 1 && blockSize <= 6 && blockDuration <= 35) {
        let hasAdSignal = false;
        for (let j = blockStartIndex; j < blockEndIndex; j++) {
          if (isAdSegment[j] || isAdSegmentUrl(segments[j].uri)) {
            hasAdSignal = true;
            break;
          }
          if (
            dominantHost &&
            segments[j].hostname &&
            segments[j].hostname !== dominantHost
          ) {
            hasAdSignal = true;
            break;
          }
        }

        // 若是嚴格夾擊在兩側 DISCONTINUITY 之間的孤島，且長度符合標準插播時長
        if (!hasAdSignal && isMidRollIsland && segments.length >= 15) {
          const prevSeg = segments[blockStartIndex - 1];
          const nextSeg = segments[blockEndIndex];
          // 前後正片的路徑或主機相同，但中間孤島的路徑或主機不同
          if (
            prevSeg.pathPrefix === nextSeg.pathPrefix &&
            segments[blockStartIndex].pathPrefix !== prevSeg.pathPrefix
          ) {
            hasAdSignal = true;
          }
        }

        if (hasAdSignal) {
          for (let j = blockStartIndex; j < blockEndIndex; j++) {
            isAdSegment[j] = true;
          }
        }
      }

      i = blockEndIndex;
    } else {
      i++;
    }
  }

  // 第四階段：重新組裝過濾後的播放清單
  const filteredLines: string[] = [...headerLines];
  let removedSegments = 0;
  let carryDiscontinuity = false;

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];

    if (isAdSegment[idx]) {
      removedSegments++;
      // 若被刪除的廣告段原本帶有轉場，我們記住轉場需求，但如果廣告被完全剔除且前後是連續正片則可平滑過渡
      continue;
    }

    // 輸出保留的切片標籤
    const tagsToEmit: string[] = [];
    for (const tag of seg.tags) {
      if (isDiscontinuity(tag)) {
        // 如果前面有正常轉場或之前廣告段留下的轉場
        if (!tagsToEmit.some((t) => isDiscontinuity(t))) {
          tagsToEmit.push(tag);
        }
      } else {
        tagsToEmit.push(tag);
      }
    }

    if (carryDiscontinuity && !tagsToEmit.some((t) => isDiscontinuity(t))) {
      tagsToEmit.unshift('#EXT-X-DISCONTINUITY');
      carryDiscontinuity = false;
    }

    filteredLines.push(...tagsToEmit);
    filteredLines.push(seg.uri);
  }

  if (pendingTags.length > 0) {
    filteredLines.push(...pendingTags);
  }

  filteredLines.push(...footerLines);

  return {
    content: filteredLines.join('\n'),
    removedSegments,
  };
}
