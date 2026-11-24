# Motol Simulator

3D simulátor dráhové cyklistiky na Velodromu Praha-Motol (153,846 m, klopení až 52°).

**Hrát:** https://pavellehkyy-arch.github.io/motol-simulator/

- Scratch na 13 kol (2 km) proti 8 soupeřům z týmů Tufo Pardus Prostějov, Dukla Praha, Sparta Praha a Favorit Brno – všichni jezdci jsou zhruba stejně silní, rozhoduje taktika
- Start bodovacích závodů podle UCI: polovina jezdců u mantinelu, polovina ve sprinterském pruhu s držiteli, neutrální kolo a letmý start výstřelem
- Na špici v protivětru se energie čerpá rychleji (čím rychlejší tempo, tím víc), jezdci se proto střídají
- Kilometr na čas (6,5 kola z místa)
- Vylučovačka: neutrální kolo, pak každá 2 kola vypadává poslední (zadní kolo na čáře), poslední dva jedou finálový sprint; balík nikoho nenechá ujet
- Ovládání: přejetí prstem doleva/doprava = výška na dráze, posuvník vpravo = síla (volno → tempo → sprint), automatické držení kola v háku
- Loktování najetím do soupeře z boku, výrazný sjezd z klopení (ukazatel výšky, „SJEZD +X km/h“), pády, únava, vyhlášení na bedně

Celá hra je v jednom souboru `index.html` (Three.js z CDN).
