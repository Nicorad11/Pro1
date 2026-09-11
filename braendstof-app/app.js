/*
 * El eller benzin? — beregner prisen pr. kilometer for en elbil og en
 * benzinbil, med dagens spotpriser på el.
 *
 * Priserne kommer fra data/priser.json, som en GitHub Action opdaterer to
 * gange i døgnet: spotpriser fra elprisenligenu.dk og pumpepriser fra
 * ok.dk. Findes filen ikke, hentes spotpriserne direkte fra
 * elprisenligenu.dk, og brændstofprisen taster man selv ind.
 */

const STORAGE_KEY = "braendstof-app.v1";
const MOMS = 1.25;

/* --------------------------------------------------------------- tilstand */

const defaults = {
  ladeSted: "hjemme",
  harValgtLadeSted: false,
  region: "DK1",
  spotValg: "now",
  tillaeg: 1.4,
  moms: true,
  fastPris: 2.5,
  laderPris: 4.5,
  braendstof: "benzin",
  benzinPris: 13.79,
  benzinPrisOpdateret: null,
  benzinPrisEgen: false, // true når brugeren selv har rettet prisen
  elForbrug: 17,
  ladetab: 10,
  benzinForbrug: 18,
  forbrugsEnhed: "kmpl",
  kmPerAar: 15000,
};

const state = Object.assign({}, defaults, load());

/** Spotpriser for i dag: [{hour, dkkExMoms}] — tom indtil de er hentet. */
let spot = { timer: [], kilde: null, fejl: null, henter: false };

/** Brændstofpriserne fra datafilen: {benzin95, diesel, kilde, hentet}. */
let braendstofKilde = null;

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (err) {
    return {};
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    /* privat browsing e.l. — så husker vi bare ikke noget */
  }
}

/* ---------------------------------------------------------------- elementer */

const el = (id) => document.getElementById(id);

const felter = {
  region: el("region"),
  spotValg: el("spotValg"),
  tillaeg: el("tillaeg"),
  moms: el("moms"),
  fastPris: el("fastPris"),
  laderPris: el("laderPris"),
  benzinPris: el("benzinPris"),
  elForbrug: el("elForbrug"),
  ladetab: el("ladetab"),
  benzinForbrug: el("benzinForbrug"),
  forbrugsEnhed: el("forbrugsEnhed"),
  kmPerAar: el("kmPerAar"),
};

/* ---------------------------------------------------------------- hentning */

function datoDele(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return { aar: d.getFullYear(), md: p(d.getMonth() + 1), dag: p(d.getDate()) };
}

/*
 * Priserne fra vores egen datafil, som en GitHub Action opdaterer et par
 * gange i døgnet. Den ligger på samme domæne som appen, så den virker
 * også dér, hvor browseren spærrer for kald til fremmede domæner — og
 * det er den eneste vej til pumpepriserne.
 */
async function hentDatafil() {
  const svar = await fetch("data/priser.json", { cache: "no-cache" });
  if (!svar.ok) throw new Error("datafil " + svar.status);
  return svar.json();
}

/** Brændstofpriserne fra datafilen, hvis der er nogen. */
function brugBraendstof(data) {
  const b = data && data.braendstof;
  if (!b) return;

  braendstofKilde = b;
  const pris = state.braendstof === "diesel" ? b.diesel : b.benzin95;

  // Brugerens egen pris vinder altid over den hentede.
  if (typeof pris === "number" && !state.benzinPrisEgen) {
    state.benzinPris = pris;
    state.benzinPrisOpdateret = Date.parse(b.hentet) || Date.now();
    felter.benzinPris.value = pris;
    save();
  }
}

async function hentElprisenLigeNu(region) {
  const { aar, md, dag } = datoDele();
  const url = `https://www.elprisenligenu.dk/api/v1/prices/${aar}/${md}-${dag}_${region}.json`;
  const svar = await fetch(url);
  if (!svar.ok) throw new Error("elprisenligenu svarede " + svar.status);

  const data = await svar.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error("tomt svar");

  return data.map((p) => ({
    hour: new Date(p.time_start).getHours(),
    dkkExMoms: p.DKK_per_kWh,
  }));
}

