# Právní kontrola – Motol Simulator

Plný audit k verzi v3.2 (online závod: vzhled jezdce v presence Supabase Realtime, WebRTC peer-to-peer).
Prošlo se: `online.js`, `multi.js`, `race-net.js`, `supabase/migrations/*`, `supabase/functions/turn-credentials`, `manifest.json`, `README.md`, `index.html` (jen Grep a úseky).
Na Supabase se nepřipojovalo, schéma starších tabulek (`profiles`, `results`, `purchases`, `feedback`, `coach_requests`, RLS na `realtime.messages` pro `plocha:%`) v repozitáři není, takže se ověřit nedalo.

Tohle není právní rada advokáta. U bodů označených 🔴 doporučuji krátkou konzultaci s advokátem (osobnostní práva, ochranné známky).

## Verdikt

Je potřeba něco opravit před vydáním: na dresu německé reprezentace jsou skutečné značky a logo svazu. Text zásad je potřeba doplnit o novinky z v3.2 a o STUN servery. U skutečných osob ve hře (fotky, hlas, Instagram) je potřeba mít jejich souhlas.

## Co je v pořádku

- **Zásady (`viewPrivacy`, online.js 522–541)** jsou srozumitelné a skoro úplné. Uvádějí kontakt, data účtu, účel a právní základ (smlouva / oprávněný zájem), plochu online, online závod včetně viditelnosti IP adresy při P2P, mazání `race_sessions` po 30 dnech, technické logy, cookies, práva hráče a ÚOOÚ.
- **Cookies a ePrivacy**: hra nemá analytiku ani sledování. `localStorage` (`motol_*`, přihlášení, outbox) je nezbytný pro hru, takže lišta se souhlasem není potřeba.
- **Minimalizace**: chat i poloha jdou jen přes Realtime broadcast a nic se neukládá. Vzhled jezdce v presence (`netMyLook`, index.html 4746–4747) obsahuje jen herní věci (barvy avatara, helmu, kola, aero, barvu kola, příznak Albi). Má limit 300 B (`okLook`) a příjemce ho validuje whitelistem (`netLookOk`). Nejsou to osobní údaje o skutečném vzhledu hráče, barva pleti patří herní postavě (náhodná nebo Albiho).
- **XSS**: chat se vkládá přes `textContent` / `createTextNode` (index.html 4905), `cleanText` v multi.js odstraní řídicí a bidi znaky, přezdívky jdou přes `netEsc`. `online.js` staví DOM přes `h()` s `text`.
- **Obsah od hráčů**: přezdívky schvaluje majitel, výsledky lze skrýt. Návrhy (max. 1000 znaků) a žádosti o trenéra mají limity a mažou se po roce.
- **Bezpečnost**: v repozitáři je jen publishable klíč. TURN klíče jsou v secrets Edge Function. `race_sessions` má RLS a `revoke all`, funkce mají `security definer` + `set search_path to ''` a interní funkce jsou odebrané z `anon`/`authenticated`. `turn-credentials` pustí jen `can_walk_online()`.
- **Virtuální měna**: kredity jsou jen herní, nekupují se za peníze a nejsou tu loot-boxy. Spotřebitelské právo se zatím netýká.
- **Knihovny**: Three.js r128 (MIT) z cdnjs, žádné cizí fonty (system-ui) ani hudba třetích stran. Zvuky dělá WebAudio, hlas trenéra `speechSynthesis` lokálně.
- **Velodrom Praha-Motol**: název místa je popisný, hala je vlastní 3D model. Riziko je nízké.

## Rizika

### 🔴 Vysoká (opravit před vydáním)

1. **Skutečné značky na dresu „Německá reprezentace“.** index.html 1043–1046 (`txt('german')`, `txt('cycling')`, `txt('BIORACER')`, `txt('BIKE INDUSTRIES')`) a 1063 (`BIORACER` na kalhotách). K tomu orlice (1039–1041) a „swoosh“ podle fotky skutečného dresu. Bioracer a Bike Industries jsou ochranné známky výrobců a sponzorů, „german cycling“ je značka svazu BDR a spolková orlice je v Německu chráněný státní znak. Porušuje to i pravidlo v CLAUDE.md (žádná loga sponzorů).
   **Návrh:** smazat řádky s `txt('german'…)`, `txt('cycling'…)`, `txt('BIORACER'…)`, `txt('BIKE INDUSTRIES'…)` a `fillText('BIORACER'…)` na ř. 1063. Orlici (blok `g.translate(x+62,46)` … `g.restore()`) nahradit prostým štítkem v barvách černá-červená-zlatá, nebo ji vynechat. Text `GERMANY` může zůstat.
