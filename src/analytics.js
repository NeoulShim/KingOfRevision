// Public site identifier, supplied by Cloudflare Web Analytics (not an API credential).
const SITE_TOKEN = '46fad0ec45c24702af8b85af375aa8db';

export function installAnalytics(token, win = window, doc = document) {
  if (!/^[a-f0-9]{32}$/i.test(token)) return false;
  if (win.location.hostname !== 'neoulshim.github.io' ||
      !/^\/KingOfRevision(?:\/|$)/.test(win.location.pathname)) return false;
  if (doc.getElementById('cloudflare-web-analytics')) return false;
  const script = doc.createElement('script');
  script.id = 'cloudflare-web-analytics';
  script.type = 'module';
  script.defer = true;
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  // Count page loads only. Manuscripts, filenames, choices and editor values are never passed in.
  script.setAttribute('data-cf-beacon', JSON.stringify({ token, spa: false }));
  doc.head.appendChild(script);
  return true;
}

if (typeof window !== 'undefined') installAnalytics(SITE_TOKEN);

