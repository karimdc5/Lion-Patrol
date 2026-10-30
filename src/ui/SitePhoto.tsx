import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons';
import { useData } from './useData';
import { db } from '../data/db';
import { listByParent } from '../data/repos/records';
import { getBackend } from '../auth/session';
import type { AttachmentRow } from '../data/guard';

/** Newest image attached to a site (patrol_attachments parent_type 'site'), from the local cache. */
export async function siteCover(siteId: string): Promise<AttachmentRow | null> {
  const atts = await listByParent<AttachmentRow>('patrol_attachments', siteId);
  return atts.filter((a) => a.parent_type === 'site' && a.kind === 'image')
    .sort((a, b) => String(b.client_created_at ?? b.created_at).localeCompare(String(a.client_created_at ?? a.created_at)))[0] ?? null;
}

const signed = new Map<string, { url: string; exp: number }>();
/** Object URL (local blob) or short-lived signed URL for a site photo. */
export async function sitePhotoUrl(a: AttachmentRow, thumb = true): Promise<string | null> {
  const blob = await (await db()).get('blobs', a.id);
  if (blob) return URL.createObjectURL(new Blob([(thumb && blob.thumb) || blob.bytes], { type: thumb && blob.thumb ? 'image/jpeg' : blob.mime }));
  const path = (thumb && a.thumb_path) || a.storage_path;
  const hit = signed.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  try {
    const url = (await getBackend().storage.signedUrls([path], 3600))[path];
    if (!url || url.startsWith('data:,')) return null;
    signed.set(path, { url, exp: Date.now() + 50 * 60e3 });
    return url;
  } catch { return null; }
}

function useSitePhoto(siteId: string, thumb: boolean) {
  const cover = useData(() => siteCover(siteId), [siteId]);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true; let made: string | null = null;
    if (!cover.data) { setUrl(null); return; }
    void sitePhotoUrl(cover.data, thumb).then((u) => { if (!alive) return; if (u?.startsWith('blob:')) made = u; setUrl(u); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [cover.data?.id]);
  return url;
}

/** Square thumbnail for site cards; falls back to the site-type icon. */
export function SiteThumb({ siteId, kind, size = 44 }: { siteId: string; kind: string; size?: number }) {
  const url = useSitePhoto(siteId, true);
  return url
    ? <img class="site-thumb" src={url} alt="" style={{ width: size, height: size }} data-testid="site-thumb" />
    : <span class="list-icon" style={{ background: 'var(--gold-soft)', color: 'var(--gold)', width: size, height: size, borderRadius: 12 }}><Icon name={kind === 'apartment' ? 'building' : 'store'} /></span>;
}

/** Header image on the site detail view (hidden when the site has no photo). */
export function SiteHeaderPhoto({ siteId, children }: { siteId: string; children?: preact.ComponentChildren }) {
  const url = useSitePhoto(siteId, false);
  if (!url) return null;
  return (
    <div class="site-hero" data-testid="site-hero">
      <img src={url} alt="Site photo" />
      {children}
    </div>
  );
}
