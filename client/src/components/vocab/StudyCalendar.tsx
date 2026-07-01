import { useMemo } from 'react';
import type { StudyDay } from '../../types';

interface Props {
  calendar: StudyDay[];
  days?: number;
}

export default function StudyCalendar({ calendar, days = 60 }: Props) {
  const grid = useMemo(() => {
    const today = new Date();
    const cells: { date: string; count: number; isToday: boolean }[] = [];
    const calMap = new Map(calendar.map((d) => [d.date, d.newWordsCount + d.reviewCount]));

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      cells.push({
        date: dateStr,
        count: calMap.get(dateStr) || 0,
        isToday: i === 0,
      });
    }
    return cells;
  }, [calendar, days]);

  const getColor = (count: number): string => {
    if (count === 0) return 'bg-gray-100';
    if (count < 5) return 'bg-green-200';
    if (count < 10) return 'bg-green-300';
    if (count < 20) return 'bg-green-400';
    return 'bg-green-500';
  };

  // 按周分组显示（7行）
  const weeks: typeof grid[] = [];
  // 找到第一天的星期几，补齐前面的空位
  const firstDay = new Date(grid[0]?.date || new Date());
  const startDow = firstDay.getDay(); // 0=Sun

  let currentWeek: (typeof grid[0] | null)[] = [];
  for (let i = 0; i < startDow; i++) currentWeek.push(null);

  for (const cell of grid) {
    currentWeek.push(cell);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek as typeof grid);
      currentWeek = [];
    }
  }
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push(null);
    weeks.push(currentWeek as typeof grid);
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1 min-w-fit py-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((cell, di) =>
              cell === null ? (
                <div key={di} className="w-3 h-3" />
              ) : (
                <div
                  key={di}
                  className={`w-3 h-3 rounded-sm ${getColor(cell.count)} ${cell.isToday ? 'ring-1 ring-primary-400' : ''}`}
                  title={`${cell.date}: ${cell.count} 词`}
                />
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
