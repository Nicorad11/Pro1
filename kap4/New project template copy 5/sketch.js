let w = window.innerWidth; //W,H = størrelsen på vinduet//
let h = window.innerHeight;
let xPos;
let yPos;
let speed;
let a;
let b;
let d = 80;

function preload() {
  img = loadImage("Mouse.png");
  img2 = loadImage("AngryCat.png");
}

function setup() {
  createCanvas(w, h);
  //Win-inner = top & bottom//
  xPos = random(0, width);
  yPos = random(0, height);
  speed = 5;
  a = speed;
  b = 0;
}

function draw() {
  background(220);

  image(img, xPos, yPos, d, d);
  xPos += a;
  yPos += b;
  borderCheck(); //Function bordercheck= når img rammer border ændres speed,x- & yPos//
}

function borderCheck() {
  if (xPos + d / 2 >= width) {
    a = -speed;
    b = 0;
  }
  if (xPos - d / 2 <= -10) {
    a = speed;
    b = 0;
  }
  if (yPos + d / 2 >= height) {
    a = 0;
    b = -speed;
  }
  if (yPos - d / 2 < 0) {
    a = 0;
    b = speed;
  }
}

function keyPressed() {
  if (keyCode === DOWN_ARROW) {
    b = speed; //if keypressed = Speed bliver positiv//
    2;
    a = 0;
  }
  if (keyCode === UP_ARROW) {
    b = -speed; //if keypressed = Speed bliver negativ//
    2;
    a = 0;
  }
  if (keyCode === LEFT_ARROW) {
    b = 0;
    a = -speed;
    2;
  }
  if (keyCode === RIGHT_ARROW) {
    b = 0;
    a = speed;
    2;
  }
}

function cat() {
  background(220);
  image(img2, xPos, yPos, d, d);
  xPos += a;
  yPos += b;
  borderCheck();
}

function mus() {
  //function virker ikke//
  if (keyCode === LEFT_ARROW) {
    img2 = scave(-1, 1);
  }
}