2. **Skuteční lidé bez doloženého souhlasu (§ 81–90 občanského zákoníku, čl. 6 GDPR).**
   - Fotografie: `VOJCK_IMG` (plakát „LEGENDA VOJCK“, ř. 815–827), `LEGEND_IMG` (ř. 814), Albiho fotosken `PHOTO_TEX_SRC` (ř. 1658) a „Hra za Albiho“.
   - Nahraný hlas: `KYBL_B64` (ř. 2191, nahrávka z iPhonu/QuickTime).
   - Instagramové účty na mantinelu: `ig:dave197.cz`, `ig:rauschertalbert` (ř. 483–484).
   - Jména a povahy: „Lukáš Hasal“ (ř. 2088, „loktuje se jak divý, ale padá ještě víc“), Kýbl, Hurikán Samko, Kemi.

   Podobizna, hlas a jméno smí ve veřejně dostupném díle být jen se svolením dotyčného. U nezletilého je potřeba i souhlas rodiče.
   **Návrh:** od každého získat písemný souhlas (stačí e-mail nebo zpráva: „souhlasím, aby moje fotka / hlas / jméno / IG účet byly ve hře Motol Simulator, souhlas můžu odvolat“) a schovat ho. Kdo nesouhlasí, tomu jméno, fotku, hlas i IG odstranit. Konzultace s advokátem je vhodná hlavně kvůli fotoskenu a hlasu.

### 🟠 Střední (opravit brzy, ideálně v příští verzi)

3. **Jména slavných profesionálů:** „Evenepoel“, „Vingegaard“, „Ganna“, „Milan“ (index.html 2081–2084, páry v 3270). Jsou to osobnostní práva světových sportovců. „Evenepoel“ je navíc registrovaná značka. U bezplatné hry je riziko spíš nízké, ale snadno se odstraní.
   **Návrh:** přejmenovat na smyšlená jména (např. „Evžen“, „Vinga“, „Gana“, „Milánek“) a změnit i `by('Evenepoel')` atd. v ř. 3270.
4. **Zásady neodpovídají v3.2 a STUN.**
   - online.js 531 nezmiňuje vzhled jezdce v presence, zálohu přes server Supabase (broadcast `rl`, když P2P nejde) ani STUN server Google (`FALLBACK_ICE`, race-net.js 24, a STUN v `turn-credentials`). STUN server vidí IP adresu hráče.
   - „anonymní číslo účtu“ (ř. 530 a 531) není podle GDPR anonymní, je to pseudonym (UUID účtu).

   **Návrh:** nahradit text v ř. 531:
   `'když se přidáš do online závodu, propojí se tvé zařízení přímo se zařízeními ostatních jezdců v závodě (WebRTC). Posílá se jim poloha a rychlost tvého jezdce, jeho vzhled (helma, kola, barvy), přezdívka (jen schválená) a náhodné číslo účtu, ze kterého nejde zjistit tvůj e-mail. Při přímém spojení ostatní hráči technicky vidí tvou IP adresu. K navázání spojení se tvé zařízení ptá STUN serveru Googlu nebo Cloudflare, který tak uvidí tvou IP adresu. Když přímé spojení nejde, data jdou přes přenosový (TURN) server Cloudflare nebo Metered, případně přes server Supabase; ty je jen přeposílají a neukládají. Na serveru hry se k závodu ukládá čas startu a cíle, režim a pořadí, které jsi nahlásil, kvůli kontrole poctivosti výsledků; mažou se po 30 dnech.'`

   V ř. 530 nahradit „anonymní číslo účtu“ za „náhodné číslo účtu (bez e-mailu)“. Po změně se může posunout datum v ř. 537 („Platí od 27. 11. 2026“) na datum vydání.
