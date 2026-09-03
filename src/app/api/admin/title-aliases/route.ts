import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/api-auth';
import { readJsonObject } from '@/lib/api-input-validation';
import { getFreshConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  MAX_TITLE_ALIASES,
  mergeTitleAliasBatch,
  parseTitleAliasList,
  sanitizeTitleAlias,
} from '@/lib/regional-title-aliases';
import { rejectCrossSiteRequest } from '@/lib/same-site';
import { getServerStorageType } from '@/lib/storage-runtime';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };

function denyLocalStorage() {
  return NextResponse.json(
    { error: '不支援本地儲存進行管理員設定' },
    { status: 400, headers: NO_STORE }
  );
}

export async function GET(request: NextRequest) {
  const storageType = getServerStorageType();
  if (storageType === 'localstorage') return denyLocalStorage();

  if (!(await requireAdmin(request))) {
    return NextResponse.json(
      { error: '權限不足' },
      { status: 403, headers: NO_STORE }
    );
  }

  const config = await getFreshConfig();
  return NextResponse.json(
    { aliases: config.TitleAliases || [] },
    { headers: NO_STORE }
  );
}

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;

  const storageType = getServerStorageType();
  if (storageType === 'localstorage') return denyLocalStorage();

  if (!(await requireAdmin(request))) {
    return NextResponse.json(
      { error: '權限不足' },
      { status: 403, headers: NO_STORE }
    );
  }

  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json(
      { error: '請填寫至少兩個字的台灣片名與大陸片名，且不要含冒號' },
      { status: 400, headers: NO_STORE }
    );
  }

  const isBatch = Array.isArray(body.aliases);
  if (isBatch) {
    const parsed = parseTitleAliasList(body.aliases);
    if (parsed.aliases.length === 0) {
      return NextResponse.json(
        {
          error:
            '沒有可匯入的別名。請貼上 [{ "tw": "台灣片名", "cn": "大陆片名" }] 陣列。',
        },
        { status: 400, headers: NO_STORE }
      );
    }

    const mode = body.mode === 'replace' ? 'replace' : 'merge';
    const batchResult = {
      aliases: [] as { tw: string; cn: string }[],
      added: 0,
      updated: 0,
      skipped: 0,
    };
    const locked = await db.withAdminConfigLock(async () => {
      const adminConfig = await getFreshConfig();
      const merged = mergeTitleAliasBatch(
        adminConfig.TitleAliases || [],
        parsed.aliases,
        mode
      );
      adminConfig.TitleAliases = merged.aliases;
      await db.saveAdminConfig(adminConfig);
      setCachedConfig(adminConfig);
      batchResult.aliases = merged.aliases;
      batchResult.added = merged.added;
      batchResult.updated = merged.updated;
      batchResult.skipped = merged.skipped;
      return null;
    });
    if (locked) return locked;

    revalidatePath('/', 'layout');
    return NextResponse.json(
      {
        ok: true,
        mode,
        count: batchResult.aliases.length,
        added: batchResult.added,
        updated: batchResult.updated,
        skipped: parsed.skipped + batchResult.skipped,
      },
      { headers: NO_STORE }
    );
  }

  const alias = sanitizeTitleAlias(body);
  if (!alias) {
    return NextResponse.json(
      { error: '請填寫至少兩個字的台灣片名與大陸片名，且不要含冒號' },
      { status: 400, headers: NO_STORE }
    );
  }

  const locked = await db.withAdminConfigLock(async () => {
    const adminConfig = await getFreshConfig();
    const current = [...(adminConfig.TitleAliases || [])];
    const existing = current.findIndex((item) => item.tw === alias.tw);
    if (existing >= 0) {
      current[existing] = alias;
    } else {
      if (current.length >= MAX_TITLE_ALIASES) {
        return NextResponse.json(
          { error: `最多 ${MAX_TITLE_ALIASES} 筆自訂別名` },
          { status: 400, headers: NO_STORE }
        );
      }
      current.push(alias);
    }
    adminConfig.TitleAliases = current;
    await db.saveAdminConfig(adminConfig);
    setCachedConfig(adminConfig);
    return null;
  });
  if (locked) return locked;

  revalidatePath('/', 'layout');
  return NextResponse.json({ ok: true, alias }, { headers: NO_STORE });
}

export async function DELETE(request: NextRequest) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;

  const storageType = getServerStorageType();
  if (storageType === 'localstorage') return denyLocalStorage();

  if (!(await requireAdmin(request))) {
    return NextResponse.json(
      { error: '權限不足' },
      { status: 403, headers: NO_STORE }
    );
  }

  const { searchParams } = new URL(request.url);
  const fromQuery = searchParams.get('tw');
  const body = fromQuery ? { tw: fromQuery } : await readJsonObject(request);
  const tw =
    body && typeof body.tw === 'string' ? body.tw.trim() : fromQuery?.trim();
  if (!tw) {
    return NextResponse.json(
      { error: '請指定要刪除的台灣片名' },
      { status: 400, headers: NO_STORE }
    );
  }

  await db.withAdminConfigLock(async () => {
    const adminConfig = await getFreshConfig();
    adminConfig.TitleAliases = (adminConfig.TitleAliases || []).filter(
      (item) => item.tw !== tw
    );
    await db.saveAdminConfig(adminConfig);
    setCachedConfig(adminConfig);
  });

  revalidatePath('/', 'layout');
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
