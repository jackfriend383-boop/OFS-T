import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import { loadProse } from './pages/Prose';
import { langOfPath, pageOfPath } from './lib/kit';
import { initSiteSettings } from './lib/siteSettings';
import './styles/site.css';
import './styles/app.css';

initSiteSettings(); // background pictures chosen in the admin "Edits" tab (CSS variables on <html>; client only)
const root = document.getElementById('root')!;
const app = (
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
      <App />
    </BrowserRouter>
  </StrictMode>
);
// Long text pages (about, privacy, ...) fetch their text first, so the page starts with exactly the prerendered content.
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
const path = location.pathname.startsWith(base) ? location.pathname.slice(base.length) || '/' : location.pathname;
const page = pageOfPath(path);
if (page && ['about', 'privacy', 'terms', 'refunds', 'cookies'].includes(page)) await loadProse(langOfPath(path), page).catch(() => '');
// Prerendered pages are hydrated; the dev server (and any route that wasn't prerendered) renders from scratch.
// (The dev index.html leaves a bare <!--app--> comment in #root, so test for an element, not for any child node.)
// Some hosts answer an address that doesn't exist with the home page's HTML (a "single-page app" fallback, status 200): that markup
// doesn't match this URL's "page not found" view, so it is replaced instead of hydrated.
const prerendered = root.firstElementChild && (page || root.querySelector('[data-view="404"]'));
if (prerendered) hydrateRoot(root, app); else { root.replaceChildren(); createRoot(root).render(app); }
