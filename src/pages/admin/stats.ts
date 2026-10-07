/* Sales analytics for the admin dashboard. Pure functions over the orders the dashboard already loaded (the Worker returns
   the newest 500 paid / mismatch orders), so nothing here needs a new API endpoint. All money is in cents. */
import type { Cfg, Kit } from '../../lib/kit';

export interface AOrder {
  id: string; ref: string; status: string; pay: string; created: Date;
  name: string; email: string; city: string; country: string;
  items: { cfg: Cfg; qty: number; list: number }[]; total: number; listTotal: number;
}

export type RangeKey = 'today' | '7' | '30' | '90' | 'all';
export const RANGES: RangeKey[] = ['today', '7', '30', '90', 'all'];
const DAY = 86400000;

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const valid = (o: AOrder) => !isNaN(o.created.getTime());

/* [from, to) of the selected range and of the period just before it (same length), for the % change badges. */
export function rangeBounds(r: RangeKey, orders: AOrder[], now = new Date()) {
  const end = new Date(startOfDay(now).getTime() + DAY);
  if (r === 'all') {
    const first = orders.filter(valid).reduce((m, o) => Math.min(m, o.created.getTime()), end.getTime() - DAY);
    return { from: startOfDay(new Date(first)), to: end, prevFrom: null as Date | null, prevTo: null as Date | null };
  }
  const days = r === 'today' ? 1 : +r;
  const from = new Date(end.getTime() - days * DAY);
  return { from, to: end, prevFrom: new Date(from.getTime() - days * DAY), prevTo: from };
}
export const inRange = <O extends AOrder>(orders: O[], from: Date, to: Date): O[] => orders.filter((o) => valid(o) && o.created >= from && o.created < to);

/* A kit with both doors is two door stickers. */
export const sheetsOf = (it: { cfg: Cfg; qty: number }) => it.qty * (it.cfg.kit === 'both' ? 2 : 1);
/* Revenue counts what Stripe confirmed (paid). A 'mismatch' order is flagged separately and left out until it is checked. */
const revenueOf = (o: AOrder) => (o.pay === 'paid' ? o.total : 0);

export interface Kpis { revenue: number; orders: number; aov: number; units: number; toPrint: number; issues: number; customers: number }
export function kpis(list: AOrder[]): Kpis {
  const paid = list.filter((o) => o.pay === 'paid');
  const revenue = paid.reduce((s, o) => s + o.total, 0);
  return {
    revenue, orders: list.length, aov: paid.length ? revenue / paid.length : 0,
    units: list.reduce((s, o) => s + o.items.reduce((t, i) => t + sheetsOf(i), 0), 0),
    toPrint: list.filter((o) => o.status === 'new').length,
    issues: list.filter((o) => o.pay === 'mismatch').length,
    customers: new Set(list.map((o) => o.email.toLowerCase()).filter(Boolean)).size,
  };
}
/* % change vs the previous period; null when there is nothing to compare with. */
export const delta = (cur: number, prev: number | undefined) => (prev === undefined || prev === 0 ? null : (cur - prev) / prev);

/* One point per day (or per hour for "today") with revenue and order count. */
export interface Point { key: string; date: Date; revenue: number; orders: number }
export function series(list: AOrder[], from: Date, to: Date, hourly: boolean): Point[] {
  const pts: Point[] = [], idx = new Map<string, Point>();
  if (hourly) {
    for (let h = 0; h < 24; h++) { const p = { key: String(h), date: new Date(from.getTime() + h * 3600000), revenue: 0, orders: 0 }; pts.push(p); idx.set(p.key, p); }
    list.forEach((o) => { const p = idx.get(String(o.created.getHours())); if (p) { p.revenue += revenueOf(o); p.orders++; } });
    return pts;
  }
  // Long ranges are bucketed by week so the chart stays readable (max ~120 points).
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY));
  const step = days > 120 ? 7 : 1;
  for (let t = from.getTime(); t < to.getTime(); t += step * DAY) { const d = new Date(t); const p = { key: dayKey(d), date: d, revenue: 0, orders: 0 }; pts.push(p); idx.set(p.key, p); }
  list.forEach((o) => {
    const i = Math.floor((startOfDay(o.created).getTime() - from.getTime()) / (step * DAY));
    const p = pts[Math.min(pts.length - 1, Math.max(0, i))];
    if (p) { p.revenue += revenueOf(o); p.orders++; }
  });
  return pts;
}

