/* Outline pictures of the designs the owner uploaded in the admin "Designs" tab (blob: addresses, since the page may only load images
   from itself, data: and blob:). Designs without one use the default outline in /assets/img/design-outline.svg. */
const MAP = new Map<string, string>();
export const registerOutline = (id: string, url: string) => { MAP.set(id, url); };
export const outlineUrl = (id: string): string => MAP.get(id) || ((import.meta as any).env?.BASE_URL || '/') + 'assets/img/design-outline.svg';
export const DEFAULT_FRAME = '#a9d4f5';
