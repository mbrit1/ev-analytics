import { useEffect, useState } from 'react';

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
}

export function useUtcToday(): Date {
  const [today, setToday] = useState(() => startOfUtcDay(new Date()));

  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1
    ));
    const timer = window.setTimeout(
      () => setToday(startOfUtcDay(new Date())),
      nextMidnight.getTime() - now.getTime() + 50
    );

    return () => window.clearTimeout(timer);
  }, [today]);

  return today;
}
