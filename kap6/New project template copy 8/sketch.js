let x = 200;
let y = 200;
let r = 100;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background(220);
  let c = color(255, 204, 0);
  fill(c);
  noStroke();
  ellipse(x, y, r, 100);
}
