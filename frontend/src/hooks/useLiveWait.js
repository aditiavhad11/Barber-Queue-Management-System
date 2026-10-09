import { useEffect, useState } from "react";
// Counts an estimated wait down once per minute (20 -> 19 -> 18 ...). Persisted so a refresh doesn't reset it;
// it only restarts when the queue-based estimate itself changes (e.g. someone ahead was served).
export function useLiveWait(key, minutes) {
  const [, tick] = useState(0);
  const k = `eta:${key}`;
  let rec = null;
  try {
    rec = JSON.parse(localStorage.getItem(k) || "null");
  } catch {
    rec = null;
  }
  if (!rec || rec.base !== minutes) {
    rec = { base: minutes, at: Date.now() };
    try {
      localStorage.setItem(k, JSON.stringify(rec));
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 10000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, rec.base - Math.floor((Date.now() - rec.at) / 60000));
}
