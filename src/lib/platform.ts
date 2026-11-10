export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
}
export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
export function shouldShowInstallGuide(): boolean {
  if (isStandalone()) return false;
  if (localStorage.getItem('lp-a2hs-dismissed') === '1') return false;
  return isIOS();
}
