import {
  detectPlaybackDevice,
  detectPlaybackDeviceFromNavigator,
  extractHlsVideoCodecs,
  findUnsupportedHlsVideoCodec,
  getLiveHlsPlaybackConfig,
  getVodHlsPlaybackConfig,
  nextPlaybackFailoverAction,
  PLAYBACK_AUTO_SWITCH_LIMIT,
  PLAYBACK_STARTUP_FAILOVER_MS,
} from './hls-playback-config';
import { HLS_APPEND_TIMEOUT_MS } from './play-page-utils';

describe('detectPlaybackDevice', () => {
  it('detects iPhone as mobile iOS Safari', () => {
    const device = detectPlaybackDevice(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    );
    expect(device).toEqual({
      isMobile: true,
      isIOS: true,
      isSafari: true,
    });
  });

  it('detects iPad desktop-mode as iOS', () => {
    const device = detectPlaybackDevice(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      5
    );
    expect(device.isIOS).toBe(true);
    expect(device.isMobile).toBe(true);
    expect(device.isSafari).toBe(true);
  });

  it('detects desktop Chrome as non-Safari', () => {
    const device = detectPlaybackDevice(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    );
    expect(device).toEqual({
      isMobile: false,
      isIOS: false,
      isSafari: false,
    });
  });

  it('falls back to desktop when navigator is missing', () => {
    expect(detectPlaybackDeviceFromNavigator(undefined)).toEqual({
      isMobile: false,
      isIOS: false,
      isSafari: false,
    });
  });
});

describe('getVodHlsPlaybackConfig', () => {
  it('keeps VOD off LL-HLS and uses a 0.5s buffer hole', () => {
    const config = getVodHlsPlaybackConfig({
      isMobile: false,
      isIOS: false,
      isSafari: false,
    });
    expect(config.lowLatencyMode).toBe(false);
    expect(config.maxBufferHole).toBe(0.5);
    expect(config.appendTimeout).toBe(HLS_APPEND_TIMEOUT_MS);
    expect(config.startFragPrefetch).toBe(true);
    expect(config.enableWorker).toBe(true);
    expect(config.testBandwidth).toBe(true);
    expect(config.maxMaxBufferLength).toBe(600);
    expect(config.fragLoadPolicy.default.maxTimeToFirstByteMs).toBe(10_000);
  });

  it('disables worker and prefetch on phones, tightens iOS buffers', () => {
    const android = getVodHlsPlaybackConfig({
      isMobile: true,
      isIOS: false,
      isSafari: false,
    });
    expect(android.enableWorker).toBe(false);
    expect(android.startFragPrefetch).toBe(false);
    expect(android.testBandwidth).toBe(true);
    expect(android.abrBandWidthFactor).toBe(0.8);
    expect(android.maxBufferLength).toBe(15);

    const ios = getVodHlsPlaybackConfig({
      isMobile: true,
      isIOS: true,
      isSafari: true,
    });
    expect(ios.testBandwidth).toBe(false);
    expect(ios.maxBufferLength).toBe(10);
    expect(ios.maxMaxBufferLength).toBe(90);
    expect(ios.fragLoadPolicy.default.maxTimeToFirstByteMs).toBe(6_000);
  });

  it('disables the transmuxer worker on desktop Safari', () => {
    const config = getVodHlsPlaybackConfig({
      isMobile: false,
      isIOS: false,
      isSafari: true,
    });
    expect(config.enableWorker).toBe(false);
    expect(config.startFragPrefetch).toBe(true);
  });
});

describe('getLiveHlsPlaybackConfig', () => {
  it('keeps live low-latency and a stale-playlist cap', () => {
    const config = getLiveHlsPlaybackConfig({
      isMobile: false,
      isIOS: false,
      isSafari: false,
    });
    expect(config.lowLatencyMode).toBe(true);
    expect(config.maxBufferHole).toBe(0.1);
    expect(config.liveMaxUnchangedPlaylistRefresh).toBe(5);
    expect(config.maxBufferLength).toBe(20);
  });
});

describe('HLS codec support', () => {
  it('extracts video codecs from level attrs', () => {
    expect(
      extractHlsVideoCodecs([
        {
          videoCodec: 'avc1.640032',
          attrs: { CODECS: 'avc1.640032,mp4a.40.2' },
        },
        { codecSet: 'hvc1.1.6.L120.90' },
      ])
    ).toEqual(['avc1.640032', 'hvc1.1.6.L120.90']);
  });

  it('returns the first MSE-unsupported video codec', () => {
    expect(
      findUnsupportedHlsVideoCodec(
        [{ videoCodec: 'hvc1.1.6.L120.90' }, { videoCodec: 'avc1.640032' }],
        (mime) => mime.includes('avc1')
      )
    ).toBe('hvc1.1.6.L120.90');
  });

  it('does not flag missing codec info or a missing MSE probe', () => {
    expect(
      findUnsupportedHlsVideoCodec([{ attrs: {} }], () => false)
    ).toBeNull();
    expect(
      findUnsupportedHlsVideoCodec([{ videoCodec: 'hvc1.1.6.L120.90' }], null)
    ).toBeNull();
  });
});

describe('nextPlaybackFailoverAction', () => {
  it('uses the station proxy first when startup hangs on a direct URL', () => {
    expect(
      nextPlaybackFailoverAction({
        reason: 'watchdog',
        alreadyProxied: false,
        hasNextSource: true,
        autoSwitchCount: 0,
      })
    ).toEqual({ type: 'proxy' });
  });

  it('switches source after proxy still cannot start', () => {
    expect(
      nextPlaybackFailoverAction({
        reason: 'watchdog',
        alreadyProxied: true,
        hasNextSource: true,
        autoSwitchCount: 0,
      })
    ).toEqual({ type: 'switchSource' });
    expect(
      nextPlaybackFailoverAction({
        reason: 'hlsGiveUp',
        alreadyProxied: true,
        hasNextSource: true,
        autoSwitchCount: 1,
      })
    ).toEqual({ type: 'switchSource' });
  });

  it('skips the proxy for unsupported codecs', () => {
    expect(
      nextPlaybackFailoverAction({
        reason: 'codec',
        alreadyProxied: false,
        hasNextSource: true,
        autoSwitchCount: 0,
      })
    ).toEqual({ type: 'switchSource' });
  });

  it('gives up when no candidate remains or the switch cap is reached', () => {
    expect(
      nextPlaybackFailoverAction({
        reason: 'hlsGiveUp',
        alreadyProxied: true,
        hasNextSource: false,
        autoSwitchCount: 0,
      })
    ).toEqual({ type: 'giveUp' });
    expect(
      nextPlaybackFailoverAction({
        reason: 'codec',
        alreadyProxied: false,
        hasNextSource: true,
        autoSwitchCount: PLAYBACK_AUTO_SWITCH_LIMIT,
      })
    ).toEqual({ type: 'giveUp' });
  });

  it('keeps a 12s startup budget', () => {
    expect(PLAYBACK_STARTUP_FAILOVER_MS).toBe(12_000);
  });
});
