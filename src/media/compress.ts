export interface Prepared {
  kind: 'image' | 'video' | 'audio' | 'voice_note' | 'document';
  mime: string;
  ext: string;
  bytes: ArrayBuffer;
  thumb: ArrayBuffer | null;
  width?: number;
  height?: number;
  durationS?: number;
  name: string;
}

export const MAX_IMAGE_EDGE = 2000;
export const THUMB_EDGE = 320;

async function decode(file: Blob): Promise<{ draw: CanvasImageSource; w: number; h: number; close: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      return { draw: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch { /* fall back to <img> (e.g. HEIC on older WebKit) */ }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return { draw: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

function canvasJpeg(src: CanvasImageSource, w: number, h: number, maxEdge: number, quality: number): Promise<{ blob: Blob; w: number; h: number }> {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, cw, ch);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve({ blob: b, w: cw, h: ch }) : reject(new Error('encode failed'))), 'image/jpeg', quality));
}

/** Re-encode through canvas: ≤2000px JPEG q0.75, EXIF (incl. GPS) stripped, orientation baked in. */
export async function compressImage(file: Blob): Promise<{ bytes: ArrayBuffer; thumb: ArrayBuffer; width: number; height: number }> {
  const d = await decode(file);
  try {
    const full = await canvasJpeg(d.draw, d.w, d.h, MAX_IMAGE_EDGE, 0.75);
    const th = await canvasJpeg(d.draw, d.w, d.h, THUMB_EDGE, 0.6);
    return { bytes: await full.blob.arrayBuffer(), thumb: await th.blob.arrayBuffer(), width: full.w, height: full.h };
  } finally { d.close(); }
}

async function videoMeta(file: Blob): Promise<{ duration: number; poster: ArrayBuffer | null }> {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
    await new Promise<void>((res, rej) => { v.onloadedmetadata = () => res(); v.onerror = () => rej(new Error('video')); setTimeout(res, 4000); });
    const duration = Number.isFinite(v.duration) ? v.duration : 0;
    let poster: ArrayBuffer | null = null;
    try {
      v.currentTime = Math.min(0.5, duration / 2 || 0);
      await new Promise<void>((res) => { v.onseeked = () => res(); setTimeout(res, 1500); });
      if (v.videoWidth) poster = await (await canvasJpeg(v, v.videoWidth, v.videoHeight, THUMB_EDGE, 0.6)).blob.arrayBuffer();
    } catch { /* poster optional */ }
    return { duration, poster };
  } finally { URL.revokeObjectURL(url); }
}

export class MediaError extends Error {}

export async function prepareFile(file: File, opts: { maxVideoMb: number; maxVideoS: number; voice?: boolean; durationS?: number }): Promise<Prepared> {
  const mime = file.type || 'application/octet-stream';
  const name = file.name || 'file';
  if (mime.startsWith('image/')) {
    const c = await compressImage(file);
    return { kind: 'image', mime: 'image/jpeg', ext: 'jpg', bytes: c.bytes, thumb: c.thumb, width: c.width, height: c.height, name };
  }
  if (mime.startsWith('video/')) {
    if (file.size > opts.maxVideoMb * 1024 * 1024) throw new MediaError(`Video is ${(file.size / 1048576).toFixed(0)} MB. The limit is ${opts.maxVideoMb} MB.`);
    const meta = await videoMeta(file);
    if (meta.duration > opts.maxVideoS + 2) throw new MediaError(`Video is ${Math.round(meta.duration)}s long. Keep it under ${opts.maxVideoS}s.`);
    return { kind: 'video', mime, ext: mime.includes('quicktime') ? 'mov' : mime.includes('webm') ? 'webm' : 'mp4', bytes: await file.arrayBuffer(), thumb: meta.poster, durationS: meta.duration, name };
  }
  if (mime.startsWith('audio/')) {
    if (file.size > 25 * 1024 * 1024) throw new MediaError('Audio files must be under 25 MB.');
    return { kind: opts.voice ? 'voice_note' : 'audio', mime, ext: mime.includes('webm') ? 'webm' : mime.includes('mpeg') ? 'mp3' : mime.includes('wav') ? 'wav' : 'm4a', bytes: await file.arrayBuffer(), thumb: null, durationS: opts.durationS, name };
  }
  if (mime === 'application/pdf') {
    if (file.size > 20 * 1024 * 1024) throw new MediaError('PDFs must be under 20 MB.');
    return { kind: 'document', mime, ext: 'pdf', bytes: await file.arrayBuffer(), thumb: null, name };
  }
  throw new MediaError('That file type isn’t supported. Use photos, videos, audio or PDFs.');
}
