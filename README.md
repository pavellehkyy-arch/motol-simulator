# Motol Simulator

3D simulátor dráhové cyklistiky na Velodromu Praha-Motol (153,846 m, klopení až 52°).

**Hrát:** https://pavellehkyy-arch.github.io/motol-simulator/

- Scratch na 13 kol (2 km) proti 8 soupeřům z týmů Tufo Pardus Prostějov, Dukla Praha, Sparta Praha a Favorit Brno – všichni jezdci jsou zhruba stejně silní, rozhoduje taktika
- Start bodovacích závodů podle UCI: polovina jezdců u mantinelu, polovina ve sprinterském pruhu s držiteli, neutrální kolo a letmý start výstřelem
- Na špici v protivětru se energie čerpá rychleji (čím rychlejší tempo, tím víc), jezdci se proto střídají
- Menu rozdělené na **sprinterské** (sprint, keirin, kilometr) a **vytrvalostní** disciplíny (scratch, bodovačka, madison, vylučovačka)
- **Keirin** podle UCI: 6 jezdců, startovní pozice losem (č. 1 nejníž), start z místa s držiteli na stíhací čáře, elektrická derna přijíždí zezadu po vnitřku a výstřel padne, když jezdce míjí; derna zrychluje 30 → 50 km/h, v 1. kole se drží pořadí z losu (jinak žlutá karta), kdo se dostane přes zadní kolo derny, je diskvalifikován (DSQ); derna odstupuje na cílové čáře 5 kol (769 m) před cílem a sjíždí na apron, pak volný sprint. Animovaný pilot (šlape podle rychlosti, sedí vzpřímeně, ohlíží se na jezdce, před odstupem dlouhý pohled dozadu, v klopení se naklání, po zastavení dá nohu na zem), elektrický zvuk motoru
- **Bodovačka** podle UCI: neutrální kolo a letmý start, 40 kol, sprint každých 10 kol (5-3-2-1 bodů), poslední sprint dvojnásobně (10-6-4-2), získané kolo +20, ztracené −20, při rovnosti rozhoduje cílový sprint
- **Sprint** podle UCI: zápas 1 na 1 na 2 vítězné rozjížďky, 5 kol (769 m ≈ 750 m), měří se jen posledních 200 m (na dráze je bílá čára 200 m). Pozice losem (č. 1 uvnitř), start z místa vedle sebe s držiči na písknutí; jezdec na pozici 1 musí vést aspoň krokem až ke stíhací čáře na protější straně, jinak se startuje znovu (soupeř si vybírá pozici, podruhé = prohraná rozjížďka). Pak volná taktika – pomalá jízda, sledování z klopení, ohlížení (Q/R), nástup. Přeřazení (= prohraná rozjížďka) za sjetí dolů na soupeře vedle sebe, předjíždění po modrém pásu, opuštění sprinterského pruhu vedoucím jezdcem v posledních 200 m a vjetí do pruhu bez náskoku délky kola. 2. rozjížďka s prohozenými pozicemi, rozhodující 3. s novým losem. Posuvník pod sprintem drží rychlost (volno ≈ 10, tempo ≈ 25, naplno ≈ 36 km/h), soupeř reaguje na tvůj nástup a sám nastupuje zhruba 170–330 m před cílem. Plný sprint vydrží jen asi 250 m – kdo nastoupí kola dopředu, umře před cílem a soupeř ho z háku přejede. **Nasávání v háku**: kdo sedí soupeři přesně za zadním kolem, nabíjí se (rychleji, když se do háku rozjede z mezery 3–4 m); když pak vyjede vedle, krátce ho to vystřelí dopředu – umí to hráč i bot. Přeřazení navíc za **zavření dveří** (sjetí dolů před soupeře, který předjíždí zespodu), za **shození soupeře** (rozjížďka jde jemu) a za opakované **strkání** (1. varování, 2. přeřazení). Bot, kterého blokuješ, couvne, rozjede se znovu a zkusí druhou stranu
- Kilometr na čas (6,5 kola z místa)
- Vylučovačka: neutrální kolo, pak každá 2 kola vypadává poslední (zadní kolo na čáře), poslední dva jedou finálový sprint; balík nikoho nenechá ujet
- **Obchod**: stolek na infieldu u protilehlé rovinky. Dostaneš se k němu jen na vyhlášení – tažením prstem po obrazovce se rozhlédneš, za zády uvidíš stolek s cedulí OBCHOD a ťuknutím otevřeš nabídku. Platí se penízky ze závodů; zboží je zatím jen ohlášené (brzy)
- Ovládání: přejetí prstem doleva/doprava = výška na dráze, posuvník vpravo = síla (volno → tempo → sprint), automatické držení kola v háku
- **Rozhodčí** v budce sledují jezdce, otáčejí se za tebou a zapisují si; když někoho podjedeš po modrém pásu, vztekají se (vstanou, ukazují na tebe, zrudnou) – bez vyskakovacích hlášek
- **Držiči** po startu jezdce odtlačí, sejdou z dráhy přes modrý pás a apron, přejdou zelenou plochu a zmizí v podchodu
- Načítací obrazovka ve stylu Motolu (ovál dráhy, tabule s koly do startu)
- Loktování najetím do soupeře z boku, výrazný sjezd z klopení (ukazatel výšky, „SJEZD +X km/h“), pády, únava, vyhlášení na bedně

Celá hra je v jednom souboru `index.html` (Three.js z CDN).
