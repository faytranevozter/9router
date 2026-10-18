"use client";

import { useEffect, useState } from "react";

// Wake at the next expiry, not on a polling interval. Recheck after tab sleep.
export function useKeyExpirationClock(keys) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer;
    const schedule = () => {
      clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      const future = keys.map((key) => Date.parse(key.expiresAt)).filter((time) => time > current);
      if (future.length) {
        timer = setTimeout(schedule, Math.min(Math.min(...future) - current, 2147483647));
      }
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("focus", schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("focus", schedule);
    };
  }, [keys]);
  return now;
}
