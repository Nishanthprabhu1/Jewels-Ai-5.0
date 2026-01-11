const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');

const earringImg = new Image();
earringImg.src = 'earrings/earring1.png'; // default

function changeEarring(filename) {
  earringImg.src = `earrings/${filename}`;
  console.log("Switching to:", filename);
  earringImg.onload = () => console.log("Image loaded:", filename);
  earringImg.onerror = () => console.log("Failed to load:", filename);
}

const faceMesh = new FaceMesh({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
});

faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

let leftEarPositions = [];
let rightEarPositions = [];

function smooth(positions) {
  if (positions.length === 0) return null;
  const sum = positions.reduce((acc, pos) => ({ x: acc.x + pos.x, y: acc.y + pos.y }), { x: 0, y: 0 });
  return {
    x: sum.x / positions.length,
    y: sum.y / positions.length
  };
}

faceMesh.onResults((results) => {
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  if (results.multiFaceLandmarks.length > 0) {
    const landmarks = results.multiFaceLandmarks[0];

    const offsetY = 20;  // Move earrings up by 20 pixels

    const left = {
      x: landmarks[132].x * canvasElement.width,
      y: landmarks[132].y * canvasElement.height - offsetY,
    };
    const right = {
      x: landmarks[361].x * canvasElement.width,
      y: landmarks[361].y * canvasElement.height - offsetY,
    };

    leftEarPositions.push(left);
    rightEarPositions.push(right);
    if (leftEarPositions.length > 5) leftEarPositions.shift();
    if (rightEarPositions.length > 5) rightEarPositions.shift();

    const leftSmooth = smooth(leftEarPositions);
    const rightSmooth = smooth(rightEarPositions);

    if (earringImg.complete) {
      if (leftSmooth) canvasCtx.drawImage(earringImg, leftSmooth.x - 30, leftSmooth.y, 60, 70);
      if (rightSmooth) canvasCtx.drawImage(earringImg, rightSmooth.x - 20, rightSmooth.y, 60, 70);
    }
  }
});

const camera = new Camera(videoElement, {
  onFrame: async () => {
    await faceMesh.send({ image: videoElement });
  },
  width: 1280,
  height: 720,
});
camera.start();

videoElement.addEventListener('loadedmetadata', () => {
  canvasElement.width = videoElement.videoWidth;
  canvasElement.height = videoElement.videoHeight;
});
