/*
 * Henter aktuelle priser og skriver braendstof-app/data/priser.json.
 *
 * Kører i GitHub Actions, hvor der er fri netadgang. Appen læser filen fra
 * samme domæne som sig selv, så hverken CORS eller API-nøgler er i spil i
 * browseren — og det er den eneste vej til pumpepriserne, som ingen
 * udbyder leverer som åbent API.
 *
 * Kør med --probe for kun at vise, hvad kilderne svarer, uden at skrive
 * datafilen.
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
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

function dato(forskydDage = 0) {
  // Dansk dato, ikke UTC — ellers skifter døgnet to timer for tidligt.
  const nu = new Date(Date.now() + forskydDage * 86400000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(nu);
}

/* ------------------------------------------------------------------- el */

/*
 * elprisenligenu.dk leverer Nord Pools spotpriser gratis og uden nøgle.
 * (Energi Data Service' Elspotprices-datasæt blev undersøgt først, men det
 * er ikke opdateret siden 30. september 2025.)
 */
async function elpriser(omraade, dag) {
  const url =
    `https://www.elprisenligenu.dk/api/v1/prices/${dag.slice(0, 4)}/` +
    `${dag.slice(5, 7)}-${dag.slice(8, 10)}_${omraade}.json`;

  const data = await hent(url, { json: true });
  if (!Array.isArray(data)) throw new Error("uventet svar");

  return data.map((p) => ({
    time: Number(p.time_start.slice(11, 13)), // allerede dansk lokaltid
    pris: +Number(p.DKK_per_kWh).toFixed(4),
  }));
}

/* ----------------------------------------------------------- brændstof */

/*
 * Selskaber der udgiver deres dagspris. OK's benzinprisside blev forsøgt
 * først, men tallene dér viste sig at være faste eksempelværdier i en
 * sammenligningsberegner ("Beregneren tager ikke højde for…"), ikke
 * dagens pris — derfor kom diesel hjem dyrere end benzin.
 */
const PRISKILDER = [
  { navn: "ingo", url: "https://www.ingo.dk/braendstofpriser" },
  { navn: "circlek-api", url: "https://www.circlek.dk/api/prices", json: true },
  { navn: "f24", url: "https://www.f24.dk/priser/" },
  { navn: "shell", url: "https://www.shell.dk/bilister/braendstofpriser.html" },
  { navn: "ok-liste", url: "https://www.ok.dk/privat/produkter/benzinkort/listepriser" },
];

/** Synlig tekst uden scripts og tags — nemmere at finde priser i. */
function brødtekst(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

/*
 * OK skriver dagens listepriser i klartekst på deres benzinprisside:
 * "Benzinpris 14,89 kr. pr. liter Dieselpris 16,59 kr. pr. liter".
 * Ingen af selskaberne har et åbent API, så det er den vej der er.
 */
async function braendstofpriser() {
  for (const kilde of PRISKILDER) {
    console.log(`\n   --- ${kilde.navn}: ${kilde.url}`);
    try {
      const svar = await hent(kilde.url, { json: kilde.json });
      if (kilde.json) {
        console.log(`   json: ${JSON.stringify(svar).slice(0, 800)}`);
        continue;
      }

      const tekst = brødtekst(svar);
      console.log(`   tekstlængde: ${tekst.length}`);

      let fundet = 0;
      for (const m of tekst.matchAll(/\b(\d{1,2}),(\d{2})\b/g)) {
        const n = Number(`${m[1]}.${m[2]}`);
        if (n < 8 || n > 20 || fundet >= 10) continue;
        fundet++;
        console.log(`   ${n}: …${tekst.slice(Math.max(0, m.index - 110), m.index + 60)}…`);
      }
      if (!fundet) console.log("   ingen pris-lignende tal i teksten");
    } catch (err) {
      console.log(`   FEJL: ${err.message}`);
    }
  }

  throw new Error("ingen bekræftet kilde til pumpepriser endnu");
}

/* ------------------------------------------------------------------ kør */

/** Det der allerede står i datafilen — så en kilde der fejler ikke sletter data. */
async function tidligere() {
  try {
    return JSON.parse(await readFile(UD, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const gammel = await tidligere();
  const ud = {
    opdateret: new Date().toISOString(),
    el: { dato: dato(), DK1: null, DK2: null },
    braendstof: null,
  };

  for (const omraade of ["DK1", "DK2"]) {
    ud.el[omraade] = await elpriser(omraade, ud.el.dato);
    console.log(`el ${omraade}: ${ud.el[omraade].length} timepriser`);
  }
  if (!ud.el.DK1.length) throw new Error("ingen elpriser for " + ud.el.dato);

  // Pumpepriserne må gerne fejle uden at vælte kørslen — elpriserne er
  // det vigtigste, og den gamle brændstofpris er bedre end ingen.
  try {
    ud.braendstof = await braendstofpriser();
  } catch (err) {
    // Behold gårsdagens pris, men kun hvis den kom fra en kilde vi
    // stadig bruger — så ryger tal fra en forkastet kilde af sig selv.
    const g = gammel && gammel.braendstof;
    const stadigGyldig = g && PRISKILDER.some((k) => k.navn === g.kilde);
    ud.braendstof = stadigGyldig ? g : null;
    console.log(`brændstof: ${err.message}${stadigGyldig ? " — beholder forrige" : ""}`);
  }

  if (PROBE) {
    console.log("\n(probe — skriver ikke datafilen)");
    console.log(JSON.stringify({ ...ud, el: { ...ud.el, DK1: ud.el.DK1.slice(0, 3) } }, null, 2));
    return;
  }

  await mkdir(dirname(UD), { recursive: true });
  await writeFile(UD, JSON.stringify(ud, null, 2) + "\n");
  console.log(`skrevet ${UD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
