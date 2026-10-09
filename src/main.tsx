import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import { loadProse } from './pages/Prose';
import { langOfPath, pageOfPath } from './lib/kit';
import './styles/site.css';
import './styles/app.css';

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
if (root.firstElementChild) hydrateRoot(root, app); else createRoot(root).render(app);
