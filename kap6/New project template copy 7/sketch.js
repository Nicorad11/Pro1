let a = 2;
let b = 3;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background(220);

  console.log(a + "+" + b + "=" + sum(a, b));
}

function sum(a, b) {
  return a + b;
}
