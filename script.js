/* script.js - Jewels-Ai: Fixed Back Camera Mirroring & Positioning */

/* --- CONFIGURATION --- */
const DRIVE_API_KEY = "AIzaSyAXG3iG2oQjUA_BpnO8dK8y-MHJ7HLrhyE"; 
const UPLOAD_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzQ_NtdlyLxqsYib4V0qq-37O4RuBpAysHDqZDv7uPG7nlzgJDftc_frGDikDyRXqZF0A/exec";

const DRIVE_FOLDERS = {
  earrings: "1ySHR6Id5RxVj16-lf7NMN9I61RPySY9s",
  chains: "1BHhizdJ4MDfrqITTkynshEL9D0b1MY-J",
  rings: "1iB1qgTE-Yl7w-CVsegecniD_DzklQk90",
  bangles: "1d2b7I8XlhIEb8S_eXnRFBEaNYSwngnba"
};

/* --- ASSETS & STATE --- */
const JEWELRY_ASSETS = {};
const PRELOADED_IMAGES = {}; 
const watermarkImg = new Image(); watermarkImg.src = 'logo_watermark.png'; 

/* DOM Elements */
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');
const loadingStatus = document.getElementById('loading-status');
const voiceStatusText = document.getElementById('voice-status-text');
const flashOverlay = document.getElementById('flash-overlay');

/* App State */
let earringImg = null, necklaceImg = null, ringImg = null, bangleImg = null;
let currentType = ''; 
let isProcessingHand = false, isProcessingFace = false;
let lastGestureTime = 0;
const GESTURE_COOLDOWN = 800; 
let previousHandX = null;     

/* Camera State */
let currentFacingMode = 'user'; // 'user' (Front) or 'environment' (Back)

/* Gallery & Voice */
let currentLightboxIndex = 0;
let recognition = null;
let voiceEnabled = true;
let physics = { earringVelocity: 0, earringAngle: 0 };

/* Auto-Try & Gallery */
let autoTryRunning = false;
let autoSnapshots = [];
let autoTryIndex = 0;
let autoTryTimeout = null;
let currentPreviewData = { url: null, name: 'Jewels-Ai_look.png' }; 
let pendingDownloadAction = null; 

/* --- 1. VOICE RECOGNITION (SILENT) --- */
function initVoiceControl() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true; 
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        recognition.onstart = () => { 
            document.getElementById('voice-indicator').style.display = 'flex';
            if(voiceStatusText) voiceStatusText.innerText = "Listening...";
        };
        recognition.onresult = (event) => {
            const command = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
            if(voiceStatusText) voiceStatusText.innerText = `Heard: "${command}"`;
            processVoiceCommand(command);
            setTimeout(() => { if(voiceStatusText) voiceStatusText.innerText = "Listening..."; }, 2000);
        };
        recognition.onend = () => { 
            setTimeout(() => { try { recognition.start(); } catch(e) {} }, 500);
        };
        try { recognition.start(); } catch(e) {}
    }
}

function processVoiceCommand(cmd) {
    if (cmd.includes('next') || cmd.includes('change')) navigateJewelry(1);
    else if (cmd.includes('back') || cmd.includes('previous')) navigateJewelry(-1);
    else if (cmd.includes('photo') || cmd.includes('capture') || cmd.includes('snap')) takeSnapshot();
    else if (cmd.includes('gallery')) showGallery();
    else if (cmd.includes('earring')) selectJewelryType('earrings');
    else if (cmd.includes('chain') || cmd.includes('necklace')) selectJewelryType('chains');
    else if (cmd.includes('ring')) selectJewelryType('rings');
    else if (cmd.includes('bangle')) selectJewelryType('bangles');
}

/* --- 2. GOOGLE DRIVE FETCHING --- */
async function fetchFromDrive(category) {
    if (JEWELRY_ASSETS[category]) return;
    const folderId = DRIVE_FOLDERS[category];
    loadingStatus.style.display = 'block'; loadingStatus.textContent = "Fetching Designs...";

    try {
        const query = `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`;
        const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,thumbnailLink)&key=${DRIVE_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);

        JEWELRY_ASSETS[category] = data.files.map(file => {
            const src = file.thumbnailLink ? file.thumbnailLink.replace(/=s\d+$/, "=s3000") : `https://drive.google.com/uc?export=view&id=${file.id}`;
            return { id: file.id, name: file.name, src: src };
        });
        loadingStatus.style.display = 'none';
    } catch (err) { console.error("Drive Error:", err); loadingStatus.textContent = "Error Loading Images"; }
}

