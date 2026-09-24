import { DbManager } from './db';
import type { Favorite } from './types';

function favorite(total: number, known: number): Favorite {
  return {
    source_name: 'src',
    total_episodes: total,
    known_episodes: known,
    title: 'Show',
    year: '2020',
    cover: '',
    save_time: 1,
    search_title: 'Show',
    origin: 'vod',
  };
}

describe('favorite episode updates', () => {
  it('does not let an older refresh overwrite a newer episode count', async () => {
    let stored = favorite(10, 10);
    let writes = 0;
    let releaseFirstWrite!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });

    const storage = {
      getFavorite: async () => ({ ...stored }),
      setFavorite: async (_user: string, _key: string, next: Favorite) => {
        writes += 1;
        if (writes === 1) await gate;
        stored = { ...next };
      },
    };

    const manager = new DbManager(storage as never);
    const first = manager.refreshFavoriteEpisodeCount('user', 'source', '1', {
      total_episodes: 12,
    });
    const second = manager.refreshFavoriteEpisodeCount('user', 'source', '1', {
      total_episodes: 15,
    });

    for (let attempt = 0; attempt < 50 && writes < 1; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(writes).toBe(1);
    releaseFirstWrite();
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(stored.total_episodes).toBe(15);
    expect(stored.known_episodes).toBe(10);
  });
});
