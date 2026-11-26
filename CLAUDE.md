# Motol Simulator – pravidla pro Clauda

3D simulátor dráhové cyklistiky na Velodromu Praha-Motol. Celá hra je v jednom souboru `index.html` (cca 3 700 řádků, 800 kB, Three.js z CDN). Soubor `stara/index.html` je stará verze, ignoruj ji.

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
| 973–1513 | anatomie jezdců, vlk (Vojck), boty, posturální pozice |
| 1514–1690 | rozhodčí |
| 1691–1790 | soupiska jezdců, stav hry |
| 1792–1904 | audio (WebAudio), vstup (dotyk, posuvník) |
| 1905–2147 | simulace, závodní AI, mozek balíku (skupiny, útoky, stamina) |
| 2148–2354 | kontakty (pády, loktování, zaháknutí kol) |
| 2355–2523 | trenér „Starej šéf“, pivní plechovky, loket |
| 2524–2708 | vylučovačka, madison |
| 2709–3078 | high five, startér, házení v madisonu, záchranka, chodníčky na infieldu, závěrečné titulky |
| 3079–3413 | vysílačka trenéra, statistiky závodu |
| 3414–3683 | intro startu, KEIRIN, BODOVAČKA, pozadí menu |
| 3684–3722 | herní smyčka |

Režimy mají vlastní bloky `// -------- KILOMETR / KEIRIN / BODOVAČKA / VYLUČOVAČKA / MADISON / SCRATCH --------` (kolem řádků 3130–3260).

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