async function preloadCategory(type) {
    await fetchFromDrive(type);
    if (!JEWELRY_ASSETS[type]) return;
    if (!PRELOADED_IMAGES[type]) {
        PRELOADED_IMAGES[type] = [];
        const promises = JEWELRY_ASSETS[type].map(file => {
            return new Promise((resolve) => {
                const img = new Image(); img.crossOrigin = 'anonymous'; 
                img.onload = () => resolve(img); img.onerror = () => resolve(null); 
                img.src = file.src; PRELOADED_IMAGES[type].push(img);
            });
        });
        await Promise.all(promises);
    }
}

/* --- 3. CAMERA SWITCHING (FIXED) --- */
async function switchCamera(targetMode) {
    if (currentFacingMode === targetMode) return;
    
    currentFacingMode = targetMode; // Set immediately
    loadingStatus.style.display = 'block';
    loadingStatus.textContent = targetMode === 'user' ? "Front Camera..." : "Back Camera...";
    
    if (videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
    }

    try {
        // CSS Mirroring: Front=Mirror, Back=Normal
        if (targetMode === 'environment') videoElement.classList.add('no-mirror');
        else videoElement.classList.remove('no-mirror');

        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: targetMode } 
        });
        
        videoElement.srcObject = stream;
        videoElement.onloadeddata = () => { videoElement.play(); loadingStatus.style.display = 'none'; };
    } catch (err) {
        console.error("Camera switch failed:", err);
        alert("Camera Switch Error: " + err.name);
        loadingStatus.style.display = 'none';
    }
}

/* --- 4. UI & SELECTION --- */
async function selectJewelryType(type) {
  currentType = type;
  
  // Clear others
  if(type !== 'earrings') earringImg = null; 
  if(type !== 'chains') necklaceImg = null;
  if(type !== 'rings') ringImg = null; 
  if(type !== 'bangles') bangleImg = null;

  // SWITCH CAMERA BASED ON TYPE
  if (type === 'rings' || type === 'bangles') {
      await switchCamera('environment'); // Back Camera for Hands
  } else {
      await switchCamera('user'); // Front Camera for Face
  }

  await preloadCategory(type); 
  
  // Auto-Select First Item
  if (PRELOADED_IMAGES[type] && PRELOADED_IMAGES[type].length > 0) {
      const firstImg = PRELOADED_IMAGES[type][0];
      if (type === 'earrings') earringImg = firstImg;
      else if (type === 'chains') necklaceImg = firstImg;
      else if (type === 'rings') ringImg = firstImg;
      else if (type === 'bangles') bangleImg = firstImg;
  }

  const container = document.getElementById('jewelry-options');
  container.innerHTML = ''; container.style.display = 'flex';
  if (!JEWELRY_ASSETS[type]) return;
  JEWELRY_ASSETS[type].forEach((file, i) => {
    const btnImg = new Image(); btnImg.src = file.src; btnImg.crossOrigin = 'anonymous'; btnImg.className = "thumb-btn"; 
    btnImg.onclick = () => {
        const fullImg = PRELOADED_IMAGES[type][i];
        if (type === 'earrings') earringImg = fullImg;
        else if (type === 'chains') necklaceImg = fullImg;
        else if (type === 'rings') ringImg = fullImg;
        else if (type === 'bangles') bangleImg = fullImg;
    };
    container.appendChild(btnImg);
  });
}

function navigateJewelry(dir) {
  if (!currentType || !PRELOADED_IMAGES[currentType]) return;
  const list = PRELOADED_IMAGES[currentType];
  let currentImg = (currentType === 'earrings') ? earringImg : (currentType === 'chains') ? necklaceImg : (currentType === 'rings') ? ringImg : bangleImg;
  let idx = list.indexOf(currentImg); if (idx === -1) idx = 0; 
  let nextIdx = (idx + dir + list.length) % list.length;
  const nextItem = list[nextIdx];
  if (currentType === 'earrings') earringImg = nextItem;
  else if (currentType === 'chains') necklaceImg = nextItem;
  else if (currentType === 'rings') ringImg = nextItem;
  else if (currentType === 'bangles') bangleImg = nextItem;
}

