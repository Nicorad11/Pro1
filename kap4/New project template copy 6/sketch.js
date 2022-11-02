function setup() {
  createCanvas(400, 400);
}

function draw() {
  background(237, 34, 93);
  fill(200);
  for (let i = 0; i < 400; i++) {
    let r = random(-300, 300);
    line(200, i, 200 + r, i);
  }
}
