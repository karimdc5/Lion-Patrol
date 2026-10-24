import { useEffect, useState } from 'preact/hooks';
import { dataVersion } from '../data/repos/records';

/** Runs an async IndexedDB query and re-runs it whenever cached data changes. */
export function useData<T>(fn: () => Promise<T>, deps: unknown[] = []): { data: T | undefined; loading: boolean } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const v = dataVersion.value;
  useEffect(() => {
    let alive = true;
    fn().then((d) => { if (alive) { setData(d); setLoading(false); } }).catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [v, ...deps]);
  return { data, loading };
}
