/* Social links and the "show your Ami" call to action. The three profile addresses live in src/data/site.json ("social": instagram,
   tiktok, facebook, hashtag): leave one empty and its icon is simply not shown. */
import SITE from '../data/site.json';
import { useApp } from '../state';

type Net = 'instagram' | 'tiktok' | 'facebook';
const SOCIAL = (SITE as any).social || {};
const HASHTAG: string = String(SOCIAL.hashtag || 'OFSTAmi').replace(/[^A-Za-z0-9_]/g, '');
const safe = (u: unknown) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u.trim()) ? u.trim() : '');
export const NETS = (['instagram', 'tiktok', 'facebook'] as Net[]).map((n) => ({ n, url: safe(SOCIAL[n]) })).filter((x) => x.url);

const NAME: Record<Net, string> = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' };
const ICON: Record<Net, string> = {
  instagram: 'M7.5 3h9A4.5 4.5 0 0 1 21 7.5v9a4.5 4.5 0 0 1-4.5 4.5h-9A4.5 4.5 0 0 1 3 16.5v-9A4.5 4.5 0 0 1 7.5 3Zm4.5 5.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Zm5.1-1.6a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z',
  tiktok: 'M14 3v11.2a3.2 3.2 0 1 1-3.2-3.2M14 3c.3 2.4 1.9 4.2 4.5 4.4',
  facebook: 'M14.5 21v-8h2.7l.5-3.2h-3.2V7.9c0-.9.4-1.6 1.7-1.6h1.6V3.4c-.3 0-1.3-.2-2.4-.2-2.5 0-4.1 1.5-4.1 4.2v2.4H8.5V13h2.8v8',
};

export function SocialLinks({ label }: { label?: string }) {
  if (!NETS.length) return null;
  return (
    <ul className="social" role="list" aria-label={label}>
      {NETS.map(({ n, url }) => (
        <li key={n}>
          <a href={url} target="_blank" rel="noopener noreferrer" aria-label={NAME[n]}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={ICON[n]} /></svg>
          </a>
        </li>
      ))}
    </ul>
  );
}

const TXT = {
  en: {
    eyebrow: 'Community', title: 'Show us your Ami',
    lead: 'Fitted your kit? Post a photo or video of your car on Instagram, TikTok or Facebook, tag us and use the hashtag below. We share our favourites on our pages, and the best ones may appear on this site next to the reviews.',
    steps: ['Fit your kit and take a photo of your Ami', 'Post it and tag us', 'Use the hashtag so we can find you'], follow: 'Follow us',
  },
  pt: {
    eyebrow: 'Comunidade', title: 'Mostra-nos o teu Ami',
    lead: 'Já aplicaste o teu kit? Publica uma foto ou vídeo do teu carro no Instagram, TikTok ou Facebook, marca-nos e usa a hashtag abaixo. Partilhamos os nossos favoritos nas redes e os melhores podem aparecer aqui no site, junto das opiniões.',
    steps: ['Aplica o kit e tira uma foto ao teu Ami', 'Publica e marca-nos', 'Usa a hashtag para te encontrarmos'], follow: 'Segue-nos',
  },
};

export default function Community({ id = 'community' }: { id?: string }) {
  const { lang } = useApp();
  const t = TXT[lang === 'pt' ? 'pt' : 'en'];
  return (
    <section className="section community" id={id} aria-labelledby={id + 'Title'}>
      <div className="sec-head"><div><span className="eyebrow">{t.eyebrow}</span><h2 className="display" id={id + 'Title'}>{t.title}</h2></div></div>
      <p className="muted cm-lead">{t.lead}</p>
      <ol className="cm-steps">{t.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      <p className="cm-tag"><span className="chip">#{HASHTAG}</span></p>
      <SocialLinks label={t.follow} />
    </section>
  );
}