5. **Předávání mimo EU není v zásadách.** Ř. 532 („Kde:“) uvádí jen Frankfurt, ale GitHub Pages (GitHub/Microsoft), cdnjs a TURN/STUN (Cloudflare, Google, Metered) jsou firmy z USA.
   **Návrh:** doplnit na konec textu „Kde:“: `' GitHub, Cloudflare, Google a Metered mohou údaje (IP adresu) zpracovat i v USA; předávání je kryté rámcem EU–USA pro ochranu údajů (Data Privacy Framework) nebo standardními smluvními doložkami.'` Zkontrolovat, že Metered je v DPF, jinak ho uvést jen se SCC.
6. **Chat a obsah od hráčů bez nahlášení a blokování (DSA čl. 11, 12 a 16).** Chat na ploše (`Multi.say`) není moderovaný, hráč nemůže nikoho ztlumit ani nahlásit a nikde nejsou pravidla chování. Online hráči mohou být i děti.
   **Návrhy:**
   - (a) Do `viewPrivacy` přidat za ř. 536 sekci `sec('Nevhodný obsah:', 'urážlivou přezdívku, zprávu v chatu nebo jiný nezákonný obsah nahlas na ' + CONTACT + ' (přezdívku hráče, čas a co se stalo). Účty, které porušují pravidla, můžeme zablokovat.');`. Je to kontaktní místo podle DSA.
   - (b) Do `mpChatMsg` (index.html 4904) přidat ťuknutím na jméno „🔇 Ztlumit“, které uloží id do `Set` v paměti a jeho zprávy a bubliny přestane zobrazovat.
   - (c) Při prvním otevření chatu (`mpChatOpen`) jednou ukázat „Buď slušný. Nesdílej osobní údaje (telefon, adresu). Sprostý chat = zablokovaný účet.“
   - (d) Na serveru možnost zablokovat účet pro online (např. `nickname_status='rejected'` už dnes vypne `can_walk_online()`, stačí to uvést v zásadách).
7. **Děti (věk 15 let, § 7 zákona 110/2019 Sb.).** Účet stojí na smlouvě (čl. 6 odst. 1 písm. b), ne na souhlasu, takže čl. 8 se přímo neuplatní. U chatu s cizími lidmi a viditelné IP adresy je ale u dětí rozumné mít alespoň potvrzení.
   **Návrh:** v `online.js` v okně přezdívky (`viewNick`, ř. 582 a dál), když `ctx.after==='mp'`, přidat zaškrtávátko „Je mi aspoň 15, nebo mi to dovolili rodiče.“ a bez něj nepustit dál (stačí lokálně `LS.set('motol_age15','1')`). Text v ř. 537 může zůstat.
8. **Reklamní bannery na mantinelu.** index.html 482–487: 3× logo `varna-studio.png`, 2× „REKLAMA ig:…“ a 3× „VOLNÁ REKLAMA“. To odporuje pravidlu z CLAUDE.md „žádné logo sponzorů“. Pokud jde o placenou reklamu, je to obchodní sdělení (zákon 40/1995 Sb. a 480/2004 Sb.): musí být jasně označené (to je) a příjem se daní. Pokud placená není, je potřeba aspoň svolení majitele značky Varna Studio.
   **Návrh:** rozhodnout, jestli bannery zůstanou. Když ano, upravit pravidlo v CLAUDE.md (výjimka pro mantinel) a mít svolení od Varna Studio a od majitelů IG účtů (viz bod 2).

### 🟢 Nízká (drobnosti)

