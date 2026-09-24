'use client';

import { useEffect, useRef, useState } from 'react';

import {
  buildExternalPlayerHref,
  EXTERNAL_PLAYERS,
  type ExternalPlayer,
  isDirectPlayableUrl,
} from '@/lib/external-players';

async function copyPlayUrl(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

function openPlayer(href: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.rel = 'noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function ExternalPlayerButton({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const playable = isDirectPlayableUrl(url);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!playable) return null;

  const choose = async (player: ExternalPlayer) => {
    if (player.id === 'copy') {
      const copied = await copyPlayUrl(url);
      setNotice(copied ? '已複製播放網址' : '無法複製，請改用播放器');
      setOpen(false);
      return;
    }
    const href = buildExternalPlayerHref(player.id, url);
    if (!href) return;
    openPlayer(href);
    setNotice('已送出開啟要求。若沒有反應，代表尚未安裝這個播放器');
    setOpen(false);
  };

  return (
    <div ref={rootRef} className='relative shrink-0'>
      <button
        type='button'
        aria-expanded={open}
        aria-haspopup='menu'
        onClick={() => setOpen((value) => !value)}
        className='rounded-full border border-white/15 px-2.5 py-0.5 text-xs font-medium text-zinc-300 transition-colors hover:border-white/30 hover:text-white'
      >
        外部播放
      </button>
      {notice && (
        <span className='ml-2 text-xs text-zinc-400' role='status'>
          {notice}
        </span>
      )}
      {open && (
        <div
          role='menu'
          className='absolute left-0 z-50 mt-2 w-64 rounded-xl border border-white/10 bg-zinc-900 p-1 shadow-xl'
        >
          <p className='px-2 py-1.5 text-[11px] leading-relaxed text-zinc-500'>
            開啟這一集的片源直連。本機要已安裝播放器；需要特定 Referer
            的來源可能打不開。
          </p>
          {EXTERNAL_PLAYERS.map((player) => (
            <button
              key={player.id}
              type='button'
              role='menuitem'
              onClick={() => void choose(player)}
              className='block w-full rounded-lg px-2 py-1.5 text-left text-sm text-zinc-200 hover:bg-white/10'
            >
              {player.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
