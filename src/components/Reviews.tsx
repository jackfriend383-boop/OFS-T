/* Customer reviews the owner added in the admin "Reviews" tab. Shown on the home page (below "Popular designs", beside the community
   box) and in the configurator (below the order summary). Renders nothing when there are no reviews. Each card is a button: it opens
   a dialog with the whole review (stars, name, full comment and the photo). */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import type { Review } from '../lib/reviews';

const TXT = {
  en: { eyebrow: 'Reviews', title: 'What our customers say', of: (n: number) => `${n} out of 5 stars`, open: (n: string) => `Open the review by ${n}`, close: 'Close' },
  pt: { eyebrow: 'Opiniões', title: 'O que dizem os nossos clientes', of: (n: number) => `${n} em 5 estrelas`, open: (n: string) => `Abrir a opinião de ${n}`, close: 'Fechar' },
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

function ReviewDialog({ review, onClose, t }: { review: Review | null; onClose: () => void; t: (typeof TXT)['en'] }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (review && !d.open) { try { d.showModal(); } catch { d.setAttribute('open', ''); } }
    if (!review && d.open) d.close();
  }, [review]);
  return (
    <dialog ref={ref} className="rv-dialog" aria-label={review ? review.name : undefined} onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      {review && (
        <div className="rv-modal">
          <button type="button" className="rv-x" aria-label={t.close} onClick={() => ref.current?.close()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
          {review.photo && <img className="rv-full" src={review.photo} alt="" />}
          <Stars value={review.rating} label={t.of(review.rating)} />
          <p className="rv-full-text">{review.comment}</p>
          <p className="rv-name">{review.name}</p>
        </div>
      )}
    </dialog>
  );
}

export default function Reviews({ id = 'reviews' }: { id?: string }) {
  const { reviews, lang } = useApp();
  const t = TXT[lang === 'pt' ? 'pt' : 'en'];
  const [open, setOpen] = useState<Review | null>(null);
  if (!reviews.length) return null;
  return (
    <section className="section reviews" id={id} aria-labelledby={id + 'Title'}>
      <div className="sec-head"><div><span className="eyebrow">{t.eyebrow}</span><h2 className="display" id={id + 'Title'}>{t.title}</h2></div></div>
      <ul className="rv-grid">
        {reviews.map((r) => (
          <li className="rv-card" key={r.id}>
            <button type="button" className="rv-btn" aria-label={t.open(r.name)} onClick={() => setOpen(r)}>
              <figure className="rv-fig">
                {r.photo && <img className="rv-photo" src={r.photo} alt="" loading="lazy" decoding="async" />}
                <Stars value={r.rating} label={t.of(r.rating)} />
                <blockquote className="rv-text">{r.comment}</blockquote>
                <figcaption className="rv-name">{r.name}</figcaption>
              </figure>
            </button>
          </li>
        ))}
      </ul>
      <ReviewDialog review={open} onClose={() => setOpen(null)} t={t} />
    </section>
  );
}
