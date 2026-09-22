'use client';

import { useEffect, useState } from 'react';

import type { TmdbMatch } from '@/lib/tmdb-match';

function compactText(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function shouldShowOverview(source: string, overview: string): boolean {
  const next = overview.trim();
  if (!next) return false;
  const current = source.trim();
  if (!current) return true;
  const left = compactText(current);
  const right = compactText(next);
  if (!left || !right) return true;
  return left !== right && !left.includes(right) && !right.includes(left);
}

export function TmdbFacts({
  title,
  year,
  episodes,
  typeName,
  category,
  sourceOverview,
  onPoster,
  onOverview,
}: {
  title: string;
  year?: string;
  episodes?: number;
  typeName?: string;
  category?: string;
  sourceOverview?: string;
  onPoster?: (posterUrl: string) => void;
  onOverview?: (overview: string) => void;
}) {
  const [match, setMatch] = useState<TmdbMatch | null>(null);

  useEffect(() => {
    const query = title.trim();
    if (!query) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ title: query });
    if (year) params.set('year', year);
    if (episodes && episodes > 0) params.set('episodes', String(episodes));
    if (typeName) params.set('type', typeName);
    if (category) params.set('category', category);

    void (async () => {
      try {
        const response = await fetch(`/api/tmdb?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { match?: TmdbMatch | null };
        if (controller.signal.aborted) return;
        const next = payload.match || null;
        setMatch(next);
        onOverview?.(next?.overview || '');
        if (next?.posterUrl) onPoster?.(next.posterUrl);
      } catch {
        // 取消或 TMDB 暫時失敗都不影響播放。
      }
    })();

    return () => controller.abort();
  }, [category, episodes, onOverview, onPoster, title, typeName, year]);

  if (!match) return null;

  const showOverview = shouldShowOverview(sourceOverview || '', match.overview);
  const originalTitle =
    match.originalTitle &&
    compactText(match.originalTitle) !== compactText(match.title)
      ? match.originalTitle
      : '';

  return (
    <section
      className='mt-5 border-t border-white/10 pt-4'
      aria-label='繁中資料'
    >
      <div className='flex flex-wrap items-center gap-2 text-sm text-zinc-300'>
        {match.voteAverage != null && (
          <span className='rounded-full bg-amber-400/90 px-2 py-0.5 text-xs font-bold text-zinc-950 tabular-nums'>
            {match.voteAverage.toFixed(1)}
          </span>
        )}
        {match.genres.map((genre) => (
          <span
            key={genre}
            className='rounded-full border border-white/15 px-2 py-0.5 text-xs text-zinc-200'
          >
            {genre}
          </span>
        ))}
        {match.year && !year && (
          <span className='tabular-nums text-zinc-400'>{match.year}</span>
        )}
        {originalTitle && (
          <span className='text-zinc-400'>原名 {originalTitle}</span>
        )}
      </div>

      {match.director && (
        <p className='mt-3 text-sm text-zinc-300'>
          <span className='text-zinc-500'>導演 </span>
          {match.director}
        </p>
      )}

      {match.cast.length > 0 && (
        <p className='mt-2 text-sm leading-relaxed text-zinc-300'>
          <span className='text-zinc-500'>演員 </span>
          {match.cast
            .map((person) =>
              person.character
                ? `${person.name}（${person.character}）`
                : person.name
            )
            .join('、')}
        </p>
      )}

      {showOverview && (
        <div className='mt-3 text-sm leading-relaxed text-zinc-300'>
          <p className='mb-1 text-xs font-medium text-zinc-500'>繁中簡介</p>
          <p style={{ whiteSpace: 'pre-line' }}>{match.overview}</p>
        </div>
      )}

      <p className='mt-3 text-xs text-zinc-500'>
        <a
          href={match.tmdbUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='text-zinc-300 underline-offset-2 hover:text-white hover:underline'
        >
          在 TMDB 查看
        </a>
        <span className='mx-1.5 text-zinc-600'>·</span>
        簡介、演員與評分來自 TMDB，本站與 TMDB 沒有從屬關係。
      </p>
    </section>
  );
}
