/* Shop: category filter buttons over the pre-rendered design grid. Card clicks are handled in core.js. */
(() => {
'use strict';
const O = window.OFST;
if(!O || !O.filters) return;
O.filters(O.$('#shopTabs'), c => O.filterCards('#shopGrid .dcard', c));
})();
