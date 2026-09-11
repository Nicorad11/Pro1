# El eller benzin?

En lille web app der regner ud, hvad det koster dig at køre 1 km på el kontra
på benzin eller diesel — med dagens elpriser.

## Kør den

Ingen build, ingen npm. Appen skal serveres over http, så den kan læse
`data/priser.json`:

```bash
python3 -m http.server 8000
# → http://localhost:8000/braendstof-app/
```

Åbner du `index.html` som en løs fil, henter appen spotpriserne direkte fra
elprisenligenu.dk i stedet.

## Hvad den regner ud

| Tal | Formel |
| --- | --- |
| Elpris pr. kWh (hjemme) | `(spotpris + tillæg) × 1,25` |
| El pr. km | `elpris/kWh × forbrug(kWh/100km)/100 × (1 + ladetab)` |
| Benzin pr. km | `literpris ÷ km/l` |
| Vendepunkt, benzin | den literpris hvor de to er lige dyre |
| Vendepunkt, el | den kWh-pris hvor de to er lige dyre |

Derudover: kr pr. 100 km, hvor langt du kører for 100 kr, forskellen på et år,
og et søjlediagram over døgnets 24 timer så du kan se, hvornår det betaler sig
at sætte laderen til.

## Hvor priserne kommer fra

### El — automatisk

`.github/workflows/priser.yml` kører kl. 05:10 og 14:10 UTC, henter døgnets
spotpriser for DK1 og DK2 fra
[elprisenligenu.dk](https://www.elprisenligenu.dk/elpris-api) og committer dem
til `data/priser.json`. Appen læser filen fra sit eget domæne, så der hverken
er CORS-problemer eller API-nøgler i spil i browseren.

Hentningen sker i en Action og ikke i browseren, fordi det er den eneste måde
at få pumpepriser med i samme fil — og fordi filen så også virker de steder,
hvor browseren spærrer for kald til fremmede domæner.

**Spotprisen er ikke hele regningen.** Oven i kommer elafgift, nettarif,
abonnement og elselskabets tillæg — det er feltet **"Tillæg pr. kWh"**, sat
til 1,40 kr/kWh som et rimeligt udgangspunkt. Find tallene på din egen
elregning, så bliver beregningen præcis frem for cirka. Til sidst lægges 25 %
moms oveni, for spotprisen er uden.

Lader du ude, eller har du en fast aftale, kan du springe spotprisen over og
taste din egen pris ind.

### Benzin — manuelt indtil videre

Ingen af de danske selskaber udstiller deres dagspris som et åbent API, og
disse kilder er afprøvet uden held:

| Kilde | Resultat |
| --- | --- |
| ok.dk, benzinprisside | Tallene dér er faste eksempelværdier i en sammenligningsberegner, ikke dagens pris — diesel stod dyrere end benzin |
| circlek.dk | Priserne renderes med JavaScript; intet API fundet |
| ingo.dk, f24.dk, shell.dk | 404 på de afprøvede adresser |
| Energi Data Service, `Elspotprices` | Ikke opdateret siden 30. september 2025 — droppet også som elkilde |

Så prisen taster du selv ind. Den gemmes i browseren, og appen siger til, når
den bliver gammel. `braendstofpriser()` i `tools/hent-priser.mjs` står klar til
at blive fyldt ud, den dag der findes en kilde der holder: giver den et tal,
fylder appen selv feltet ud, og din egen indtastning vinder stadig over den.

## Filer

```
index.html            opbygningen
style.css             udseendet (følger lyst/mørkt tema)
app.js                hentning af priser, beregning og visning
data/priser.json      priserne, opdateret af en GitHub Action
tools/hent-priser.mjs selve hentningen, kører kun i Actions
```

Alle indtastninger bliver kun liggende i din egen browser.
