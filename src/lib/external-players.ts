export type ExternalPlayerId =
  'copy' | 'iina' | 'infuse' | 'potplayer' | 'vlc' | 'nplayer' | 'mpv';

export type ExternalPlayer = {
  id: ExternalPlayerId;
  label: string;
};

export const EXTERNAL_PLAYERS: ExternalPlayer[] = [
  { id: 'copy', label: '複製播放網址' },
  { id: 'iina', label: 'IINA（macOS）' },
  { id: 'infuse', label: 'Infuse（Apple）' },
  { id: 'potplayer', label: 'PotPlayer（Windows）' },
  { id: 'vlc', label: 'VLC' },
  { id: 'nplayer', label: 'nPlayer（iOS）' },
  { id: 'mpv', label: 'mpv' },
];

/** 只把 http(s) 直連交給本機播放器，避免 javascript: 或站內代理網址。 */
export function isDirectPlayableUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function buildExternalPlayerHref(
  playerId: ExternalPlayerId,
  playUrl: string
): string | null {
  if (playerId === 'copy' || !isDirectPlayableUrl(playUrl)) return null;
  switch (playerId) {
    case 'iina':
      return `iina://weblink?url=${encodeURIComponent(playUrl)}`;
    case 'infuse':
      return `infuse://x-callback-url/play?url=${encodeURIComponent(playUrl)}`;
    case 'potplayer':
      return `potplayer://${playUrl}`;
    case 'vlc':
      return `vlc://${playUrl}`;
    case 'nplayer':
      return `nplayer-${playUrl}`;
    case 'mpv':
      return `mpv://${encodeURIComponent(playUrl)}`;
    default:
      return null;
  }
}
