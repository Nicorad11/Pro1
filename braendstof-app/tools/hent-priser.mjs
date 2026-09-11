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

const OK_SIDE = "https://www.ok.dk/privat/produkter/benzinkort/prisudvikling";

/*
 * OK's prisside henter selv tallene bagfra. Første probe viste, at siden
 * indeholder produktlisten (Blyfri 95 = varenr 536, Diesel = 231), så nu
 * leder vi efter det endepunkt, den kalder med de varenumre.
 */
async function probeBraendstof() {
  console.log(`\n=== ok.dk — ${OK_SIDE}`);
  const html = await hent(OK_SIDE);
  console.log(`   længde: ${html.length}`);

  // Hele settings-objektet, som produktlisten lå i
  const s = html.match(/var settings = (\{.*?\});<\/script>/s);
  console.log("   settings: " + (s ? s[1].slice(0, 2000) : "ikke fundet"));

  // Alt der ligner et endepunkt
  const urls = new Set();
  for (const m of html.matchAll(/["'](\/[A-Za-z0-9_\-/.]*(?:api|pris|price|graph|chart|data)[A-Za-z0-9_\-/.]*)["']/gi)) {
    urls.add(m[1]);
  }
  console.log("   mulige endepunkter:\n     " + [...urls].slice(0, 40).join("\n     "));

  // Felter der ligner en url i konfigurationen
  for (const m of html.matchAll(/\\?"(\w*(?:[Uu]rl|[Ee]ndpoint|[Aa]ction))\\?":\\?"([^"\\]{4,120})/g)) {
    console.log(`   ${m[1]} = ${m[2]}`);
  }
}

/* ------------------------------------------------------------------ kør */

async function main() {
  if (PROBE) {
    console.log("### ELPRISER");
    try {
      const { priser, raa } = await elpriser(dato());
      console.log(`   total records: ${(raa.records || []).length}`);
      console.log(`   første record: ${JSON.stringify((raa.records || [])[0])}`);
      console.log(`   DK1: ${priser.DK1.length} timer, DK2: ${priser.DK2.length} timer`);
    } catch (err) {
      console.log(`   FEJL ${err.message}`);
    }
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
