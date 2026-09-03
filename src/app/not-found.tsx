import { Home, Search } from 'lucide-react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className='flex min-h-screen items-center justify-center bg-deep p-6 text-zinc-100'>
      <section className='w-full max-w-md text-center'>
        <p className='text-sm font-medium tracking-widest text-accent'>404</p>
        <h1 className='mt-2 text-2xl font-semibold'>找不到這個頁面</h1>
        <p className='mt-3 text-sm text-zinc-400'>
          網址可能打錯，或這個頁面已經不存在。可以回首頁，或直接搜尋片名。
        </p>
        <div className='mt-6 flex flex-wrap justify-center gap-3'>
          <Link
            href='/'
            className='inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90'
          >
            <Home className='h-4 w-4' aria-hidden='true' />
            返回首頁
          </Link>
          <Link
            href='/search'
            className='inline-flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-900'
          >
            <Search className='h-4 w-4' aria-hidden='true' />
            前往搜尋
          </Link>
        </div>
      </section>
    </main>
  );
}
