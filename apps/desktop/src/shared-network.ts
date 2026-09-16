// Use Electron's Chromium transport so shared servers follow system certificate
// trust. Keep cookies/cache out of this bearer-only, main-process boundary.
// The backend's Node-only TS lib omits Chromium's RequestInit.cache field.
// Describe it explicitly without weakening the enforced no-store policy.
type SharedRequestInit = RequestInit & {
 cache?: 'default' | 'force-cache' | 'no-cache' | 'no-store' | 'only-if-cached' | 'reload';
};
export function sharedNetwork(session: {fetch(input: string, init?: SharedRequestInit): Promise<Response>}) {
 return (url: string, init: SharedRequestInit): Promise<Response> => {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password) throw new Error('Shared transport requires HTTPS');
  return session.fetch(url, {...init, credentials:'omit', redirect:'error', cache:'no-store'});
 };
}
