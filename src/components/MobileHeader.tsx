'use client';

import Link from 'next/link';

import { BackButton } from './BackButton';
import { useSite } from './SiteProvider';
import { UserMenu } from './UserMenu';

interface MobileHeaderProps {
  showBackButton?: boolean;
}

const MobileHeader = ({ showBackButton = false }: MobileHeaderProps) => {
  const { siteName } = useSite();
  return (
    <header className='md:hidden fixed top-0 left-0 right-0 z-[999] w-full bg-zinc-50/92 dark:bg-anime-dark/95 backdrop-blur-xl border-b border-zinc-300/80 dark:border-accent/20 shadow-sm dark:shadow-[0_2px_15px_rgba(0,229,255,0.05)] text-zinc-900 dark:text-zinc-100'>
      <div className='h-12 flex items-center justify-between px-4'>
        {/* 左側：返回按鈕（搜尋入口已整合進底部導航，此處不再重複放置） */}
        <div className='flex items-center gap-2'>
          {showBackButton && <BackButton />}
        </div>

        {/* 右側按鈕 */}
        {/* 本站以 ThemeProvider 的 forcedTheme='dark' 固定為深色，
            主題切換鈕按了不會有任何效果，故移除以免誤導。 */}
        <div className='flex items-center gap-2'>
          <UserMenu />
        </div>
      </div>

      {/* 中間：Logo（絕對居中） */}
      <div className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'>
        <Link
          href='/'
          // 加上內距讓可點高度達 40px（原本僅 29px）。標頭本身高 48px，
          // 且此區塊為絕對置中，補內距不會影響版面。
          className='inline-flex items-center px-2 py-1.5 text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-wide hover:opacity-80 transition-opacity'
        >
          {siteName}
        </Link>
      </div>
    </header>
  );
};

export default MobileHeader;
