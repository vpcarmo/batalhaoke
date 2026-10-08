import { useEffect, useState } from "react";

/**
 * Seconds left until `endsAt`, always derived from the absolute timestamp
 * (never a local 30→0 counter). `clockOffsetMs` = serverNow - Date.now()
 * corrects devices whose clock is wrong.
 */
export function useVoteCountdown(endsAt: string | null | undefined, clockOffsetMs = 0) {
  const compute = () => endsAt ? Math.max(0, Math.ceil((new Date(endsAt).getTime() - (Date.now() + clockOffsetMs)) / 1000)) : 0;
  const [remaining, setRemaining] = useState(compute);
  useEffect(() => {
    setRemaining(compute());
    if (!endsAt) return;
    const t = window.setInterval(() => setRemaining(compute()), 250);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt, clockOffsetMs]);
  return remaining;
}
