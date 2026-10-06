# Legal to-do before launch

The privacy policy, terms of sale, refunds & returns page and cookie policy exist in **two languages**:
Portuguese (`src/content/pt/{privacy,terms,refunds,cookies}.html`, the default version at the site root) and English
(`src/content/en/{privacy,terms,refunds,cookies}.html`, under `/en/`). They are **templates**. They were written for a Portuguese online seller selling to EU consumers, but they are not legal advice
and have not been reviewed by a lawyer. **Have a Portuguese lawyer (or a consumer-law adviser) review them before launch**,
and update the "Last updated" / "Última atualização" date on each page whenever they change. **Every change must be made in
both language versions**, and the lawyer should review the Portuguese text in particular (consumer information for
Portuguese consumers must be available in Portuguese).

## 1. Placeholders to fill in

Search the repo for `[` in the files listed. Every bracketed value must be replaced (or the sentence removed) **in both the
Portuguese and the English page**. In the Portuguese pages the placeholder labels are translated: `[NOME LEGAL]` = `[LEGAL NAME]`,
`[MORADA]` = `[STREET ADDRESS]`, `[CÓDIGO POSTAL]` = `[POSTCODE]`, `[LOCALIDADE]` = `[CITY]`, `[EMAIL DE CONTACTO]` = `[CONTACT EMAIL]`,
`[TELEFONE (opcional)]`, `[DADOS DO REGISTO COMERCIAL, …]`, `[ENCARREGADO DA PROTEÇÃO DE DADOS: …]`, `[FORNECEDOR DE ALOJAMENTO]`,
`[FORNECEDOR DE EMAIL]`, `[NOME DA TRANSPORTADORA]`, `[PRESTADOR DE PAGAMENTOS]`, `[PAGAMENTO: …]`, `[MEIOS DE PAGAMENTO, …]`,
`[FORNECEDOR DE SOFTWARE DE FATURAÇÃO CERTIFICADO]`, `[CONTABILISTA]`, `[PRAZO DE CONSERVAÇÃO]`, `[PAÍSES DE ENTREGA]`,
`[PRAZO DE PRODUÇÃO]`, `[PRAZO DE ENTREGA]`, `[REGIÕES DE ENTREGA]`, `[CUSTOS DE ENVIO]`, `[MORADA DE DEVOLUÇÃO]`, `[NÚMERO]`,
and `[CONFIRM: …]` = `[CONFIRMAR: …]`.

