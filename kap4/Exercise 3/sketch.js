function setup() { 
  createCanvas(600, 400);
} 

function draw() { 
  background(220);
  fill(255,0,0);
  noStroke();
  if (mouseX < width/3) {
    rect(0, 0, width/3, height);
    //Hvis mouseX <1/3 af canvas fill 1/3 rect(255,0,0)
  }
  else if (mouseX <= width*2/3) {
    rect(width/3, 0, width/3, height);
  }// Medmindre mouseX 2/3 rect(255,0,0)
  else {
    rect(width*2/3, 0, width/3, height);
  }
}