9. **Duhový dres „Mistr světa“** (TEAMS.wc, `RAINBOW` ř. 1009–1014, plakát „MISTR SVĚTA“ ř. 834) a **„UCI“ na derně** (ř. 4151, 4157). Duhové pruhy a UCI jsou registrované známky UCI. Riziko je malé, stačí upravit barvy (pořadí modrá-červená-černá-žlutá-zelená je přesně UCI) a místo `E-PACER · UCI KEIRIN` psát `E-PACER · KEIRIN` a místo `UCI` třeba `DERNY`. Odkazy na pravidla UCI v README a komentářích jsou v pořádku.
10. **Barvy týmů Praha (žlutočerná) a Praha 2 (vínovo-žlutá)** připomínají Duklu a Spartu, interní id jsou `dukla`/`sparta`/`pardus`/`favorit`. Na dresu jsou jen města, takže riziko je minimální. Interní id je možné přejmenovat na `praha`/`praha2`/…, ať v kódu nejsou názvy klubů.
11. **Mazání `race_sessions` po 30 dnech** se spouští jen v `race_start` (migrace 20261128, ř. „úklid“). Když nikdo nehraje, staré záznamy zůstanou. **Návrh:** přidat `pg_cron` job (denně `delete … where started_at < now() - interval '30 days'`) nebo to v zásadách formulovat „nejpozději po 30 dnech od dalšího závodu“. První varianta je lepší.
12. **Schéma starších tabulek není v repozitáři.** RLS na `profiles`, `results`, `purchases`, `feedback`, `coach_requests` a politiky `plocha_read`/`plocha_write` nejdou z kódu ověřit. Ani výmaz účtu (kaskáda z `auth.users`) nejde zkontrolovat. **Návrh:** uložit `supabase db dump --schema public` jako migraci `supabase/migrations/00000000_base.sql`.
13. **E-maily s kódem.** Zásady neříkají, kdo e-maily posílá. Při výchozím SMTP Supabase je to Supabase. Pokud je nastavené vlastní SMTP (např. Brevo), doplnit ho do „Kde:“ jako zpracovatele.
14. **Volitelně jen relay:** když budou nastavené TURN klíče, může se v `race-net.js` (`new RTC({iceServers, iceTransportPolicy:'relay'})`, kolem ř. 290) nabídnout volba „Skrýt mou IP adresu“, protože pak jde všechno přes TURN. Krátká poznámka v čekárně (`#netLobby`, index.html 297) „Při přímém spojení vidí ostatní hráči tvou IP adresu – víc v Jak nakládáme s údaji“ zvýší transparentnost.
15. **`og.jpg` („Hala Velodromu Praha-Motol“) a plakáty**: ověřit, že fotky jsou vlastní nebo s licencí (autorské právo k fotografii).

## Doporučené kroky (pořadí)

1. Odstranit Bioracer / Bike Industries / german cycling / orlici z německého dresu (bod 1).
2. Opravit text zásad v online.js 530–532 (body 4 a 5) a přidat sekci „Nevhodný obsah“ (bod 6a).
3. Sehnat a uschovat souhlasy skutečných osob (bod 2). Do té doby zvážit skrytí fotek, hlasu a IG.
4. Přejmenovat profesionální jezdce (bod 3).
5. Ztlumení v chatu, pravidla chatu a potvrzení věku pro online (body 6b, 6c, 7).
6. Vyjasnit bannery (bod 8), drobnosti 9–15 podle času.


## Vyřešeno (28. 11. 2026)
- Bod 1: značky a orlice z německého dresu odstraněny (v3.2), zůstal nápis GERMANY a trikolóra.
- Bod 2: majitel potvrdil, že souhlasy skutečných osob má (doporučení: uschovat je písemně, např. e-maily).
- Bod 3: profesionálové přejmenováni na Evžen, Vilda, Gusta a Mates.
- Bod 4 a 5: text zásad doplněn (vzhled jezdce, STUN, předávání mimo EU, platí od 28. 11. 2026).

## ⏰ Otevřené body – připomenout majiteli při každé aktualizaci a kontrole
- **Chat (plocha online):** chybí tlačítko 🔇 Ztlumit a nahlášení hráče přímo ve hře a pravidla chatu při prvním otevření (DSA čl. 16). Majitel rozhodl: zatím neopravovat, ale připomínat. Kontakt na nahlášení už je v zásadách (sekce Nevhodný obsah).
- **Věk 15 let:** zásady to teď říkají, ale hra se na věk neptá (zaškrtávátko před online hrou zatím není).
- **Totožnost správce v zásadách:** „provozuje její autor“ bez jména; GDPR čl. 13 chce jméno správce. Doplnit, až to majitel odsouhlasí.
- **Mazání `race_sessions` po 30 dnech** se spouští jen v `race_start` (bod 11), zásady ale slibují pevných 30 dní. Přidat denní `pg_cron` úklid.
- **Výmaz „všeho k účtu“** (zásady, sekce Jak dlouho) nejde ověřit, schéma starších tabulek a kaskády z `auth.users` v repozitáři nejsou (bod 12).

