/* Short FAQ next to the buying decision (home page and configurator): the questions people ask before they pay. The fuller list stays on
   the "About" page. Answers follow the terms of sale and the sales & returns policy. */
import { Link } from 'react-router';
import { useApp } from '../state';

const QA = {
  pt: {
    eyebrow: 'Perguntas frequentes', title: 'Antes de encomendares', more: 'Ver todas as perguntas',
    items: [
      ['Para onde entregam?', 'Por agora a pré-venda é exclusiva para a ilha de São Miguel (Açores), com entrega pessoal e sem custos de envio. Se vives noutra zona, deixa o teu email na lista de espera e avisamos-te quando chegarmos aí.'],
      ['Quanto tempo demora?', 'Entre 14 e 21 dias depois de o pagamento estar confirmado. Nos drops, o prazo conta a partir do fecho da janela de encomenda. Se algo mudar, avisamos-te logo.'],
      ['Serve no meu Ami?', 'Os kits são cortados à medida do Citroën Ami, versões 2025 e OG, e seguem as zonas de autocolante de origem. Se o teu carro tiver painéis que não são de origem, fala connosco antes de encomendar.'],
      ['Descola sem estragar a pintura?', 'O vinil de exterior foi feito para ser removível: aquece-o com um secador e descola devagar, num ângulo baixo. Experimenta primeiro num canto. Não aplicamos em superfícies repintadas ou com verniz danificado sem te avisar do risco.'],
      ['Como aplico? Posso pedir ajuda?', 'Cada kit inclui um guia de aplicação passo a passo, só precisas de um pulverizador e de uma espátula. Se preferires, podes pedir o nosso serviço de aplicação: contacta-nos.'],
      ['Posso lavar o carro?', 'Sim. Prefere a lavagem à mão, espera o tempo de cura indicado no guia antes da primeira lavagem e nunca apontes o jato de alta pressão às bordas do autocolante.'],
      ['E se não gostar? E se vier com defeito?', 'Tens 14 dias para desistir de designs de catálogo, desde que o kit esteja sem uso e na embalagem. Os pedidos personalizados não têm desistência. Inspecionamos cada kit antes de o entregar; se vier com defeito, avisa-nos antes de o aplicar. Depois de aplicado, não nos responsabilizamos por maus tratos.'],
    ],
  },
  en: {
    eyebrow: 'FAQ', title: 'Before you order', more: 'See all questions',
    items: [
      ['Where do you deliver?', 'For now the pre-sale is exclusive to the island of São Miguel (Azores), with personal delivery and no shipping cost. If you live somewhere else, join the waiting list and we will tell you when we reach you.'],
      ['How long does it take?', 'Between 14 and 21 days after payment is confirmed. For drops, the time counts from the close of the order window. If anything changes, we tell you straight away.'],
      ['Will it fit my Ami?', 'Kits are cut to fit the Citroën Ami, 2025 and OG versions, following the original sticker zones. If your car has non-original panels, talk to us before ordering.'],
      ['Will it come off without damaging the paint?', 'The outdoor vinyl is made to be removable: warm it with a hair dryer and peel slowly at a low angle. Try a corner first. We do not fit onto repainted or damaged-lacquer surfaces without telling you about the risk.'],
      ['How do I fit it? Can I get help?', 'Every kit includes a step-by-step fitting guide; you only need a spray bottle and a squeegee. If you prefer, you can ask for our fitting service: contact us.'],
      ['Can I wash the car?', 'Yes. Hand washing is best, wait for the curing time in the guide before the first wash, and never aim a pressure washer at the sticker edges.'],
      ['What if I do not like it? What if it is faulty?', 'You have 14 days to withdraw from catalogue designs, as long as the kit is unused and in its packaging. Custom orders cannot be withdrawn. We inspect every kit before handing it over; if it arrives faulty, tell us before fitting it. Once fitted, we are not responsible for mistreatment.'],
    ],
  },
};

export default function Faq({ id = 'buyFaq' }: { id?: string }) {
  const { lang, to } = useApp();
  const t = QA[lang === 'pt' ? 'pt' : 'en'];
  return (
    <section className="section" id={id} aria-labelledby={id + 'Title'}>
      <div className="sec-head"><div><span className="eyebrow">{t.eyebrow}</span><h2 className="display" id={id + 'Title'}>{t.title}</h2></div></div>
      <div className="faq">
        {t.items.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
      </div>
      <p><Link className="btn btn-ghost" to={to('about') + '#faq'}>{t.more}</Link></p>
    </section>
  );
}