export interface Row { key: string; label: string; value: number; sub?: number; swatch?: string }
const top = (m: Map<string, Row>, n = 10) => [...m.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)).slice(0, n);
function bump(m: Map<string, Row>, key: string, label: string, value: number, sub = 0, swatch?: string) {
  const r = m.get(key) || { key, label, value: 0, sub: 0, swatch }; r.value += value; r.sub = (r.sub || 0) + sub; m.set(key, r);
}

/* Everything the "Sales reports" tab shows. */
export function reports(kit: Kit, list: AOrder[], T: Kit['T']) {
  const designs = new Map<string, Row>(), colours = new Map<string, Row>(), countries = new Map<string, Row>(), cities = new Map<string, Row>();
  const kitType = new Map<string, Row>(), finish = new Map<string, Row>(), model = new Map<string, Row>();
  const weekday = Array.from({ length: 7 }, () => 0), hour = Array.from({ length: 24 }, () => 0);
  let lines = 0, badges = 0;
  list.forEach((o) => {
    const rev = revenueOf(o), share = o.listTotal || 1;
    weekday[(o.created.getDay() + 6) % 7]++; hour[o.created.getHours()]++;
    if (o.country) bump(countries, o.country.toLowerCase(), o.country, 1, rev);
    if (o.city) bump(cities, o.city.toLowerCase() + '|' + o.country.toLowerCase(), o.city + (o.country ? ', ' + o.country : ''), 1, rev);
    o.items.forEach((it) => {
      const c = it.cfg, d = kit.D(c.design), r = Math.round(rev * (it.list * it.qty) / share);
      lines += it.qty; if (c.numberOn && c.number) badges += it.qty;
      bump(designs, c.design, d ? d.name : c.design, it.qty, r);
      if (d && !d.fixed) {
        [c.c1, c.c2].forEach((k) => { const col = kit.COLORS[k]; if (col) bump(colours, k, col.name, it.qty, 0, col.hex); });
      }
      bump(kitType, c.kit, c.kit === 'both' ? T('bothSides') : T('oneSide'), it.qty);
      bump(finish, c.finish, c.finish === 'gloss' ? T('gloss') : T('matte'), it.qty);
      bump(model, c.model, kit.modelName(c.model), it.qty);
    });
  });
  return {
    designs: top(designs), colours: top(colours, 12), countries: top(countries), cities: top(cities, 8),
    kitType: top(kitType), finish: top(finish), model: top(model),
    badgeRate: lines ? badges / lines : 0, lines, weekday, hour,
  };
}

/* Customers grouped by email: orders, spend, first and last order. */
export interface CustomerRow { email: string; name: string; city: string; country: string; orders: number; spent: number; first: Date; last: Date }
export function customers(list: AOrder[]): CustomerRow[] {
  const m = new Map<string, CustomerRow>();
  list.forEach((o) => {
    const k = o.email.toLowerCase(); if (!k) return;
    const c = m.get(k) || { email: o.email, name: o.name, city: o.city, country: o.country, orders: 0, spent: 0, first: o.created, last: o.created };
    c.orders++; c.spent += revenueOf(o);
    if (o.created < c.first) c.first = o.created;
    if (o.created > c.last) { c.last = o.created; c.name = o.name || c.name; c.city = o.city || c.city; c.country = o.country || c.country; }
    m.set(k, c);
  });
  return [...m.values()];
}

/* CSV (Excel-friendly: BOM, CRLF, quoted, formula-injection safe because customer text is untrusted). */
export function toCSV(rows: (string | number)[][]) {
  const cell = (v: string | number) => {
    let s = String(v ?? '');
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
