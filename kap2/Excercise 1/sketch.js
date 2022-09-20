var x = 200;
var y = 200;
function setup() { 
  createCanvas(400, 400);
} 

function draw() { 
  background(225);
  fill(0);
  rect(x,y,33,50);   
  if (x >= 400){
   x = 0; 
  }
  if (keyCode === UP_ARROW) {
    y = y - 1;
  } else if (keyCode === DOWN_ARROW) {
   y = y + 1;
  }
  if (keyCode === LEFT_ARROW) {
    x = x - 1;
  } else if (keyCode === RIGHT_ARROW) {
    x = x + 1;
  }
}