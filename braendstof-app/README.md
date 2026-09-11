# El eller benzin?

En lille web app der regner ud, hvad det koster dig at køre 1 km på el kontra
på benzin eller diesel — med dagens elpriser.

## Kør den

Ingen build, ingen npm. Åbn `index.html` i en browser, eller start en lille
server så `fetch` er glad:

```bash
python3 -m http.server 8000
# → http://localhost:8000/braendstof-app/
```

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

## Priserne

**El — hentes automatisk.** Spotprisen for DK1/DK2 kommer fra
[elprisenligenu.dk's gratis API](https://www.elprisenligenu.dk/elpris-api)
(ingen nøgle, CORS-åbent). Fejler det, prøver appen
[Energi Data Service](https://www.energidataservice.dk/) i stedet.

Spotprisen er *ikke* hele regningen. Oven i kommer elafgift, nettarif,
abonnement og elselskabets tillæg — det er feltet **"Tillæg pr. kWh"**, som er
sat til 1,40 kr/kWh som et rimeligt udgangspunkt. Vil du have det helt
præcist, så find tallene på din egen elregning og skriv dem ind. Til sidst
lægges 25 % moms oveni, for API'ets priser er uden.

Lader du ude, eller har du en fast aftale, kan du springe spotprisen over og
bare taste din pris ind.

**Benzin — taster du selv ind.** Der findes ingen gratis, åben API med danske
pumpepriser, så prisen skriver du selv. Den bliver gemt i browseren
(`localStorage`), og appen siger til, hvis den er ved at blive gammel.
Dagsprisen kan du finde hos FDM, Circle K eller OK — der er links i appen.

## Filer

```
index.html   opbygningen
style.css    udseendet (følger lyst/mørkt tema)
app.js       hentning af priser, beregning og visning
```

Alle indtastninger bliver kun liggende i din egen browser. Intet sendes
nogen steder hen bortset fra selve prisopslaget.
