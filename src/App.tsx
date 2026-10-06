import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { AppProvider, useApp } from './state';
import { Layout } from './components/Layout';
import { COPY } from './content';
import { langOfPath, pageOfPath, type PageKey } from './lib/kit';
import { applyHead, type SeoKey } from './seo';
import Home from './pages/Home';
import Shop from './pages/Shop';
import Configurator from './pages/Configurator';
import Prose from './pages/Prose';

const Admin = lazy(() => import('./pages/Admin'));

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

/* The admin page is browser-only (sessions, downloads) and lazy-loaded: the server renders just its frame. */
function ClientOnly({ children }: { children: React.ReactNode }) {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(true), []);
  const frame = <section className="view adm" data-view="admin"><p className="adm-empty">…</p></section>;
  return on ? <Suspense fallback={frame}>{children}</Suspense> : frame;
}

function Page({ page }: { page: PageKey | null }) {
  switch (page) {
    case 'home': return <Home />;
    case 'shop': return <Shop />;
    case 'configurator': return <Configurator />;
    case 'about': case 'privacy': case 'terms': case 'refunds': case 'cookies': return <Prose page={page} />;
    case 'admin': return <ClientOnly><Admin /></ClientOnly>;
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
