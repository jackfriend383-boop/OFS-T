import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { AppProvider, useApp } from './state';
import { Layout } from './components/Layout';
import { COPY } from './content';
import { langOfPath, pageOfPath, type PageKey } from './lib/kit';
import { applyHead, type SeoKey } from './seo';
import Home from './pages/Home';
import Shop from './pages/Shop';
import Configurator from './pages/Configurator';
import Prose, { loadProse } from './pages/Prose';
import Order from './pages/Order';
import Account from './pages/Account';

function NotFound() {
  const { lang, to } = useApp();
  const c = COPY[lang].notFound;
  return (
    <section className="view" data-view="404">
      <div className="page-head">
        <span className="eyebrow">{c.eyebrow}</span>
        <h1 className="display">{c.h1}</h1>
        <p className="muted" style={{ margin: 0, maxWidth: '56ch' }}>{c.text}</p>
        {c.other && <p className="muted" lang="en" style={{ margin: 0, maxWidth: '56ch' }}>{c.other[0]} <Link to="/en/" style={{ textDecoration: 'underline' }}>{c.other[1]}</Link>.</p>}
        <div className="hero-cta">
          <Link className="btn btn-primary" to={to('shop')}>{c.browse}</Link>
          <Link className="btn btn-ghost" to={to('home')}>{c.home}</Link>
        </div>
      </div>
    </section>
  );
}


function Page({ page }: { page: PageKey | null }) {
  switch (page) {
    case 'home': return <Home />;
    case 'shop': return <Shop />;
    case 'configurator': return <Configurator />;
    case 'about': case 'privacy': case 'terms': case 'refunds': case 'cookies': return <Prose page={page} />;
    case 'order': return <Order />;
    case 'account': return <Account />;
    default: return <NotFound />;
  }
}

/* Keeps <head> in step with the route on client-side navigation (the first load already has it from the prerendered HTML). */
function HeadSync({ seo }: { seo: SeoKey }) {
  const { lang } = useApp();
  const first = useRef(true);
  useEffect(() => {
    // The first load of a prerendered page already has its head; the dev server (no prerender) needs it added.
    if (first.current) { first.current = false; if (document.head.querySelector('[data-h]')) return; }
    // The about page's head lists its FAQ, which lives in the page text: fetch that first (it is a separate file).
    if (seo === 'about') { let live = true; loadProse(lang, seo).catch(() => '').then(() => { if (live) applyHead(seo, lang); }); return () => { live = false; }; }
    applyHead(seo, lang);
  }, [seo, lang]);
  return null;
}

export default function App() {
  const { pathname } = useLocation();
  const page = pageOfPath(pathname);
  return (
    <AppProvider>
      <HeadSync seo={page ?? '404'} />
      <Layout><Page page={page} key={pathname} /></Layout>
    </AppProvider>
  );
}
export { langOfPath };
