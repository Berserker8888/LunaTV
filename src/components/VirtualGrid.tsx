'use client';

import { useWindowVirtualizer } from '@tanstack/react-virtual';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

interface VirtualGridProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Estimated row height in px (including gap). Will be refined by measurement. */
  estimateRowHeight?: number;
  /** CSS class for row gap, applied as padding-bottom on each row so measureElement captures it */
  rowGapClass?: string;
  /** Overscan rows */
  overscan?: number;
  className?: string;
}

/**
 * A virtualised grid that piggy-backs on CSS grid for column layout
 * and virtualises *rows* via @tanstack/react-virtual.
 *
 * It measures the actual container width + first-row height so it
 * works with responsive `grid-template-columns`.
 *
 * Scroll root is the window (same as search/douban restore), not document.body.
 */
export default function VirtualGrid<T>({
  items,
  renderItem,
  estimateRowHeight = 320,
  rowGapClass = 'pb-14 sm:pb-20',
  overscan = 3,
  className = '',
}: VirtualGridProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(3);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Detect column count from a hidden probe row
  const probeRef = useRef<HTMLDivElement>(null);

  const detectColumns = useCallback(() => {
    if (!probeRef.current) return;
    const style = window.getComputedStyle(probeRef.current);
    const cols = style.gridTemplateColumns.split(' ').length;
    if (cols > 0 && cols !== columns) setColumns(cols);
  }, [columns]);

  const updateScrollMargin = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    setScrollMargin((prev) => (Math.abs(prev - top) > 1 ? top : prev));
  }, []);

  useEffect(() => {
    detectColumns();
    const ro = new ResizeObserver(detectColumns);
    if (probeRef.current) ro.observe(probeRef.current);
    return () => ro.disconnect();
  }, [detectColumns]);

  useLayoutEffect(() => {
    updateScrollMargin();
  }, [updateScrollMargin, items.length, columns]);

  useEffect(() => {
    window.addEventListener('resize', updateScrollMargin);
    return () => window.removeEventListener('resize', updateScrollMargin);
  }, [updateScrollMargin]);

  const rowCount = Math.ceil(items.length / columns);

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => estimateRowHeight,
    overscan,
    scrollMargin,
  });

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <>
      {/* Hidden probe element that shares the same grid CSS to measure column count */}
      <div
        ref={probeRef}
        aria-hidden
        className={`grid invisible h-0 overflow-hidden ${className}`}
      >
        <div />
      </div>

      <div
        ref={parentRef}
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualRows.map((virtualRow) => {
          const startIdx = virtualRow.index * columns;
          const rowItems = items.slice(startIdx, startIdx + columns);

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className={`${rowGapClass}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${
                  virtualRow.start - virtualizer.options.scrollMargin
                }px)`,
              }}
            >
              <div className={`grid ${className}`}>
                {rowItems.map((item, i) => (
                  <React.Fragment key={startIdx + i}>
                    {renderItem(item, startIdx + i)}
                  </React.Fragment>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
