/* Theme preload: runs synchronously in <head> before the stylesheet so a saved light/dark choice applies without a flash. Light is the default; only a saved 'dark' changes the look. */
try { var t = localStorage.getItem('ofst-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.ofst = t; } catch (e) {}
/* Slower devices (4 processor cores or fewer, or 4 GB of memory or less): html.lite turns off a few costly effects (CSS blur, see site.css). */
try { var n = navigator, c = n.hardwareConcurrency, m = n.deviceMemory; if ((c && c <= 4) || (m && m <= 4)) document.documentElement.classList.add('lite'); } catch (e) {}
