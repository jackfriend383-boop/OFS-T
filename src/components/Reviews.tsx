/* Customer reviews the owner added in the admin "Reviews" tab. Shown on the home page (above "How it works") and in the configurator
   (below the order summary). Renders nothing when there are no reviews. */
import { useApp } from '../state';

const TXT = {
  en: { eyebrow: 'Reviews', title: 'What our customers say', of: (n: number) => `${n} out of 5 stars` },
  pt: { eyebrow: 'Opiniões', title: 'O que dizem os nossos clientes', of: (n: number) => `${n} em 5 estrelas` },
};

const STAR = 'm12 2.8 2.9 6 6.5.9-4.7 4.6 1.1 6.5L12 17.7l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z';

export function Stars({ value, label }: { value: number; label: string }) {
  return (
    <span className="rv-stars" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} viewBox="0 0 24 24" className={i <= value ? 'on' : ''} aria-hidden="true" focusable="false"><path d={STAR} /></svg>
      ))}
    </span>
  );
}

export default function Reviews({ id = 'reviews' }: { id?: string }) {
  const { reviews, lang } = useApp();
  const t = TXT[lang === 'pt' ? 'pt' : 'en'];
  if (!reviews.length) return null;
  return (
    <section className="section reviews" id={id} aria-labelledby={id + 'Title'}>
      <div className="sec-head"><div><span className="eyebrow">{t.eyebrow}</span><h2 className="display" id={id + 'Title'}>{t.title}</h2></div></div>
      <ul className="rv-grid">
        {reviews.map((r) => (
          <li className="rv-card" key={r.id}>
            <figure className="rv-fig">
              {r.photo && <img className="rv-photo" src={r.photo} alt="" loading="lazy" decoding="async" />}
              <Stars value={r.rating} label={t.of(r.rating)} />
              <blockquote className="rv-text">{r.comment}</blockquote>
              <figcaption className="rv-name">{r.name}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
