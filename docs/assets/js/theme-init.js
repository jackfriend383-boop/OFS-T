/* Theme preload: runs synchronously in <head> before the stylesheet so a saved light/dark choice applies without a flash. */
try { var t = localStorage.getItem('ofst-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.ofst = t; } catch (e) {}