async function hentSpotpriser() {
  spot.henter = true;
  spot.fejl = null;
  opdater();

  const region = state.region;
  const iDag = new Date().toISOString().slice(0, 10);
  const forsoeg = [
    // Egen datafil først: den har også brændstofpriserne, og den virker
    // uanset om browseren tillader kald til fremmede domæner.
    async () => {
      const data = await hentDatafil();
      brugBraendstof(data);
      const timer = data.el && data.el[region];
      if (!timer || !timer.length) throw new Error("ingen elpriser i datafilen");
      if (data.el.dato !== iDag) throw new Error("datafilen er fra " + data.el.dato);
      spot.kilde = "elprisenligenu.dk";
      return timer.map((t) => ({ hour: t.time, dkkExMoms: t.pris }));
    },
    // Direkte fra kilden, hvis datafilen ikke er der (åbner man index.html
    // som en løs fil, er der ingen datafil at hente).
    async () => {
      spot.kilde = "elprisenligenu.dk";
      return hentElprisenLigeNu(region);
    },
  ];

  const grunde = [];
  spot.timer = [];
  for (const forsoegt of forsoeg) {
    try {
      spot.timer = await forsoegt();
      break;
    } catch (err) {
      grunde.push(err.message);
    }
  }

  if (spot.timer.length === 0) {
    spot.kilde = null;
    spot.fejl = "Kunne ikke hente spotpriser lige nu (" + grunde.join("; ") + ").";
  }

  // Uden spotpriser kan appen ikke regne på el. Har brugeren ikke selv valgt,
  // hvor der lades, så stil om til en fast pris — så virker beregneren
  // stadig, i stedet for at stå med to tomme felter.
  if (spot.fejl && !state.harValgtLadeSted && state.ladeSted === "hjemme") {
    state.ladeSted = "fast";
    visLadePanel();
  }

  spot.henter = false;
  opdater();
}

/* ----------------------------------------------------------------- regning */

/** Spotprisen (kr/kWh uden moms) ud fra brugerens valg, eller null. */
function valgtSpot() {
  if (spot.timer.length === 0) return null;
  const priser = spot.timer.map((t) => t.dkkExMoms);

  if (state.spotValg === "avg") {
    return priser.reduce((a, b) => a + b, 0) / priser.length;
  }
  if (state.spotValg === "cheapest3") {
    const tre = priser.slice().sort((a, b) => a - b).slice(0, 3);
    return tre.reduce((a, b) => a + b, 0) / tre.length;
  }
  const nu = spot.timer.find((t) => t.hour === new Date().getHours());
  return nu ? nu.dkkExMoms : priser[priser.length - 1];
}

/** Alt-inkl. pris pr. kWh, eller null hvis spotprisen mangler. */
function elPrisPerKwh() {
  if (state.ladeSted === "fast") return state.fastPris;
  if (state.ladeSted === "lader") return state.laderPris;

  const s = valgtSpot();
  if (s === null) return null;
  return (s + state.tillaeg) * (state.moms ? MOMS : 1);
}

/** Elbilens forbrug fra stikkontakten, kWh pr. km — ladetab medregnet. */
function elKwhPerKm() {
  return (state.elForbrug / 100) * (1 + state.ladetab / 100);
}

function kmPerLiter() {
  if (state.forbrugsEnhed === "l100") {
    return state.benzinForbrug > 0 ? 100 / state.benzinForbrug : 0;
  }
  return state.benzinForbrug;
}

function beregn() {
  const kwhPris = elPrisPerKwh();
  const kmpl = kmPerLiter();

  const elKm = kwhPris === null ? null : kwhPris * elKwhPerKm();
  const benzinKm = kmpl > 0 ? state.benzinPris / kmpl : null;

  return {
    kwhPris,
    kmpl,
    elKm,
    benzinKm,
    // Vendepunkter: hvad skal den anden pris være, før de er lige dyre?
    beBenzinPrLiter: elKm === null ? null : elKm * kmpl,
    beElPrKwh: benzinKm === null ? null : benzinKm / elKwhPerKm(),
  };
}

/* -------------------------------------------------------------- formatering */

const kr = (n, d = 2) =>
  n === null || !isFinite(n)
    ? "–"
    : new Intl.NumberFormat("da-DK", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      }).format(n) + " kr";

const tal = (n, d = 0) =>
  n === null || !isFinite(n)
    ? "–"
    : new Intl.NumberFormat("da-DK", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      }).format(n);

/* --------------------------------------------------------------- visningen */

