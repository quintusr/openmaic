'use client';

import { usePathname, useRouter } from 'next/navigation';
import { BookOpen, Home } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PersistentNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-1 bg-white/60 dark:bg-gray-800/60 backdrop-blur-md px-1.5 py-1.5 rounded-full border border-gray-100/50 dark:border-gray-700/50 shadow-sm">
      <button
        onClick={() => router.push('/')}
        className={cn(
          'flex items-center justify-center w-8 h-8 rounded-full transition-all',
          pathname === '/'
            ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm',
        )}
        title="Home"
      >
        <Home className="w-4 h-4" />
      </button>
      <button
        onClick={() => router.push('/browse')}
        className={cn(
          'flex items-center justify-center w-8 h-8 rounded-full transition-all',
          pathname === '/browse'
            ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm',
        )}
        title="Course Library"
      >
        <BookOpen className="w-4 h-4" />
      </button>
    </div>
  );
}
