/**
 * B8: phone numbers are digits plus the usual separators — never letters. Used by every phone input:
 * `phoneInput` strips anything else as you type, `phoneError` is the save-time check.
 */
export const phoneInput = (v: string) => v.replace(/[^\d()+\-. ]/g, '');

export function phoneError(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  if (!s) return null; // optional everywhere
  if (/[^\d()+\-. ]/.test(s)) return 'Use digits only, e.g. (206) 555-0100.';
  const n = s.replace(/\D/g, '').length;
  if (n < 7 || n > 15) return 'Enter a full phone number, e.g. (206) 555-0100.';
  return null;
}
