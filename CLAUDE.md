# Motol Simulator – pravidla pro Clauda

3D simulátor dráhové cyklistiky na Velodromu Praha-Motol. Celá hra je v jednom souboru `index.html` (cca 3 700 řádků, 800 kB, Three.js z CDN). Soubor `stara/index.html` je stará verze, ignoruj ji.

## Pravidla pro šetření tokeny

- **Nikdy nečti celý `index.html`.** Je příliš velký. Hledej přes Grep a čti jen úseky (Read s offset a limit).
- Kód je rozdělený komentáři `// ---------- název ----------`. Podle nich najdeš sekci: renderer, geometrie dráhy, hala, válce, jezdci a kola, týmové dresy, anatomie jezdců, rozhodčí, soupiska, stav, audio, vstup, simulace, závodní AI, kontakty, vylučovačka, madison, vysílačka trenéra, režimy (KILOMETR, KEIRIN, BODOVAČKA, VYLUČOVAČKA, MADISON, SCRATCH).
- Rozsáhlé průzkumy kódu a hledání delegují agenti, ať se do hlavní konverzace vrací jen shrnutí.

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
