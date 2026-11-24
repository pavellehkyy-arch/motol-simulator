# Motol Simulator

3D simulátor dráhové cyklistiky na Velodromu Praha-Motol (153,846 m, klopení až 52°).

**Hrát:** https://pavellehkyy-arch.github.io/motol-simulator/

- Scratch na 13 kol (2 km) proti 8 soupeřům z týmů Tufo Pardus Prostějov, Dukla Praha, Sparta Praha a Favorit Brno – všichni jezdci jsou zhruba stejně silní, rozhoduje taktika
- Start bodovacích závodů podle UCI: polovina jezdců u mantinelu, polovina ve sprinterském pruhu s držiteli, neutrální kolo a letmý start výstřelem
- Na špici v protivětru se energie čerpá rychleji (čím rychlejší tempo, tím víc), jezdci se proto střídají
- Menu rozdělené na **sprinterské** (keirin, kilometr) a **vytrvalostní** disciplíny (scratch, bodovačka, madison, vylučovačka)
- **Keirin** podle UCI: 6 jezdců, startovní pozice losem (č. 1 nejníž), start z místa s držiteli na stíhací čáře, elektrický derny přijíždí zezadu po vnitřku a výstřel padne, když jezdce míjí; derny zrychluje 30 → 50 km/h, v 1. kole se drží pořadí z losu (jinak žlutá karta), kdo se dostane přes zadní kolo derny, je diskvalifikován (DSQ); derny odstupuje na cílové čáře 5 kol (769 m) před cílem a sjíždí na apron, pak volný sprint. Animovaný pilot (šlape podle rychlosti, sedí vzpřímeně, ohlíží se na jezdce, před odstupem dlouhý pohled dozadu, v klopení se naklání, po zastavení dá nohu na zem), elektrický zvuk motoru
- **Bodovačka** podle UCI: neutrální kolo a letmý start, 40 kol, sprint každých 10 kol (5-3-2-1 bodů), poslední sprint dvojnásobně (10-6-4-2), získané kolo +20, ztracené −20, při rovnosti rozhoduje cílový sprint
- Kilometr na čas (6,5 kola z místa)
- Vylučovačka: neutrální kolo, pak každá 2 kola vypadává poslední (zadní kolo na čáře), poslední dva jedou finálový sprint; balík nikoho nenechá ujet
- Ovládání: přejetí prstem doleva/doprava = výška na dráze, posuvník vpravo = síla (volno → tempo → sprint), automatické držení kola v háku
- Loktování najetím do soupeře z boku, výrazný sjezd z klopení (ukazatel výšky, „SJEZD +X km/h“), pády, únava, vyhlášení na bedně

Celá hra je v jednom souboru `index.html` (Three.js z CDN).
