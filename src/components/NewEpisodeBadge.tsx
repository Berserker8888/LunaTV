/** 片源比上次看到的總集數還多時，貼在海報或標題旁。 */
export function NewEpisodeBadge({
  className = '',
  count,
}: {
  className?: string;
  count?: number;
}) {
  const detail =
    count && count > 1 ? `片源更新了 ${count} 集` : '片源有新的集數';
  return (
    <span
      className={`inline-flex items-center rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold leading-none text-zinc-950 shadow-sm ${className}`}
      title={detail}
    >
      有新集
    </span>
  );
}