function opdater() {
  const r = beregn();
  const braendstofNavn = state.braendstof === "diesel" ? "Diesel" : "Benzin";

  el("benzinCardTitle").textContent = braendstofNavn;

  el("elPerKm").textContent = r.elKm === null ? "–" : tal(r.elKm, 2);
  el("benzinPerKm").textContent = r.benzinKm === null ? "–" : tal(r.benzinKm, 2);

  el("elPer100km").textContent = r.elKm === null ? "–" : kr(r.elKm * 100, 0);
  el("benzinPer100km").textContent = r.benzinKm === null ? "–" : kr(r.benzinKm * 100, 0);

  el("elKmPer100kr").textContent = r.elKm > 0 ? tal(100 / r.elKm, 0) + " km" : "–";
  el("benzinKmPer100kr").textContent = r.benzinKm > 0 ? tal(100 / r.benzinKm, 0) + " km" : "–";

  el("elPrisKwhUd").textContent = r.kwhPris === null ? "–" : kr(r.kwhPris, 2);
  el("benzinPrisLiterUd").textContent = kr(state.benzinPris, 2);

  el("beBenzin").textContent = r.beBenzinPrLiter === null ? "–" : kr(r.beBenzinPrLiter, 2) + "/l";
  el("beEl").textContent = r.beElPrKwh === null ? "–" : kr(r.beElPrKwh, 2) + "/kWh";

  visBanner();
  visDom(r, braendstofNavn);
  visAarsTal(r);
  visSpot();
  tegnGraf();
  visPrisAlder();
}

/* Sig det tydeligt, hvis tallene ikke bygger på dagens spotpriser. */
function visBanner() {
  const b = el("banner");
  if (!spot.fejl) {
    b.className = "banner hidden";
    return;
  }
  b.className = "banner";
  b.textContent =
    state.ladeSted === "hjemme"
      ? "Dagens elpriser kunne ikke hentes. Vælg „Fast aftale“ og tast din egen pris."
      : "Dagens elpriser kunne ikke hentes — beregningen bruger prisen, du selv har tastet ind.";
}

function visDom(r, braendstofNavn) {
  const kortEl = document.querySelector(".card-el");
  const kortBenzin = document.querySelector(".card-benzin");
  kortEl.classList.remove("winner");
  kortBenzin.classList.remove("winner");

  if (r.elKm === null || r.benzinKm === null) {
    const sub = el("verdictSub");
    if (spot.henter) {
      el("verdictHeadline").textContent = "Henter elpriser …";
      sub.textContent = "";
      sub.className = "verdict-sub";
    } else if (spot.fejl) {
      el("verdictHeadline").textContent = "Kan ikke hente elprisen";
      sub.textContent =
        spot.fejl + " Vælg „Fast aftale“ herunder og tast din egen pris, " +
        "så regner appen videre.";
      sub.className = "verdict-sub error";
    } else {
      el("verdictHeadline").textContent = "Udfyld tallene";
      sub.textContent = "";
      sub.className = "verdict-sub";
    }
    return;
  }

  const billigst = r.elKm < r.benzinKm ? "el" : "benzin";
  const dyrest = billigst === "el" ? r.benzinKm : r.elKm;
  const lav = billigst === "el" ? r.elKm : r.benzinKm;
  const procent = lav > 0 ? ((dyrest - lav) / dyrest) * 100 : 0;

  (billigst === "el" ? kortEl : kortBenzin).classList.add("winner");

  el("verdictHeadline").textContent =
    billigst === "el"
      ? `El er billigst — ${tal(procent, 0)} % under ${braendstofNavn.toLowerCase()}`
      : `${braendstofNavn} er billigst — ${tal(procent, 0)} % under el`;

  el("verdictSub").className = "verdict-sub";
  el("verdictSub").textContent =
    `Forskel: ${kr(Math.abs(r.benzinKm - r.elKm) * 100, 0)} pr. 100 km.`;
}

function visAarsTal(r) {
  if (r.elKm === null || r.benzinKm === null) {
    el("aarsBesparelse").textContent = "–";
    return;
  }
  const forskel = Math.abs(r.benzinKm - r.elKm) * state.kmPerAar;
  const vinder = r.elKm < r.benzinKm ? "på el" : "på brændstof";
  el("aarsBesparelse").textContent = `du sparer ${kr(forskel, 0)} om året ${vinder}`;
}

function visSpot() {
  const ud = el("spotReadout");
  if (spot.henter) {
    ud.textContent = "henter …";
    ud.className = "readout";
    return;
  }
  if (spot.fejl) {
    ud.textContent = "ingen data — brug en fast pris i stedet";
    ud.className = "readout error";
    return;
  }
  const s = valgtSpot();
  if (s === null) {
    ud.textContent = "–";
    return;
  }
  ud.className = "readout";
  ud.textContent = `${kr(s, 2)}/kWh uden moms og tillæg · ${spot.kilde}`;
}

