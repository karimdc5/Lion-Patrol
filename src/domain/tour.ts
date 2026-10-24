export interface TourCheckpoint { id: string; seq: number; lat: number | null; lng: number | null; radius_m: number }
export interface PriorScan { checkpoint_id: string; flags: string[] }

/** Flags for a scan given the run so far. Pure; unit tested. */
export function evaluateScan(args: {
  checkpoint: TourCheckpoint;
  checkpoints: TourCheckpoint[];
  prior: PriorScan[];
  runStartedAt: number;
  now: number;
  maxDurationMin: number;
  fix: { lat: number; lng: number; accuracy: number } | null;
  distance: (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => number;
}): { flags: string[]; distance: number | null } {
  const { checkpoint, checkpoints, prior, fix } = args;
  const flags: string[] = [];
  const done = new Set(prior.filter((p) => !p.flags.includes('duplicate')).map((p) => p.checkpoint_id));
  if (done.has(checkpoint.id)) flags.push('duplicate');
  else {
    const ordered = [...checkpoints].sort((a, b) => a.seq - b.seq);
    const expected = ordered.find((c) => !done.has(c.id));
    if (expected && expected.id !== checkpoint.id) flags.push('out_of_order');
  }
  if (args.now - args.runStartedAt > args.maxDurationMin * 60_000) flags.push('late');
  let distance: number | null = null;
  if (!fix) flags.push('no_gps');
  else if (checkpoint.lat != null && checkpoint.lng != null) {
    distance = Math.round(args.distance(fix, { lat: checkpoint.lat, lng: checkpoint.lng }));
    if (distance > checkpoint.radius_m + Math.min(fix.accuracy, 100)) flags.push('off_site');
  }
  return { flags, distance };
}

export function parseCheckpointCode(raw: string): string {
  const s = raw.trim();
  const m = s.match(/\/q\/([A-Za-z0-9-]+)/);
  const code = (m ? m[1]! : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.replace(/O/g, '0').replace(/[IL]/g, '1');
}