| Placeholder | Where |
|---|---|
| `[LEGAL NAME]` (person's full name or company name) | footer (`src/components/Layout.tsx`), `src/data/site.json` `legalName`, privacy, terms, refunds |
| `[NIF]` | footer, `site.json` `nif`, privacy, terms |
| `[STREET ADDRESS]`, `[POSTCODE]`, `[CITY]` | footer, `site.json` `address`, privacy, terms, refunds |
| `[CONTACT EMAIL]` | footer, `site.json` `email`, privacy, terms, refunds |
| `[PHONE (optional)]` | `site.json` `phone`, terms (remove if not used) |
| `[SECURITY CONTACT EMAIL]` / `[security contact email]`, `[N]` working days | `site.json` `securityEmail`, `SECURITY.md` |
| `[COMMERCIAL REGISTRY DETAILS, if a company.]` | terms §1 |
| `[DATA PROTECTION OFFICER: …]` | privacy §1 (a DPO is normally not required for a small shop; say "not appointed" or remove) |
| `[HOSTING PROVIDER, e.g. GitHub, Inc. (GitHub Pages)]`, `[HOSTING PROVIDER]` | privacy §2 and §4, cookies §5 |
| `[EMAIL PROVIDER]` | privacy §4 |
| `[CARRIER NAME]` | privacy §4 |
| `[PAYMENT PROVIDER]`, `[PAYMENT: …]` | privacy §2 and §4 |
| `[PAYMENT METHODS, …]` | terms §6 |
| `[CERTIFIED INVOICING SOFTWARE PROVIDER]`, `[ACCOUNTANT]` | privacy §4 |
| `[CONFIRM: … international transfers …]` | privacy §5 (GitHub Pages is a US provider, so a transfer note is likely needed while hosted there) |
| `[RETENTION PERIOD]`, `[RETENTION PERIOD, e.g. 2 years]` | privacy §6 |
| `[DELIVERY COUNTRIES]`, `[CONFIRM: in case of any discrepancy, the Portuguese version prevails]` | terms §2 (both versions now exist; decide which prevails) |
| `[CONFIRM: or when payment is taken]` | terms §4 |
| `[CONFIRM VAT regime …]` | terms §5 (normal IVA, art. 53 CIVA exemption, OSS for B2C sales to other EU countries) |
| `[PRODUCTION TIME]`, `[DELIVERY TIME]`, `[DELIVERY REGIONS]`, `[SHIPPING COSTS]` | terms §7 |
| `[CONFIRM the competent RAL entity …]` | terms §14 (the regional arbitration centre for the seller's area, or CNIACC; Law 144/2015 requires naming it) |
| `[CONFIRM whether any EU ODR reference is still required.]` | terms §14 and the ODR note in the footer (the ODR platform closed in July 2025 under Regulation (EU) 2024/3228) |
| `[RETURN ADDRESS]` | refunds §4 |
| `[CONFIRM: You pay the direct cost of returning the kit / We pay the return postage.]` | refunds §4 |
| `[NUMBER]` days (damaged in transit) | refunds §7 |
| `[CONFIRM: the host sets no cookies on this site.]` | cookies §5 |
| `SITE_URL` (`https://YOUR-USERNAME.github.io/...`) | `src/data/site.json` |
| Order database: name **Supabase, Inc.** as processor (orders: name, email, address, country, consent flags; EU region e.g. Frankfurt; DPA accepted), plus retention and any transfer note | privacy §2, §4, §5, §6 (once `SUPABASE-SETUP.md` is done) |

Note: the footer `<address>` is filled in by `src/seo.ts` from `src/data/site.json` (`legalName`, `nif`, `address`,
`email`) for both languages, so fill those in once there. While a value is still a `[PLACEHOLDER]`, the Portuguese pages show
the translated label (mapping in `src/i18n/pt.json`, `placeholders`). The legal pages themselves are plain text: fill them by
hand in both languages.

## 2. Decisions for the owner / lawyer

- **Which kits are "personalised"** (no 14-day withdrawal, DL 24/2014 art. 17(1)(c)). The refunds page currently says:
  standard = default colours, any finish, one or both sides, no badge text; personalised = custom badge text, a colour
  combination that differs from the design's default, or a custom design. Confirm this is defensible, and make sure the
  configurator / cart / checkout tell the buyer **before ordering** that a personalised kit cannot be returned for a change of mind
  (pre-contractual information, DL 24/2014 art. 4(1)(l)).
- Consent wording on the checkout (acceptance of the terms, acknowledgement of the privacy policy, and loss of the withdrawal right for personalised kits).
- Checkout with the order backend on: the order is submitted with "Place order" and payment is confirmed later by email
  ("No payment is taken online"). Confirm with the lawyer when the contract is concluded and whether the button must read
  "Place order with obligation to pay" (terms §4 `[CONFIRM: or when payment is taken]`).
- Order confirmation email must contain the contract details and these terms on a durable medium (DL 24/2014 art. 6).
- Invoicing through certified software (Portuguese requirement) and the invoice retention period.
- Portuguese versions of the legal pages now exist (translated from the English templates, not reviewed). Have the lawyer
  review the Portuguese text, and confirm which version prevails (terms §2).
- Electronic Livro de Reclamações: register the business at livroreclamacoes.pt.

## 3. Product claims removed from the public site (re-add only once verified)

These claims were removed or softened in `src/content/en/{home,about}.html` because there was no evidence for them (the
Portuguese versions in `src/content/pt/` follow the same wording; re-add a claim in both languages).
They are also still present in files owned by other parts of the build (see the security/legal report):
`src/pages/Configurator.tsx / src/content.ts`, `src/components/Cart.tsx` (cart "Shipping (EU) Free") and `src/seo.ts` (page descriptions, `llms.txt`).

| Removed claim | Was in | Replaced with |
|---|---|---|
| "80 µm cast" / "Cast, 80 µm, air-release adhesive" | home specs strip, configurator specs, llms.txt | "Outdoor vinyl" (needs the supplier's vinyl data sheet to restore) |
| "7 years" outdoor life / "rated for about 7 years" | home specs strip, llms.txt | "Matte or gloss" finish |
| "~30 min / side" fitting time; "About an hour per side for a first-timer" | home specs strip, about FAQ | "Pre-cut" / "At home"; FAQ now says it depends on experience |
| "No residue" / "Peels clean" / "peel off without residue" | home specs strip, about values, llms.txt | "Made to come off when you fancy a change" |
| "release cleanly for up to seven years" / "Will it damage the paint or plastic? No." | about FAQ | "Can I remove it later?" with neutral removal advice |
| "Cut to order in two weeks or less" | about values | "Made to order: printed and cut for each order" |
| "Custom work takes about three weeks" | about FAQ | quote includes production time |
| "Delivery in 5–10 days" | configurator summary | (to be replaced, see report) |
| "Free shipping (EU)" / "free EU shipping" / cart "Shipping (EU) Free" | configurator, shop meta description, llms.txt, core.js cart | (to be replaced, see report) |
| Opel Rocks-e (2021 →) and Fiat Topolino (2023 →) fitment | home fitment list, about FAQ, about meta description, llms.txt | "Cut for the Citroën Ami"; FAQ "contact us before ordering for other models" |
| "No heat gun needed on flat panels" | home "How it works" | "with a step-by-step fitting guide" |
| "Brush washes are fine after 48 hours; pressure washer 30 cm" | about FAQ | general vinyl care advice + refer to the fitting guide |
| Kit contents: "felt squeegee", "included wipe", "hinge tape" | home, about FAQ, configurator "Includes" | home/about now mention only the fitting guide; confirm what is really in the box |

No customer reviews, ratings or testimonials exist on the site (checked). If any are added, they must be genuine and
the site must say how it checks that reviews come from real buyers (Omnibus Directive / DL 109-G/2021).
