import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
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
// Prerendered pages are hydrated; the dev server (and any route that wasn't prerendered) renders from scratch.
if (root.hasChildNodes()) hydrateRoot(root, app); else createRoot(root).render(app);
