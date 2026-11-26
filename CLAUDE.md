# Motol Simulator – pravidla pro Clauda

3D simulátor dráhové cyklistiky na Velodromu Praha-Motol. Celá hra je v jednom souboru `index.html` (cca 3 700 řádků, 800 kB, Three.js z CDN). Soubor `stara/index.html` je stará verze, ignoruj ji.

## Online účty a žebříček (Supabase)

- Celé napojení je v samostatném souboru `online.js` (bez knihoven, volá Supabase přes `fetch`). Hra ho načítá přes `<script src="online.js" defer>`. Když selže, hra běží dál jen lokálně.
- Zásahy do `index.html` jsou jen pět: načtení skriptu, hák `Online.report(...)` v `startCeremony` (po výpočtu `me`), větev `Online.buy(id)` na začátku `buyItem`, výjimka `#onlineOv` v globálním click-handleru, který jinak odostřuje (blur) každé aktivní pole a nedal by psát do okna přihlášení, a `Online.board(el)` v `tvTab` (televize na ploše přepíná Výsledky závodu / Žebříček).
- Server (projekt `maiswaiilplgvewuurux`, Frankfurt): tabulky `profiles`, `results`, `purchases`, `shop_items` se zapnutým RLS. Hráč do nich nezapisuje přímo, jen přes funkce `set_nickname`, `submit_result`, `buy_item`, `import_local_progress`, `get_leaderboard`. Odměnu za závod počítá hra, server ji omezí (max 400 za závod, 5000 za 24 h).
- Přezdívky čekají na schválení majitelem (`profiles.nickname_status`), výsledky jde skrýt (`results.hidden`).
- Obchod má záložky Kola a Helmy (`SHOP_ITEMS`, pole `tab`, `w` = watty) a 3D náhled hrdiny (`shopPreview`, vlastní malý WebGL renderer, běží jen při otevřeném obchodě). `shop_items` na serveru: `spoke5_f`, `spoke5_r` (loukoťáky, 500, +15 W), `disc_f`, `disc_r` (1000, +25 W), `helm_aero` (1500, +10 W), `helm_shield` (2500, +20 W), `helm_tt` (4000, +35 W). `helm_road`, `wire_f` a `wire_r` (výplet) jsou zdarma a jen ve hře. Platí jen nasazené: jedno přední kolo, jedno zadní (`motol_wheel_f`/`_r`, `wornWheel(slot)`, bez volby nejlepší koupené) a jedna helma (`motol_helm`, `wornHelm()`); nasazuje `wearItem(id)`. `applyGear()` vymění kola (výplet / loukoť / disk, `wk` = druh pro `makeWheel`), nasadí helmu (`setRiderHelm`, modely `buildShopHelm`) a nastaví `player.gearW`. `online.js` po změně koupených věcí volá `window.renderShop` (ten volá i `applyGear`).
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

OMNIUM a TEAM SPRINT mají vlastní blok těsně před sekcí PLOCHA (`// ---------- OMNIUM: …` a `// ---------- TEAM SPRINT: …`). Omnium nemá vlastní `mode`: `OMNI={ev,tot,res}` drží průběh a `mode` je vždy aktuální disciplína (tempový závod = bodovačka s `TEMPO=true`, parametry `PT_LAPS`, `PT_EVERY`, `PT_FROM`, `PT_DBL`, `PT_TAB` nastavuje `resetRiders`). Po disciplínách 1–3 `startCeremony` volá `omniBreak()`. Team sprint má `mode==='teamsprint'` a stav `TSP` (pozor, `TS` je turbo ve smyčce). Server zná režimy `omnium` (body) a `team_sprint` (čas).

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
- **Verze** je v menu v `index.html` (`Velodrom Praha-Motol · vX.Y`, jediné místo). Před každým sloučením do `main` ji zvedni: velký update zvýší první číslo a druhé vynuluje (v0.9 → v1.0), menší update zvýší druhé (v0.9 → v0.10). Po sloučení do `main` napiš uživateli název nové verze.
