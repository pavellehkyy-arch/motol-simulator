# Motol Simulator – pravidla pro Clauda

3D simulátor dráhové cyklistiky na Velodromu Praha-Motol. Celá hra je v jednom souboru `index.html` (cca 3 700 řádků, 800 kB, Three.js z CDN). Soubor `stara/index.html` je stará verze, ignoruj ji.

## Online účty a žebříček (Supabase)

- Celé napojení je v samostatném souboru `online.js` (bez knihoven, volá Supabase přes `fetch`). Hra ho načítá přes `<script src="online.js" defer>`. Když selže, hra běží dál jen lokálně.
- Zásahy do `index.html` jsou jen pět: načtení skriptu, hák `Online.report(...)` v `startCeremony` (po výpočtu `me`), větev `Online.buy(id)` na začátku `buyItem`, výjimka `#onlineOv` v globálním click-handleru, který jinak odostřuje (blur) každé aktivní pole a nedal by psát do okna přihlášení, a `Online.board(el)` v `tvTab` (televize na ploše přepíná Výsledky závodu / Žebříček).
- Server (projekt `maiswaiilplgvewuurux`, Frankfurt): tabulky `profiles`, `results`, `purchases`, `shop_items` se zapnutým RLS. Hráč do nich nezapisuje přímo, jen přes funkce `set_nickname`, `submit_result`, `buy_item`, `import_local_progress`, `get_leaderboard`. Odměnu za závod počítá hra, server ji omezí (max 400 za závod, 5000 za 24 h).
- Přezdívky čekají na schválení majitelem (`profiles.nickname_status`), výsledky jde skrýt (`results.hidden`).
- Obchod: `shop_items` má jen `disc_f` (Přední disk) a `disc_r` (Zadní disk), 1000 penízků, každý +20 W. Ve hře `SHOP_ITEMS` (pole `w` = watty) a `applyGear()` vymění hrdinovi kolo (výplet ↔ disk) a nastaví `player.gearW`. `online.js` po změně koupených věcí volá `window.renderShop` (ten volá i `applyGear`).
- Zlatá třpytivá přezdívka v žebříčku: `profiles.badge = 'gold'` (nastavuje jen majitel v SQL, `get_leaderboard` ho vrací, `online.js` přidá třídu `gold`).
- Testy: `node --test tests/online.test.js tests/online-ui.test.js` (atrapa serveru, bez sítě).
- Účty fungují přes e-mail s kódem. Klíč v `online.js` je veřejný (publishable). Tajné klíče do repozitáře nikdy nepatří.

## Pravidla pro šetření tokeny

- **Nikdy nečti celý `index.html`.** Je příliš velký. Hledej přes Grep a čti jen úseky (Read s offset a limit).
- Kód je rozdělený komentáři `// ---------- název ----------`. Podle nich najdeš sekci: renderer, geometrie dráhy, hala, válce, jezdci a kola, týmové dresy, anatomie jezdců, rozhodčí, soupiska, stav, audio, vstup, simulace, závodní AI, kontakty, vylučovačka, madison, vysílačka trenéra, režimy (KILOMETR, KEIRIN, BODOVAČKA, VYLUČOVAČKA, MADISON, SCRATCH).
- Rozsáhlé průzkumy kódu a hledání delegují agenti, ať se do hlavní konverzace vrací jen shrnutí.
- Jedno sezení = jeden úkol. Mezi nezávislými úkoly doporuč uživateli `/clear`.
- Před velkou změnou nejdřív navrhni plán a nech ho schválit, ať se zbytečně nepřepisuje.
- Do odpovědí nevkládej dlouhé kusy kódu, jen přesné změny s čísly řádků.

## Mapa `index.html` (orientační čísla řádků, ověř přes Grep komentáře)

Hlavní skript je na řádcích cca 292–3723. Před ním je CSS (32–178) a načítací obrazovka (189–290).

