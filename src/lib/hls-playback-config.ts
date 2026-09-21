import {
  getLiveHlsBufferConfig,
  getVodHlsBufferConfig,
  HLS_APPEND_TIMEOUT_MS,
  HLS_LIVE_MAX_UNCHANGED_PLAYLIST_REFRESH,
} from '@/lib/play-page-utils';
import type { VodTransport } from '@/lib/vod-hls-proxy';

export type PlaybackDeviceProfile = {
  isMobile: boolean;
  isIOS: boolean;
  isSafari: boolean;
};

/** 開片後這麼久還沒畫面，就降級代理或換源。 */
export const PLAYBACK_STARTUP_FAILOVER_MS = 12_000;
/** 單次觀影自動換源上限，避免死源清單打出請求風暴。 */
export const PLAYBACK_AUTO_SWITCH_LIMIT = 4;

const VIDEO_CODEC_TOKEN = /^(avc1|avc3|hev1|hvc1|dvh1|dvhe|av01|vp09|vp8)/i;

export type HlsFragLoadPolicy = {
  default: {
    maxTimeToFirstByteMs: number;
    maxLoadTimeMs: number;
    timeoutRetry: {
      maxNumRetry: number;
      retryDelayMs: number;
      maxRetryDelayMs: number;
    };
    errorRetry: {
      maxNumRetry: number;
      retryDelayMs: number;
      maxRetryDelayMs: number;
    };
  };
};

/** 傳給 `new Hls()` 的子集；與 hls.js 1.7 LoadPolicy / ABR 欄位對齊。 */
export type HlsPlaybackConfig = {
  debug: boolean;
  enableWorker: boolean;
  lowLatencyMode: boolean;
  maxBufferHole: number;
  maxBufferLength: number;
  backBufferLength: number;
  maxBufferSize: number;
  maxMaxBufferLength: number;
  maxFragLookUpTolerance: number;
  appendTimeout: number;
  startFragPrefetch: boolean;
  testBandwidth: boolean;
  abrEwmaFastLive: number;
  abrEwmaSlowLive: number;
  abrBandWidthFactor: number;
  fragLoadPolicy: HlsFragLoadPolicy;
  liveMaxUnchangedPlaylistRefresh?: number;
};

export type HlsLevelLike = {
  videoCodec?: string;
  codecSet?: string;
  attrs?: Record<string, string | undefined>;
};

export function detectPlaybackDevice(
  userAgent: string,
  maxTouchPoints = 0
): PlaybackDeviceProfile {
  const ua = userAgent || '';
  const isIOS =
    /iPad|iPhone|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && maxTouchPoints >= 1);
  const isMobile = isIOS || /Mobi|Android|webOS|BlackBerry|IEMobile/i.test(ua);
  const isSafari =
    /Safari/i.test(ua) &&
    !/Chrome|Chromium|CriOS|Edg|FxiOS|Firefox|Android/i.test(ua);
  return { isMobile, isIOS, isSafari };
}

export function detectPlaybackDeviceFromNavigator(
  nav: { userAgent?: string; maxTouchPoints?: number } | undefined | null
): PlaybackDeviceProfile {
  if (!nav?.userAgent) {
    return { isMobile: false, isIOS: false, isSafari: false };
  }
  return detectPlaybackDevice(nav.userAgent, nav.maxTouchPoints ?? 0);
}

function buildFragLoadPolicy(isMobile: boolean): HlsFragLoadPolicy {
  return {
    default: {
      maxTimeToFirstByteMs: isMobile ? 6_000 : 10_000,
      maxLoadTimeMs: isMobile ? 60_000 : 120_000,
      timeoutRetry: {
        maxNumRetry: isMobile ? 2 : 4,
        retryDelayMs: 0,
        maxRetryDelayMs: 0,
      },
      errorRetry: {
        maxNumRetry: isMobile ? 3 : 6,
        retryDelayMs: 1_000,
        maxRetryDelayMs: isMobile ? 4_000 : 8_000,
      },
    },
  };
}

function buildSharedHlsConfig(
  device: PlaybackDeviceProfile,
  buffer: {
    maxBufferLength: number;
    backBufferLength: number;
    maxBufferSize: number;
  },
  options: {
    lowLatencyMode: boolean;
    maxBufferHole: number;
    maxMaxBufferLength: number;
  }
): HlsPlaybackConfig {
  const { isMobile, isIOS, isSafari } = device;
  return {
    debug: false,
    enableWorker: !isMobile && !isSafari,
    lowLatencyMode: options.lowLatencyMode,
    maxBufferHole: options.maxBufferHole,
    maxBufferLength: buffer.maxBufferLength,
    backBufferLength: buffer.backBufferLength,
    maxBufferSize: buffer.maxBufferSize,
    maxMaxBufferLength: options.maxMaxBufferLength,
    maxFragLookUpTolerance: isMobile ? 0.1 : 0.25,
    appendTimeout: HLS_APPEND_TIMEOUT_MS,
    startFragPrefetch: !isMobile,
    testBandwidth: !isIOS,
    abrEwmaFastLive: isMobile ? 2 : 3,
    abrEwmaSlowLive: isMobile ? 6 : 9,
    abrBandWidthFactor: isMobile ? 0.8 : 0.95,
    fragLoadPolicy: buildFragLoadPolicy(isMobile),
  };
}

