// Public configuration. The publishable key is public by design (RLS protects data).
export const SUPABASE_URL = 'https://djkinciawtoqlxkpiesq.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_29IrAUCUNA1zdT3qny3c9A_0wV339Ns';
export const STORAGE_BUCKET = 'patrol-media';

export const EMAILJS = {
  serviceId: 'service_49ltt4f',
  templateId: 'template_n369iwa',
  publicKey: 'hF1r9AflJq5A0MSR6',
  endpoint: 'https://api.emailjs.com/api/v1.0/email/send',
} as const;

/**
 * HARD GUARD: client email notifications are disabled in this build. There is no code path
 * that builds a client recipient; notify/emailjs.ts asserts every recipient is an owner email.
 */
export const CLIENT_NOTIFICATIONS_ENABLED = false as const;

export const APP_NAME = 'Lion Patrol';
export const COMPANY_NAME = 'Lion Security Services';
export const PUBLIC_URL = 'https://karimdc5.github.io/Lion-Patrol/';

export const NOTICE_VERSIONS = { gps_notice: 1, audio_notice: 1 } as const;

export const PIN_ITERATIONS = 310_000;
export const AUTO_LOCK_MS = 10 * 60 * 1000;