/* --- 5. CAPTURE & GALLERY --- */
function captureToGallery() {
  const tempCanvas = document.createElement('canvas'); 
  tempCanvas.width = videoElement.videoWidth; tempCanvas.height = videoElement.videoHeight;
  const tempCtx = tempCanvas.getContext('2d');
  
  // FIX: Only mirror if Front Camera
  if (currentFacingMode === 'user') {
      tempCtx.translate(tempCanvas.width, 0); tempCtx.scale(-1, 1); 
  }
  
  tempCtx.drawImage(videoElement, 0, 0);
  // Reset for overlay
  tempCtx.setTransform(1, 0, 0, 1, 0, 0); 
  try { tempCtx.drawImage(canvasElement, 0, 0); } catch(e) {}
  
  const dataUrl = tempCanvas.toDataURL('image/png');
  autoSnapshots.push({ url: dataUrl, name: `Jewels-Ai_${Date.now()}.png` });
  
  // Update Gallery Button Icon
  const galBtn = document.getElementById('gallery-btn');
  if(galBtn) {
      galBtn.style.backgroundImage = `url(${dataUrl})`;
      galBtn.innerText = ''; 
  }
  return { url: dataUrl, name: `Jewels-Ai_${Date.now()}.png` }; 
}

function takeSnapshot() { 
    if(flashOverlay) {
        flashOverlay.classList.add('flash-active');
        setTimeout(() => flashOverlay.classList.remove('flash-active'), 300);
    }
    const shotData = captureToGallery(); currentPreviewData = shotData; 
    document.getElementById('preview-image').src = shotData.url; document.getElementById('preview-modal').style.display = 'flex'; 
}

/* --- 6. AR CORE (MIRROR FIX) --- */
function calculateAngle(p1, p2) { return Math.atan2(p2.y - p1.y, p2.x - p1.x); }

const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ maxNumHands: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
hands.onResults((results) => {
  isProcessingHand = false; 
  const w = canvasElement.width; const h = canvasElement.height;
  
  canvasCtx.save();
  
  // --- CRITICAL FIX: MIRRORING LOGIC ---
  if (currentFacingMode === 'user') {
      // Front Camera: Mirror
      canvasCtx.translate(w, 0); 
      canvasCtx.scale(-1, 1); 
  } else {
      // Back Camera: NO Mirror (Normal)
      canvasCtx.setTransform(1, 0, 0, 1, 0, 0); 
  }

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const lm = results.multiHandLandmarks[0];

      // --- RING (Knuckle Position) ---
      if (ringImg && ringImg.complete) {
          const mcp = { x: lm[13].x * w, y: lm[13].y * h }; 
          const pip = { x: lm[14].x * w, y: lm[14].y * h }; 
          const angle = calculateAngle(mcp, pip);
          const dist = Math.hypot(pip.x - mcp.x, pip.y - mcp.y);
          const rWidth = dist * 0.7; 
          const rHeight = (ringImg.height / ringImg.width) * rWidth;
          canvasCtx.save();
          canvasCtx.translate(mcp.x, mcp.y);
          canvasCtx.rotate(angle - (Math.PI / 2)); 
          // Offset UP (-0.1)
          canvasCtx.drawImage(ringImg, -rWidth/2, dist * -0.1, rWidth, rHeight);
          canvasCtx.restore();
      }

      // --- BANGLE (Forearm Position) ---
      if (bangleImg && bangleImg.complete) {
          const wrist = { x: lm[0].x * w, y: lm[0].y * h };
          const pinkyMcp = { x: lm[17].x * w, y: lm[17].y * h };
          const indexMcp = { x: lm[5].x * w, y: lm[5].y * h };
          const wristWidth = Math.hypot(pinkyMcp.x - indexMcp.x, pinkyMcp.y - indexMcp.y);
          const armAngle = calculateAngle(wrist, { x: lm[9].x * w, y: lm[9].y * h });
          const bWidth = wristWidth * 1.5; 
          const bHeight = (bangleImg.height / bangleImg.width) * bWidth;
          canvasCtx.save();
          canvasCtx.translate(wrist.x, wrist.y);
          canvasCtx.rotate(armAngle - (Math.PI / 2));
          // Offset UP Forearm (+ 0.4)
          canvasCtx.drawImage(bangleImg, -bWidth/2, -bHeight/2 + (wristWidth * 0.4), bWidth, bHeight);
          canvasCtx.restore();
      }

      // Gestures
      if (!autoTryRunning) {
          const now = Date.now();
          if (now - lastGestureTime > GESTURE_COOLDOWN) {
              const indexTip = lm[8]; 
              if (previousHandX !== null) {
                  const diff = indexTip.x - previousHandX;
                  if (Math.abs(diff) > 0.04) { navigateJewelry(diff < 0 ? 1 : -1); lastGestureTime = now; previousHandX = null; }
              }
              if (now - lastGestureTime > 100) previousHandX = indexTip.x;
          }
      }
  } else { previousHandX = null; }
  canvasCtx.restore();
});

const faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
faceMesh.setOptions({ refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
faceMesh.onResults((results) => {
  isProcessingFace = false; if(loadingStatus.style.display !== 'none') loadingStatus.style.display = 'none';
  canvasElement.width = videoElement.videoWidth; canvasElement.height = videoElement.videoHeight;
  canvasCtx.save(); canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  
  canvasCtx.globalCompositeOperation = 'overlay';
  canvasCtx.fillStyle = 'rgba(255, 220, 180, 0.15)'; 
  canvasCtx.fillRect(0,0, canvasElement.width, canvasElement.height);
  canvasCtx.globalCompositeOperation = 'source-over'; 
  
  // FACE IS ALWAYS FRONT CAMERA -> ALWAYS MIRROR
  if (currentFacingMode === 'user') {
      canvasCtx.translate(canvasElement.width, 0); canvasCtx.scale(-1, 1);
  } else {
      canvasCtx.setTransform(1, 0, 0, 1, 0, 0);
  }

  if (results.multiFaceLandmarks && results.multiFaceLandmarks[0]) {
    const lm = results.multiFaceLandmarks[0]; const w = canvasElement.width; const h = canvasElement.height;
    const leftEar = { x: lm[132].x * w, y: lm[132].y * h }; const rightEar = { x: lm[361].x * w, y: lm[361].y * h };
    const neck = { x: lm[152].x * w, y: lm[152].y * h }; const nose = { x: lm[1].x * w, y: lm[1].y * h };

    const rawHeadTilt = Math.atan2(rightEar.y - leftEar.y, rightEar.x - leftEar.x);
    const gravityTarget = -rawHeadTilt; const force = (gravityTarget - physics.earringAngle) * 0.08; 
    physics.earringVelocity += force; physics.earringVelocity *= 0.95; physics.earringAngle += physics.earringVelocity;
    const earDist = Math.hypot(rightEar.x - leftEar.x, rightEar.y - leftEar.y);

    if (earringImg && earringImg.complete) {
      let ew = earDist * 0.25; let eh = (earringImg.height/earringImg.width) * ew;
      const distToLeft = Math.hypot(nose.x - leftEar.x, nose.y - leftEar.y);
      const distToRight = Math.hypot(nose.x - rightEar.x, nose.y - rightEar.y);
      const ratio = distToLeft / (distToLeft + distToRight);

      if (ratio > 0.2) { 
          canvasCtx.save(); canvasCtx.translate(leftEar.x, leftEar.y + (ew * 0.15)); 
          canvasCtx.rotate(physics.earringAngle); 
          canvasCtx.drawImage(earringImg, -ew/2, 0, ew, eh); canvasCtx.restore();
      }
      if (ratio < 0.8) {
          canvasCtx.save(); canvasCtx.translate(rightEar.x, rightEar.y + (ew * 0.15)); 
          canvasCtx.rotate(physics.earringAngle); 
          canvasCtx.drawImage(earringImg, -ew/2, 0, ew, eh); canvasCtx.restore();
      }
    }
    if (necklaceImg && necklaceImg.complete) {
      let nw = earDist * 0.85; let nh = (necklaceImg.height/necklaceImg.width) * nw;
      canvasCtx.drawImage(necklaceImg, neck.x - nw/2, neck.y + (earDist*0.2), nw, nh);
    }
  }
  canvasCtx.restore();
});

/* --- INIT CAMERA --- */
async function startCameraFast() {
    try {
        currentFacingMode = 'user'; 
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } });
        videoElement.srcObject = stream;
        videoElement.onloadeddata = () => { videoElement.play(); loadingStatus.textContent = "Loading AI Models..."; detectLoop(); initVoiceControl(); };
    } catch (err) { alert("Camera Error: Check Permissions"); }
}
async function detectLoop() {
    if (videoElement.readyState >= 2) {
        if (!isProcessingFace) { isProcessingFace = true; await faceMesh.send({image: videoElement}); }
        if (!isProcessingHand) { isProcessingHand = true; await hands.send({image: videoElement}); }
    }
    requestAnimationFrame(detectLoop);
}
window.onload = startCameraFast;