export function getVodHlsPlaybackConfig(
  device: PlaybackDeviceProfile
): HlsPlaybackConfig {
  const buffer = { ...getVodHlsBufferConfig(device.isMobile) };
  if (device.isIOS) {
    buffer.maxBufferLength = Math.min(buffer.maxBufferLength, 10);
    buffer.backBufferLength = Math.min(buffer.backBufferLength, 8);
    buffer.maxBufferSize = Math.min(buffer.maxBufferSize, 30 * 1000 * 1000);
  }
  return buildSharedHlsConfig(device, buffer, {
    lowLatencyMode: false,
    maxBufferHole: 0.5,
    maxMaxBufferLength: device.isIOS ? 90 : device.isMobile ? 120 : 600,
  });
}

export function getLiveHlsPlaybackConfig(
  device: PlaybackDeviceProfile
): HlsPlaybackConfig {
  const buffer = getLiveHlsBufferConfig(device.isMobile);
  return {
    ...buildSharedHlsConfig(device, buffer, {
      lowLatencyMode: true,
      maxBufferHole: 0.1,
      maxMaxBufferLength: device.isMobile ? 90 : 180,
    }),
    liveMaxUnchangedPlaylistRefresh: HLS_LIVE_MAX_UNCHANGED_PLAYLIST_REFRESH,
  };
}

export function extractHlsVideoCodecs(
  levels: HlsLevelLike[] | undefined | null
): string[] {
  if (!Array.isArray(levels)) return [];
  const codecs = new Set<string>();
  for (const level of levels) {
    const rawValues = [
      level?.videoCodec,
      level?.codecSet,
      level?.attrs?.CODECS,
      level?.attrs?.codecs,
    ];
    for (const raw of rawValues) {
      if (typeof raw !== 'string') continue;
      for (const part of raw.split(',')) {
        const normalized = part.trim().replace(/^"|"$/g, '');
        if (VIDEO_CODEC_TOKEN.test(normalized)) {
          codecs.add(normalized);
        }
      }
    }
  }
  return [...codecs];
}

export function findUnsupportedHlsVideoCodec(
  levels: HlsLevelLike[] | undefined | null,
  isTypeSupported?: ((mime: string) => boolean) | null
): string | null {
  if (!isTypeSupported) return null;
  for (const codec of extractHlsVideoCodecs(levels)) {
    if (!isTypeSupported(`video/mp4; codecs="${codec}"`)) {
      return codec;
    }
  }
  return null;
}

export function getMediaSourceTypeSupported():
  ((mime: string) => boolean) | null {
  if (typeof window === 'undefined') return null;
  const mediaSource =
    window.MediaSource ||
    (
      window as unknown as {
        WebKitMediaSource?: typeof MediaSource;
      }
    ).WebKitMediaSource;
  if (!mediaSource?.isTypeSupported) return null;
  return (mime: string) => mediaSource.isTypeSupported(mime);
}

export type PlaybackFailoverReason = 'watchdog' | 'codec' | 'hlsGiveUp';
export type PlaybackFailoverAction =
  | { type: 'corsapi' }
  | { type: 'proxy' }
  | { type: 'switchSource' }
  | { type: 'giveUp' };

/**
 * 開片逾時／編碼不支援／HLS 已放棄之後的下一步。
 * codec 不走代理（代理改不了解碼）。
 * 網路問題：直連 → CORSAPI /m3u8 → 站內代理 → 換源。
 */
export function nextPlaybackFailoverAction(options: {
  reason: PlaybackFailoverReason;
  alreadyProxied?: boolean;
  transport?: VodTransport;
  hasCorsApi?: boolean;
  hasNextSource: boolean;
  autoSwitchCount: number;
  autoSwitchLimit?: number;
}): PlaybackFailoverAction {
  const limit = options.autoSwitchLimit ?? PLAYBACK_AUTO_SWITCH_LIMIT;
  const canSwitch = options.hasNextSource && options.autoSwitchCount < limit;
  const transport: VodTransport =
    options.transport ?? (options.alreadyProxied ? 'station' : 'direct');

  if (options.reason === 'codec') {
    return canSwitch ? { type: 'switchSource' } : { type: 'giveUp' };
  }

  if (transport === 'direct' && options.reason === 'watchdog') {
    return options.hasCorsApi ? { type: 'corsapi' } : { type: 'proxy' };
  }

  if (transport === 'corsapi') {
    return { type: 'proxy' };
  }

  return canSwitch ? { type: 'switchSource' } : { type: 'giveUp' };
}
