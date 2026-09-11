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

const OK_PRISSIDE = "https://www.ok.dk/privat/produkter/ok-kort/benzinpriser";

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
  const tekst = brødtekst(await hent(OK_PRISSIDE));

  const find = (ord) => {
    const m = tekst.match(new RegExp(ord + "\\s*(\\d{1,2}),(\\d{2})\\s*kr", "i"));
    return m ? Number(`${m[1]}.${m[2]}`) : null;
  };

  const benzin95 = find("Benzinpris");
  const diesel = find("Dieselpris");

  console.log(`   ok.dk: benzin ${benzin95}, diesel ${diesel}`);

  // Vis konteksten, så det er til at se i loggen, hvis siden skifter form
  const i = tekst.search(/Benzinpris/i);
  if (i > -1) console.log(`   kontekst: …${tekst.slice(Math.max(0, i - 120), i + 160)}…`);

  if (benzin95 === null && diesel === null) throw new Error("fandt ingen priser på siden");

  return {
    benzin95,
    diesel,
    kilde: "ok.dk",
    kildeUrl: OK_PRISSIDE,
    hentet: new Date().toISOString(),
  };
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
    braendstof: gammel ? gammel.braendstof : null,
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
    console.log(`brændstof: FEJL ${err.message} — beholder forrige`);
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
