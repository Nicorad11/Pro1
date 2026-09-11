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

function dato(forskydDage = 0) {
  const d = new Date(Date.now() + forskydDage * 86400000);
  return d.toISOString().slice(0, 10);
}

/** Spotpriser pr. time for ét prisområde, kr/kWh uden moms. */
async function elpriser(omraade, dag) {
  const url =
    "https://api.energidataservice.dk/dataset/Elspotprices" +
    `?start=${dag}T00:00&end=${dag}T23:59` +
    `&filter=${encodeURIComponent(JSON.stringify({ PriceArea: [omraade] }))}` +
    "&sort=HourDK%20ASC&limit=100";

  const data = await hent(url, { json: true });
  const rk = data.records || [];
  return rk.map((r) => ({
    time: Number(r.HourDK.slice(11, 13)),
    pris: +(r.SpotPriceDKK / 1000).toFixed(4), // datasættet er kr/MWh
  }));
}

/* ----------------------------------------------------------- brændstof */

// Kandidater til pumpepriser. Vi ved endnu ikke, hvilke der svarer med
// noget brugbart — probe-kørslen viser det i loggen.
const BRAENDSTOF_KILDER = [
  { navn: "circlek", url: "https://www.circlek.dk/priser" },
  { navn: "ok", url: "https://www.ok.dk/privat/produkter/benzinkort/prisudvikling" },
  { navn: "q8", url: "https://www.q8.dk/da-dk/privat/priser" },
  { navn: "shell", url: "https://www.shell.dk/bilister/shell-braendstof/braendstofpriser.html" },
  { navn: "goon", url: "https://goon.nu/priser/" },
];

async function probeBraendstof() {
  for (const kilde of BRAENDSTOF_KILDER) {
    console.log(`\n=== ${kilde.navn} — ${kilde.url}`);
    try {
      const html = await hent(kilde.url);
      console.log(`   længde: ${html.length}`);

      // Find alt der ligner en literpris: 8-20 kr med komma eller punktum.
      const priser = [...html.matchAll(/\b(\d{1,2})[.,](\d{2})\b/g)]
        .map((m) => Number(`${m[1]}.${m[2]}`))
        .filter((n) => n >= 7 && n <= 22);
      console.log(`   pris-lignende tal: ${[...new Set(priser)].slice(0, 30).join(", ")}`);

      // Vis konteksten omkring ord vi forventer at finde prisen nær
      for (const ord of ["Blyfri", "Oktan 95", "95", "Diesel", "diesel"]) {
        const i = html.indexOf(ord);
        if (i > -1) {
          console.log(
            `   "${ord}" @ ${i}: ` +
              JSON.stringify(html.slice(Math.max(0, i - 120), i + 220).replace(/\s+/g, " "))
          );
        }
      }
    } catch (err) {
      console.log(`   FEJL: ${err.message}`);
    }
  }
}

/* ------------------------------------------------------------------ kør */

async function main() {
  if (PROBE) {
    console.log("### ELPRISER");
    for (const omraade of ["DK1", "DK2"]) {
      try {
        const p = await elpriser(omraade, dato());
        console.log(`${omraade} i dag: ${p.length} timer, fx ${JSON.stringify(p.slice(0, 3))}`);
      } catch (err) {
        console.log(`${omraade}: FEJL ${err.message}`);
      }
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

  for (const omraade of ["DK1", "DK2"]) {
    ud.el[omraade] = await elpriser(omraade, dato());
    console.log(`${omraade}: ${ud.el[omraade].length} timepriser`);
  }

  await mkdir(dirname(UD), { recursive: true });
  await writeFile(UD, JSON.stringify(ud, null, 2) + "\n");
  console.log(`skrevet ${UD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
