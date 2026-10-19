import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/api-auth';
import { readJsonObject } from '@/lib/api-input-validation';
import { getFreshConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { clearEmbyAuthCache, testEmbyConnection } from '@/lib/emby';
import { rejectCrossSiteRequest } from '@/lib/same-site';
import { invalidateSearchCache } from '@/lib/search-cache';
import { getServerStorageType } from '@/lib/storage-runtime';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;

  const storageType = getServerStorageType();
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支援本地儲存進行管理員設定' },
      { status: 400 }
    );
  }

  try {
    if (!(await requireAdmin(request))) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const body = await readJsonObject(request);
    if (!body) {
      return NextResponse.json(
        { error: '請提供有效的 JSON 物件' },
        { status: 400 }
      );
    }

    const { action } = body as { action?: string };

    if (action === 'test') {
      const { serverUrl, username, password, apiKey } = body as {
        serverUrl?: string;
        username?: string;
        password?: string;
        apiKey?: string;
      };

      const result = await testEmbyConnection({
        serverUrl,
        username,
        password,
        apiKey,
      });

      return NextResponse.json(result);
    }

    if (action === 'save') {
      const {
        enabled,
        serverUrl,
        username,
        password,
        apiKey,
        userId,
        name,
        tag,
      } = body as {
        enabled?: boolean;
        serverUrl?: string;
        username?: string;
        password?: string;
        apiKey?: string;
        userId?: string;
        name?: string;
        tag?: string;
      };

      if (enabled && !serverUrl) {
        return NextResponse.json(
          { error: '啟用時必須填寫 Emby 伺服器網址' },
          { status: 400 }
        );
      }

      await db.withAdminConfigLock(async () => {
        const freshConfig = await getFreshConfig();

        freshConfig.EmbyConfig = {
          enabled: enabled === true,
          serverUrl: typeof serverUrl === 'string' ? serverUrl.trim() : '',
          username: typeof username === 'string' ? username.trim() : '',
          password: typeof password === 'string' ? password : '',
          apiKey: typeof apiKey === 'string' ? apiKey.trim() : '',
          userId: typeof userId === 'string' ? userId.trim() : '',
          name:
            typeof name === 'string' && name.trim() ? name.trim() : 'Emby 影庫',
          tag: typeof tag === 'string' && tag.trim() ? tag.trim() : '4K原畫',
        };

        await db.saveAdminConfig(freshConfig);
        await setCachedConfig(freshConfig);
        clearEmbyAuthCache();
        invalidateSearchCache();
      });

      return NextResponse.json({ message: '儲存成功' });
    }

    return NextResponse.json({ error: '未知的操作' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '內部伺服器錯誤',
      },
      { status: 500 }
    );
  }
}