## Vyřešeno (28. 11. 2026, pokračování)
- Duhové pruhy UCI na dresu Mistr světa nahrazeny vlastními (modrá-červená-modrá); na derně místo „UCI“ nápis „KEIRIN“.
- Zásady doplněny: k čemu je e-mail, oprávněný zájem u kontroly závodů a přezdívek, doby mazání, nahlášení nevhodného obsahu, děti od 15 let, právo na omezení a námitku.

## Kontrola updatu 4b2b029..d3f1f75 (v3.3, 28. 11. 2026)
- Ověřeno: dres Mistr světa používá vlastní `WC_BANDS` (modrá-červená-modrá, i hrdina na ploše `heroBuild`), konstanta `RAINBOW` v kódu už není. Derna má `E-PACER · KEIRIN` a kombinéza vodiče `KEIRIN`, nápis UCI na modelech už není (UCI zůstalo jen v komentářích, to je v pořádku). Bod 9 vyřešen. Plakát „MISTR SVĚTA“ duhu nemá, „duhový štít“ helmy je jen popis barvy.
- Ověřeno: přejmenování profesionálů i v párech madisonu (bod 3 hotov úplně).
- Zásady (čl. 13) jsou skoro úplné. Zbývá:
  - 🟠 **Online závod – záloha přes server Supabase chybí.** Bez TURN klíčů jdou data přes Supabase Realtime (broadcast `rl`, race-net.js 373–415), text online.js 531 zmiňuje jen TURN. Návrh: v ř. 531 nahradit „…server poskytovatele Cloudflare nebo Metered, který je jen přeposílá a neukládá.“ za „…server poskytovatele Cloudflare nebo Metered, případně přes server hry (Supabase); ty data jen přeposílají a neukládají.“
  - 🟠 **Supabase chybí v předávání mimo EU.** Supabase Inc. je firma z USA (data jsou ve Frankfurtu, ale zpracovatel má přístup z USA). Návrh: v ř. 532 změnit „GitHub, Cloudflare, Google a Metered mohou IP adresu zpracovat i v USA“ na „Supabase, GitHub, Cloudflare, Google a Metered mohou údaje (hlavně IP adresu) zpracovat i v USA“.
  - 🟢 **Povinnost poskytnout údaje (čl. 13 odst. 2 písm. e).** Návrh: v ř. 526 doplnit na konec „Účet je dobrovolný; bez e-mailu ho založit nejde, ale celá hra kromě žebříčku a online hry jde hrát i bez něj.“
  - 🟢 **Automatické skrytí neověřených výsledků** (`submit_result` od v3.0 skryje výsledek a dá polovinu odměny). Čl. 22 se kvůli malému dopadu neuplatní, pro přesnost v ř. 528 změnit „kromě skrytí zjevně nemožného výsledku z žebříčku“ na „kromě skrytí zjevně nemožného nebo neověřeného výsledku z žebříčku“.
  - Totožnost správce (jméno) dál chybí, viz Otevřené body.


## Vyřešeno (28. 11. 2026, po kontrole d3f1f75)
- Zásady: záloha přes server Supabase, Supabase mezi firmami z USA, dobrovolnost účtu, skrytí neověřených výsledků.
- `race_sessions`: denní úklid přes `pg_cron` (úloha `race_sessions_cleanup`, 3:17, migrace `20261130_race_sessions_cron.sql`).
- Výmaz účtu: ověřeno v databázi, že `profiles`, `purchases`, `results`, `feedback`, `coach_requests` a `race_sessions` mají `on delete cascade` na `auth.users`.


## Vyřešeno (28. 11. 2026, odpovědi majitele)
- Reklama na mantinelu je majitelova vlastní (žádný cizí sponzor): v pořádku, pravidlo o logech sponzorů se jí netýká.
- E-mail s kódem posílá Brevo (Francie, EU): doplněno do zásad jako zpracovatel.

Poslední kontrola: d3f1f75c890ea71123deba0d247c2f6bd768cfc0 2026-11-28
