/*
 * Henter aktuelle priser og skriver braendstof-app/data/priser.json.
 *
 * Kører i GitHub Actions, hvor der er fri netadgang. Appen læser filen fra
 * samme domæne som sig selv, så der hverken er CORS-problemer eller
 * API-nøgler i spil i browseren.
 *
 * Kør med --probe for kun at undersøge kilderne og skrive, hvad de svarer,
 * uden at røre datafilen.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const PROBE = process.argv.includes("--probe");
const UD = new URL("../data/priser.json", import.meta.url).pathname;

const AGENT =
  "braendstof-app/1.0 (+https://github.com/Nicorad11/Pro1; prisberegner til eget brug)";

async function hent(url, { json = false, timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const svar = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": AGENT, accept: json ? "application/json" : "text/html,*/*" },
    });
    if (!svar.ok) throw new Error(`HTTP ${svar.status}`);
    return json ? await svar.json() : await svar.text();
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------------------------------------------------- el */

function dato(forskydDage = 0, fra = null) {
  const start = fra ? Date.parse(fra + "T12:00:00Z") : Date.now();
  return new Date(start + forskydDage * 86400000).toISOString().slice(0, 10);
}

/*
 * Spotpriser for begge prisområder i ét kald — API'et svarer 429, hvis man
 * fyrer flere kald af lige efter hinanden. Døgnet skal angives som et
 * halvåbent interval: end er dagen efter kl. 00:00.
 */
async function elpriser(dag) {
  const url =
    "https://api.energidataservice.dk/dataset/Elspotprices" +
    `?start=${dag}T00:00&end=${dato(1, dag)}T00:00` +
    `&filter=${encodeURIComponent(JSON.stringify({ PriceArea: ["DK1", "DK2"] }))}` +
    "&sort=HourDK%20ASC&limit=200";

  let data;
  for (let forsoeg = 1; ; forsoeg++) {
    try {
      data = await hent(url, { json: true });
      break;
    } catch (err) {
      if (forsoeg >= 4) throw err;
      const vent = forsoeg * 5000;
      console.log(`   ${err.message} — prøver igen om ${vent / 1000}s`);
      await new Promise((r) => setTimeout(r, vent));
    }
  }

  const ud = { DK1: [], DK2: [] };
  for (const r of data.records || []) {
    if (!ud[r.PriceArea]) continue;
    ud[r.PriceArea].push({
      time: Number(r.HourDK.slice(11, 13)),
      pris: +(r.SpotPriceDKK / 1000).toFixed(4), // datasættet er kr/MWh
    });
  }
  return { priser: ud, raa: data };
}

/* ----------------------------------------------------------- brændstof */

/*
 * Energi Data Service svarede 200 med nul records på et ellers gyldigt
 * døgn. Vi skal se, hvad datasættet overhovedet indeholder, og om
 * elprisenligenu.dk er en nemmere vej.
 */
async function probeEl() {
  console.log("### ELPRISER");

  const forsoeg = [
    ["nyeste records uden filter",
      "https://api.energidataservice.dk/dataset/Elspotprices?limit=3&sort=HourDK%20DESC"],
    ["i dag, kun dato-filter",
      `https://api.energidataservice.dk/dataset/Elspotprices?limit=3&start=${dato()}&end=${dato(1)}`],
    ["elprisenligenu",
      `https://www.elprisenligenu.dk/api/v1/prices/${dato().slice(0, 4)}/${dato().slice(5, 7)}-${dato().slice(8, 10)}_DK1.json`],
  ];

  for (const [navn, url] of forsoeg) {
    try {
      const data = await hent(url, { json: true });
      const kort = JSON.stringify(data);
      console.log(`   ${navn}: ${kort.slice(0, 700)}`);
    } catch (err) {
      console.log(`   ${navn}: FEJL ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 1500)); // API'et svarer 429 ved hurtige kald
  }
}

const OK_SIDE = "https://www.ok.dk/privat/produkter/benzinkort/prisudvikling";

/*
 * OK's prisside henter selv tallene bagfra. Første probe viste, at siden
 * indeholder produktlisten (Blyfri 95 = varenr 536, Diesel = 231), så nu
 * leder vi efter det endepunkt, den kalder med de varenumre.
 */
/*
 * Prisudviklingssiden henter tallene med JavaScript, så endepunktet står
 * ikke i HTML'en. OK har til gengæld sider, der viser dagens pris direkte
 * — dem kigger vi efter her.
 */
async function probeBraendstof() {
  const sider = [
    "https://www.ok.dk/privat/hjaelp/bilen/benzinpriser",
    "https://www.ok.dk/privat/produkter/ok-kort/benzinpriser",
    OK_SIDE,
  ];

  for (const url of sider) {
    console.log(`\n=== ${url}`);
    try {
      const html = await hent(url);
      const tekst = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");

      // Kontekst omkring hvert pris-lignende tal i den synlige tekst
      const fundet = [];
      for (const m of tekst.matchAll(/\b(\d{1,2}[.,]\d{2})\b/g)) {
        const n = Number(m[1].replace(",", "."));
        if (n < 7 || n > 22) continue;
        fundet.push(tekst.slice(Math.max(0, m.index - 90), m.index + 40).replace(/\s+/g, " "));
      }
      console.log(`   ${fundet.length} pris-lignende tal i teksten`);
      fundet.slice(0, 12).forEach((f) => console.log(`     … ${f}`));

      // Og i scripts: JSON der nævner en pris sammen med et varenummer
      for (const m of html.matchAll(/\{[^{}]{0,200}(?:"pris"|"price"|varenr)[^{}]{0,200}\}/gi)) {
        console.log(`   json: ${m[0].slice(0, 200)}`);
      }
    } catch (err) {
      console.log(`   FEJL: ${err.message}`);
    }
  }
}

/* ------------------------------------------------------------------ kør */

async function main() {
  if (PROBE) {
    await probeEl();
    console.log("\n### BRÆNDSTOF");
    await probeBraendstof();
    return;
  }

  const ud = {
    opdateret: new Date().toISOString(),
    el: { dato: dato(), DK1: null, DK2: null },
    braendstof: null,
  };

  const { priser } = await elpriser(ud.el.dato);
  ud.el.DK1 = priser.DK1;
  ud.el.DK2 = priser.DK2;
  console.log(`el: DK1 ${priser.DK1.length} timer, DK2 ${priser.DK2.length} timer`);
  if (!priser.DK1.length) throw new Error("ingen elpriser for " + ud.el.dato);

  await mkdir(dirname(UD), { recursive: true });
  await writeFile(UD, JSON.stringify(ud, null, 2) + "\n");
  console.log(`skrevet ${UD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
