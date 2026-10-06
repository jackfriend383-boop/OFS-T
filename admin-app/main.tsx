/* Entry point of the admin dashboard (admin.ofstdesigns.com). Only the orders page lives here; /en/ shows it in English. */
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link } from 'react-router';
import { AppProvider, useApp } from '../src/state';
import Admin from '../src/pages/Admin';
import { I18N } from '../src/lib/kit';
import '../src/styles/site.css';
import '../src/styles/app.css';

function Shell() {
  const { lang } = useApp();
  useEffect(() => {
    document.documentElement.lang = I18N[lang].hreflang;
    document.title = String(I18N[lang].pages.admin.title).replace('{brand}', 'OFS/T');
  }, [lang]);
  return (
    <div className="shell">
      <header className="top" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="brand"><img src="/assets/img/OFST-icon-white.svg" alt="" width="34" height="34" /><span>OFS/T</span></span>
        <nav aria-label="Language">
          <Link to="/" aria-current={lang === 'pt' ? 'true' : undefined}>PT</Link>{' · '}<Link to="/en/" aria-current={lang === 'en' ? 'true' : undefined}>EN</Link>
        </nav>
      </header>
      <main id="main" tabIndex={-1}><Admin /></main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider><Shell /></AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
