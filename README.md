# S&F Scrapbook Missing Items (Chrome Extension)

Chrome extension (Manifest V3), která v Shakes & Fidget sbírá data ze síťových odpovědí a ukazuje, které itemy hráče ještě nemáš v scrapbooku.

## Co umí

- načte tvůj scrapbook (owned item IDs) z živých odpovědí hry
- načte itemy hráčů při prohlížení Hall of Fame / profilů
- porovná itemy a ukáže počet chybějících kusů
- umožní zkopírovat seznam chybějících item ID
- overlay lze přetáhnout myší a pozice se uloží

## Instalace

1. Otevři `chrome://extensions/`
2. Zapni **Developer mode**
3. Klikni **Load unpacked**
4. Vyber tuto složku (`sf-scrapbook`)

## Použití

1. Přihlas se do S&F.
2. Otevři scrapbook (aby extension chytil tvé owned itemy).
3. Otevři Hall of Fame a rozklikávej hráče.
4. Vpravo nahoře se zobrazí overlay s počtem chybějících itemů.

## Poznámka

Formát interních API odpovědí se mezi servery/verzemi může lišit. Parser je záměrně heuristický (hledá relevantní pole podle názvu a struktury dat), aby fungoval i po updatech hry.
