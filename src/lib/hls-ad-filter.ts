export interface HlsAdFilterResult {
  content: string;
  removedSegments: number;
}

const MAX_CUE_OUT_SEGMENTS_WITHOUT_CUE_IN = 6;

export function filterAdsFromM3U8Detailed(
  m3u8Content: string
): HlsAdFilterResult {
  if (!m3u8Content) return { content: '', removedSegments: 0 };

  const lines = m3u8Content.split('\n');
  const filteredLines: string[] = [];
  let pendingSegmentTags: string[] = [];
  let inAdBreak = false;
  let keyStartedAdBreak = false;
  let hasEncryptedContent = false;
  let removedSegments = 0;
  let cueOutSegmentCount = 0;

  const isSegmentUri = (line: string) =>
    Boolean(line.trim()) && !line.trim().startsWith('#');

  const isSegmentScopedTag = (line: string) =>
    /^#EXTINF\b/i.test(line) ||
    /^#EXT-X-BYTERANGE\b/i.test(line) ||
    /^#EXT-X-PROGRAM-DATE-TIME\b/i.test(line) ||
    /^#EXT-X-PART\b/i.test(line);

  const isDiscontinuity = (line: string) =>
    /^#EXT-X-DISCONTINUITY\b/i.test(line);

  const isCueOut = (line: string) =>
    /^#EXT-X-CUE-OUT\b/i.test(line) || /^#EXT-X-CUE-OUT-CONT\b/i.test(line);

  const isCueIn = (line: string) => /^#EXT-X-CUE-IN\b/i.test(line);

  const isKeyTag = (line: string) => /^#EXT-X-KEY\b/i.test(line);

  const isPlaylistLevelTag = (line: string) =>
    /^#EXTM3U\b/i.test(line) ||
    /^#EXT-X-VERSION\b/i.test(line) ||
    /^#EXT-X-TARGETDURATION\b/i.test(line) ||
    /^#EXT-X-MEDIA-SEQUENCE\b/i.test(line) ||
    /^#EXT-X-PLAYLIST-TYPE\b/i.test(line) ||
    /^#EXT-X-ENDLIST\b/i.test(line);

  const getKeyMethod = (line: string) => {
    const match = line.match(/\bMETHOD=([^,\s]+)/i);
    return match?.[1]?.replace(/^"|"$/g, '').toUpperCase() || '';
  };

  const hasPendingDiscontinuity = () =>
    pendingSegmentTags.some((tag) => /^#EXT-X-DISCONTINUITY\b/i.test(tag));

  const flushPendingTags = () => {
    const tags = pendingSegmentTags;
    pendingSegmentTags = [];
    return tags;
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
    if (isDiscontinuity(line)) {
      pendingSegmentTags.push(line);
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
      pendingSegmentTags = [];
      continue;
    }

    if (isKeyTag(line)) {
      const method = getKeyMethod(line);
      const isEncryptedMethod = method && method !== 'NONE';

      if (
        method === 'NONE' &&
        hasEncryptedContent &&
        hasPendingDiscontinuity()
      ) {
        inAdBreak = true;
        keyStartedAdBreak = true;
        cueOutSegmentCount = 0;
        pendingSegmentTags = [];
        continue;
      }

      if (keyStartedAdBreak && isEncryptedMethod) {
        inAdBreak = false;
        keyStartedAdBreak = false;
        cueOutSegmentCount = 0;
        filteredLines.push(...flushPendingTags(), line);
        hasEncryptedContent = true;
        continue;
      }

      if (!inAdBreak) {
        filteredLines.push(...flushPendingTags(), line);
      }

      if (isEncryptedMethod) {
        hasEncryptedContent = true;
      }

      continue;
    }

    if (isAdMetadata(line)) {
      continue;
    }

    if (isSegmentUri(line)) {
      if (inAdBreak) {
        if (cueOutSegmentCount >= MAX_CUE_OUT_SEGMENTS_WITHOUT_CUE_IN) {
          inAdBreak = false;
          keyStartedAdBreak = false;
          cueOutSegmentCount = 0;
          filteredLines.push(...flushPendingTags(), line);
          continue;
        }

        pendingSegmentTags = [];
        removedSegments++;
        cueOutSegmentCount++;
        continue;
      }

      filteredLines.push(...flushPendingTags(), line);
      continue;
    }

    if (isSegmentScopedTag(line)) {
      pendingSegmentTags.push(line);
      continue;
    }

    // 廣告區間還沒收到 CUE-IN 時，片尾標記也要留下，否則播放器會把它當成直播。
    if (isPlaylistLevelTag(line)) {
      if (!inAdBreak) {
        filteredLines.push(...flushPendingTags());
      }
      filteredLines.push(line);
      continue;
    }

    if (!inAdBreak) {
      filteredLines.push(...flushPendingTags(), line);
    } else {
      pendingSegmentTags = [];
    }
  }

  if (!inAdBreak && pendingSegmentTags.length > 0) {
    filteredLines.push(...flushPendingTags());
  }

  return {
    content: filteredLines.join('\n'),
    removedSegments,
  };
}
