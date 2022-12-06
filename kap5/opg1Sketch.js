function setup() {
  let i = 0;
  createCanvas(400, 400);
  while (i < 100) {
    let x = random(400);
    let y = random(400);
    let r = random(100);
    circle(x, y, r);
    text(i, x, y);
    i = i + 1;
  }
} //Der bliver dannet en tilfældig mængde af cirkler mellem 0-100,
//Cirklerne får angivet et tilfældigt
