// Use Electron's Chromium transport so shared servers follow system certificate
// trust. Keep cookies/cache out of this bearer-only, main-process boundary.
export function sharedNetwork(session: {fetch(input: string, init?: RequestInit): Promise<Response>}) {
 return (url: string, init: RequestInit): Promise<Response> => {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password) throw new Error('Shared transport requires HTTPS');
  return session.fetch(url, {...init, credentials:'omit', redirect:'error', cache:'no-store'});
 };
}