/* --- OTHER FUNCTIONS (Gallery, Auto-Try, etc.) --- */
function toggleTryAll() { if (!currentType) { alert("Select category!"); return; } if (autoTryRunning) stopAutoTry(); else startAutoTry(); }
function startAutoTry() { autoTryRunning = true; autoSnapshots = []; autoTryIndex = 0; document.getElementById('tryall-btn').textContent = "STOP"; runAutoStep(); }
function stopAutoTry() { autoTryRunning = false; clearTimeout(autoTryTimeout); document.getElementById('tryall-btn').textContent = "Try All"; if (autoSnapshots.length > 0) showGallery(); }
async function runAutoStep() {
    if (!autoTryRunning) return;
    const assets = PRELOADED_IMAGES[currentType];
    if (!assets || autoTryIndex >= assets.length) { stopAutoTry(); return; }
    const targetImg = assets[autoTryIndex];
    updateSelection(targetImg); // Use helper
    autoTryTimeout = setTimeout(() => { triggerFlash(); captureToGallery(); autoTryIndex++; runAutoStep(); }, 1500); 
}

function showGallery() {
  const grid = document.getElementById('gallery-grid'); grid.innerHTML = '';
  if (autoSnapshots.length === 0) {
      const msg = document.createElement('p'); msg.innerText = "No photos taken yet."; msg.style.color = "#666"; msg.style.textAlign = "center"; msg.style.width = "100%"; grid.appendChild(msg);
  } else {
      autoSnapshots.forEach((item, index) => {
        const wrapper = document.createElement('div'); wrapper.className = "gallery-item-wrapper";
        wrapper.onclick = () => openLightbox(index);
        const img = document.createElement('img'); img.src = item.url; img.className = "gallery-thumb";
        wrapper.appendChild(img); grid.appendChild(wrapper);
      });
  }
  document.getElementById('gallery-modal').style.display = 'flex';
}
function openLightbox(index) { currentLightboxIndex = index; document.getElementById('lightbox-image').src = autoSnapshots[index].url; document.getElementById('lightbox-overlay').style.display = 'flex'; }
function changeLightboxImage(dir) { if(autoSnapshots.length===0)return; currentLightboxIndex = (currentLightboxIndex + dir + autoSnapshots.length) % autoSnapshots.length; document.getElementById('lightbox-image').src = autoSnapshots[currentLightboxIndex].url; }
function closeGallery() { document.getElementById('gallery-modal').style.display = 'none'; }
function closeLightbox() { document.getElementById('lightbox-overlay').style.display = 'none'; }
function closePreview() { document.getElementById('preview-modal').style.display = 'none'; }
function closeWhatsAppModal() { document.getElementById('whatsapp-modal').style.display = 'none'; }
function downloadSingleSnapshot() { if(currentPreviewData.url) requestWhatsApp('single'); }
function downloadAllAsZip() { if (autoSnapshots.length === 0) alert("No images!"); else requestWhatsApp('zip'); }
function performSingleDownload() { saveAs(currentPreviewData.url, currentPreviewData.name); }
async function shareSingleSnapshot() { if(currentPreviewData.url && navigator.share) navigator.share({files: [new File([await (await fetch(currentPreviewData.url)).blob()], "look.png", {type: "image/png"})]}); }

/* --- EXPORTS --- */
window.selectJewelryType = selectJewelryType; window.toggleTryAll = toggleTryAll;
window.closeGallery = closeGallery; window.closeLightbox = closeLightbox; window.takeSnapshot = takeSnapshot;
window.downloadAllAsZip = downloadAllAsZip; window.closePreview = closePreview;
window.downloadSingleSnapshot = downloadSingleSnapshot; window.shareSingleSnapshot = shareSingleSnapshot;
window.confirmWhatsAppDownload = confirmWhatsAppDownload; window.closeWhatsAppModal = closeWhatsAppModal;
window.changeLightboxImage = changeLightboxImage; window.toggleVoiceControl = toggleVoiceControl; window.showGallery = showGallery;