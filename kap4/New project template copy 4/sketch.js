let x;
let justHitRightWall;
let xspeed = 3;

function setup() {
  createCanvas(400, 400);
  x = width / 2;
}

function draw() {
  background(220);
  if (x > width - 22 || x < 0 + 25) {
    xspeed *= -1;
  }

  //Move
  x += xspeed;
  circle(x, height / 8, 30, 50);

  if (mousePressed) {
    pointX = mouseX;
    pointY = mouseY;
    print(pointX, pointY);
    line(posX, pointX, pointY);
  }
}