| Řádky | Obsah |
|---|---|
| 300 | renderer, kamera, `appSize`, `resize` |
| 331–500 | geometrie dráhy (153,846 m, klopení), textury dráhy, mantinel, síť |
| 501–754 | hala (oblouky, střecha, světla), schodiště, válce na trénink |
| 755–975 | jezdci, kola, kola/ráfky, týmové dresy |
| 973–1513 | anatomie jezdců (lofty `loftGeo`, `riderGeos`), vlk (Vojck), boty, posturální pozice; stojící lidé `makeHuman` (rozhodčí, startér, nosiči, záchranáři `makeMedic`, hrdina na ploše) dnes staví `makeScanHuman` (Albiho naměřené tělo `PHOTO_MODEL` jako šablona, oblečení obarvené po oblastech, bunda může mít texturu; přepínač `SCAN_BODIES`, `o.loft` vrátí starší lofty z `humanGeos()`); Albi sám je `makePhotoHuman` (fotosken) |
| 1514–1690 | rozhodčí |
| 1691–1790 | soupiska jezdců, stav hry |
| 1792–1904 | audio (WebAudio), vstup (dotyk, posuvník) |
| 1905–2147 | simulace, závodní AI, mozek balíku (skupiny, útoky, stamina) |
| 2148–2354 | kontakty (pády, loktování, zaháknutí kol) |
| ~2369 | obchod (bílý stolek z infieldu u protilehlé rovinky – jen cíl pro ťuknutí a ikona, rozhlížení na vyhlášení `cerYaw`, panel `#shop`, `SHOP_ITEMS`) |
| 2355–2523 | trenér „Starej šéf“, pivní plechovky, loket |
| 2524–2708 | vylučovačka, madison |
| 2709–3078 | high five, startér, házení v madisonu, záchranka, chodníčky na infieldu, závěrečné titulky |
| 3079–3413 | vysílačka trenéra, statistiky závodu |
| 3414–3683 | intro startu, KEIRIN, BODOVAČKA, pozadí menu |
| 3684–3722 | herní smyčka |

Sprint (~3739) má i blok `sprint: "nasávání" in the hook` (`hookSling`, `spComeRound`, `spWarn`). Režimy mají vlastní bloky `// -------- KILOMETR / KEIRIN / BODOVAČKA / VYLUČOVAČKA / MADISON / SCRATCH --------` (kolem řádků 3130–3260).

## Automatické delegování

Agenty z `.claude/agents/` volej sám, bez čekání na pokyn, podle tohoto přehledu:

| Situace | Agent |
|---|---|
| Kde se něco v kódu děje, jak to funguje | `code-navigator` |
| Návrh nové featury, mechaniky, módu, levelu, obtížnosti | `game-designer` |
| Ověření pravidel disciplíny podle UCI | `race-rules-expert` |
| Chování soupeřů, taktika, stamina, balík | `ai-tactician` |
| Rychlosti, klopení, závětří, kolize, energie | `physics-tuner` |
| 3D modely, materiály, textury, světla, kamera | `graphics-artist` |
| Zvuky a hudba (WebAudio) | `audio-designer` |
| Ovládání na telefonu, HUD, menu, rozložení obrazovky | `mobile-ux-designer` |
| Nízké FPS, zasekávání, paměť | `performance-optimizer` |
| Něco nefunguje, pád, divné chování | `bug-hunter` |
| Po každé větší změně kódu, před commitem | `code-reviewer` a potom `playtester` |
| Změna herní logiky (body, pořadí, kola, vyřazování) | `test-writer` |
| Změna rychlostí, energie, AI nebo podezření na nevyváženost | `balance-simulator` |
| Po větší změně nebo přidání režimu | `docs-keeper` (mapa řádků a README) |
| Rozdělení `index.html` na moduly, úklid kódu | `refactorer` |
| Texty hry, README, české popisky | `czech-copywriter` |
| PWA, GitHub Pages, verze, release | `release-manager` |

Postup u nové featury: `game-designer` navrhne, `race-rules-expert` ověří pravidla (pokud jde o závod), implementace v hlavní konverzaci, pak `code-reviewer` a `playtester`.

Dva nezávislé úkoly spouštěj paralelně. Agenty neřetěz zbytečně, každý stojí tokeny.

## Konvence

- Odpovídej česky. Texty ve hře jsou česky.
- Hra běží na telefonu v režimu na šířku (`manifest.json`, fullscreen), výkon na mobilu je priorita.
- Žádné logo sponzorů (týmy mají jen názvy a barvy dresů).
- Po změně vždy zkontroluj, že `index.html` jde načíst bez chyby v konzoli.
