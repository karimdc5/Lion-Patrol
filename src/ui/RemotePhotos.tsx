import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons';
import { getBackend } from '../auth/session';

export interface RemotePhoto { path: string; thumb?: string | null }

/** Photos stored in the private bucket, shown through short-lived signed URLs (works for the anonymous portal too). */
export function RemotePhotos({ photos, size = 96 }: { photos: RemotePhoto[]; size?: number }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = photos.map((p) => p.path).join('|');
  useEffect(() => {
    if (!photos.length) return;
    const paths = photos.map((p) => p.thumb || p.path);
    const full = photos.map((p) => p.path);
    void getBackend().storage.signedUrls([...new Set([...paths, ...full])], 3600).then(setUrls).catch(() => undefined);
  }, [key]);
  if (!photos.length) return null;
  return (
    <div class="att-tray" data-testid="remote-photos">
      {photos.map((p) => {
        const thumb = urls[p.thumb || p.path];
        const href = urls[p.path];
        const ok = !!thumb && !thumb.startsWith('data:,');
        return (
          <a key={p.path} class="att" href={href && !href.startsWith('data:,') ? href : undefined} target="_blank" rel="noopener" style={{ width: size, height: size }} data-testid="bolo-photo">
            {ok ? <img src={thumb} alt="BOLO photo" /> : <Icon name="camera" size={28} />}
          </a>
        );
      })}
    </div>
  );
}