function tegnGraf() {
  const graf = el("chart");
  const note = el("chartNote");
  graf.innerHTML = "";

  if (spot.timer.length === 0) {
    note.textContent = spot.fejl || "";
    return;
  }

  const faktor = state.moms ? MOMS : 1;
  const alt = spot.timer.map((t) => (t.dkkExMoms + state.tillaeg) * faktor);
  const maks = Math.max(...alt);
  const min = Math.min(...alt);
  const nuTime = new Date().getHours();
  const billigsteTime = spot.timer[alt.indexOf(min)].hour;

  spot.timer.forEach((t, i) => {
    const bar = document.createElement("div");
    bar.className = "bar";
    if (t.hour === billigsteTime) bar.classList.add("cheap");
    if (t.hour === nuTime) bar.classList.add("now");
    bar.style.height = Math.max(2, (alt[i] / maks) * 100) + "%";
    if (t.hour % 6 === 0) bar.dataset.label = t.hour;
    bar.title = `Kl. ${String(t.hour).padStart(2, "0")}: ${kr(alt[i], 2)}/kWh`;
    graf.appendChild(bar);
  });

  const kwhPerKm = elKwhPerKm();
  note.textContent =
    `Billigst kl. ${String(billigsteTime).padStart(2, "0")} til ${kr(min, 2)}/kWh ` +
    `(${kr(min * kwhPerKm * 100, 0)} pr. 100 km) — dyrest ${kr(maks, 2)}/kWh ` +
    `(${kr(maks * kwhPerKm * 100, 0)} pr. 100 km).`;
}

function visPrisAlder() {
  const ud = el("prisAlder");
  const dage = state.benzinPrisOpdateret
    ? Math.floor((Date.now() - state.benzinPrisOpdateret) / 86400000)
    : null;

  const alder =
    dage === null ? "" : dage < 1 ? "opdateret i dag" : dage === 1 ? "fra i går" : `${dage} dage gammel`;

  if (state.benzinPrisEgen) {
    ud.textContent = `Din egen pris${alder ? ", " + alder : ""}. Slet feltet og hent siden igen for at få den automatiske pris tilbage.`;
    return;
  }

  if (braendstofKilde) {
    ud.textContent = `Listepris fra ${braendstofKilde.kilde}, ${alder}. Din lokale tank kan afvige — ret bare tallet.`;
    return;
  }

  ud.textContent = "Ingen hentet pumpepris — tast din egen ind. Den bliver husket i browseren.";
}

/* --------------------------------------------------------------- hændelser */

function bindFelter() {
  Object.entries(felter).forEach(([navn, node]) => {
    if (!node) return;

    // Sæt feltet fra den gemte tilstand
    if (node.type === "checkbox") node.checked = state[navn];
    else node.value = state[navn];

    node.addEventListener("input", () => {
      if (node.type === "checkbox") {
        state[navn] = node.checked;
      } else if (node.type === "number") {
        const v = parseFloat(node.value);
        state[navn] = isNaN(v) ? 0 : v;
        if (navn === "benzinPris") {
          state.benzinPrisOpdateret = Date.now();
          state.benzinPrisEgen = true;
        }
      } else {
        state[navn] = node.value;
      }

      save();
      if (navn === "region") hentSpotpriser();
      else opdater();
    });
  });
}

function bindSegment(id, navn, efter) {
  const gruppe = el(id);
  gruppe.querySelectorAll("button").forEach((knap) => {
    const valgt = knap.dataset.value === state[navn];
    knap.classList.toggle("active", valgt);
    knap.setAttribute("aria-checked", String(valgt));

    knap.addEventListener("click", () => {
      state[navn] = knap.dataset.value;
      gruppe.querySelectorAll("button").forEach((k) => {
        const aktiv = k === knap;
        k.classList.toggle("active", aktiv);
        k.setAttribute("aria-checked", String(aktiv));
      });
      if (efter) efter();
      save();
      opdater();
    });
  });
}

function visLadePanel() {
  el("spotPanel").classList.toggle("hidden", state.ladeSted !== "hjemme");
  el("fastPanel").classList.toggle("hidden", state.ladeSted !== "fast");
  el("laderPanel").classList.toggle("hidden", state.ladeSted !== "lader");
}

/* ------------------------------------------------------------------ opstart */

bindFelter();
bindSegment("ladeSted", "ladeSted", () => {
  state.harValgtLadeSted = true; // så skifter appen ikke om under fødderne på dig
  visLadePanel();
});
bindSegment("braendstof", "braendstof", () => brugBraendstof({ braendstof: braendstofKilde }));
visLadePanel();
el("opdaterPriser").addEventListener("click", hentSpotpriser);

opdater();
hentSpotpriser();

// Skift af time ændrer "lige nu"-prisen — tjek en gang i minuttet.
let sidsteTime = new Date().getHours();
setInterval(() => {
  const t = new Date().getHours();
  if (t !== sidsteTime) {
    sidsteTime = t;
    if (t === 0) hentSpotpriser(); // nyt døgn, nye priser
    else opdater();
  }
}, 60000);
