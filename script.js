/* script.js - Jewels-Ai: With Thumbnail Icon Logic */

/* --- CONFIGURATION --- */
const DRIVE_API_KEY = "AIzaSyAXG3iG2oQjUA_BpnO8dK8y-MHJ7HLrhyE"; 
const UPLOAD_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby96W9Mf1fvsfdp7dpzRCEiQEvFEg3ZiSa-iEnYgbr4Zu2bC7IcQVMTxudp4QDofAg3/exec";

const DRIVE_FOLDERS = {
  earrings: "1ySHR6Id5RxVj16-lf7NMN9I61RPySY9s",
  chains: "1BHhizdJ4MDfrqITTkynshEL9D0b1MY-J",
  rings: "1sEfn9-WNEEnA_Znny0ZSjdHzSooBT2MY",
  bangles: "1KPG8IBRVvbZnNvl-oklPYWz33o3BM6EM"
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

/* App State */
let earringImg = null, necklaceImg = null, ringImg = null, bangleImg = null;
let currentType = ''; 
let isProcessingHand = false, isProcessingFace = false;
let lastGestureTime = 0;
const GESTURE_COOLDOWN = 800; 
let previousHandX = null;     

/* Physics State */
let physics = { earringVelocity: 0, earringAngle: 0 };

/* Auto-Try & Gallery */
let autoTryRunning = false;
let autoSnapshots = [];
let autoTryIndex = 0;
let autoTryTimeout = null;
let currentPreviewData = { url: null, name: 'Jewels-Ai_look.png' }; 
let pendingDownloadAction = null; 

/* --- 1. VOICE RECOGNITION (SILENT & CONTINUOUS) --- */
function initVoiceControl() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
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
    loadingStatus.style.display = 'block';
    loadingStatus.textContent = "Fetching Designs...";

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
    } catch (err) { 
        console.error("Drive Error:", err);
        loadingStatus.textContent = "Error Loading Images (Check Key)";
    }
}

async function preloadCategory(type) {
    await fetchFromDrive(type);
    if (!JEWELRY_ASSETS[type]) return;
    if (!PRELOADED_IMAGES[type]) {
        PRELOADED_IMAGES[type] = [];
        const promises = JEWELRY_ASSETS[type].map(file => {
            return new Promise((resolve) => {
                const img = new Image();
                img.crossOrigin = 'anonymous'; 
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null); 
                img.src = file.src;
                PRELOADED_IMAGES[type].push(img);
            });
        });
        await Promise.all(promises);
    }
}

/* --- 3. WHATSAPP & DOWNLOAD --- */
function requestWhatsApp(actionType) {
    pendingDownloadAction = actionType;
    document.getElementById('whatsapp-modal').style.display = 'flex';
}
function confirmWhatsAppDownload() {
    const phone = document.getElementById('user-phone').value.trim();
    if (phone.length < 5) { alert("Invalid Number"); return; }
    document.getElementById('whatsapp-modal').style.display = 'none';
    const overlay = document.getElementById('process-overlay');
    overlay.style.display = 'flex';
    document.getElementById('process-text').innerText = "Sending...";
    
    if (pendingDownloadAction === 'single' && currentPreviewData.url) {
         uploadToDrive(phone);
    }

    setTimeout(() => {
        const msg = encodeURIComponent("Hi! Here is my Jewels-Ai look.");
        window.open(`https://wa.me/${phone.replace('+','')}?text=${msg}`, '_blank');
        if (pendingDownloadAction === 'single') saveAs(currentPreviewData.url, currentPreviewData.name);
        else if (pendingDownloadAction === 'zip') performZipDownload();
        setTimeout(() => { overlay.style.display = 'none'; }, 2000);
    }, 1500);
}
function uploadToDrive(phone) {
    const data = pendingDownloadAction === 'single' ? currentPreviewData : (autoSnapshots[0] || {}); 
    if(!data.url) return;
    fetch(UPLOAD_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone, image: data.url, filename: data.name })
    }).catch(err => console.error("Upload failed", err));
}
function performZipDownload() {
    const zip = new JSZip();
    const folder = zip.folder("Jewels-Ai_Collection");
    autoSnapshots.forEach(item => folder.file(item.name, item.url.replace(/^data:image\/(png|jpg);base64,/, ""), {base64:true}));
    zip.generateAsync({type:"blob"}).then(c => saveAs(c, "Jewels-Ai_Collection.zip"));
}

/* --- 4. AR CORE: POSITIONING & PHYSICS --- */

function calculateAngle(p1, p2) { return Math.atan2(p2.y - p1.y, p2.x - p1.x); }

const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ maxNumHands: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
hands.onResults((results) => {
  isProcessingHand = false; 
  const w = canvasElement.width; const h = canvasElement.height;
  canvasCtx.save(); canvasCtx.translate(w, 0); canvasCtx.scale(-1, 1);

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
  isProcessingFace = false;
  canvasElement.width = videoElement.videoWidth; canvasElement.height = videoElement.videoHeight;
  canvasCtx.save(); canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  
  // Beauty Filter
  canvasCtx.globalCompositeOperation = 'overlay';
  canvasCtx.fillStyle = 'rgba(255, 220, 180, 0.15)'; 
  canvasCtx.fillRect(0,0, canvasElement.width, canvasElement.height);
  canvasCtx.globalCompositeOperation = 'source-over'; 

  canvasCtx.translate(canvasElement.width, 0); canvasCtx.scale(-1, 1);

  if (results.multiFaceLandmarks && results.multiFaceLandmarks[0]) {
    const lm = results.multiFaceLandmarks[0];
    const w = canvasElement.width; const h = canvasElement.height;
    const leftEar = { x: lm[132].x * w, y: lm[132].y * h };
    const rightEar = { x: lm[361].x * w, y: lm[361].y * h };
    const neck = { x: lm[152].x * w, y: lm[152].y * h };
    const nose = { x: lm[1].x * w, y: lm[1].y * h };

    // Physics
    const rawHeadTilt = Math.atan2(rightEar.y - leftEar.y, rightEar.x - leftEar.x);
    const gravityTarget = -rawHeadTilt; 
    physics.earringVelocity += (gravityTarget - physics.earringAngle) * 0.08;
    physics.earringVelocity *= 0.95;
    physics.earringAngle += physics.earringVelocity;

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

async function startCameraFast() {
    try {
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

/* --- UI HELPERS --- */
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

async function selectJewelryType(type) {
  currentType = type;
  
  if(type !== 'earrings') earringImg = null; 
  if(type !== 'chains') necklaceImg = null;
  if(type !== 'rings') ringImg = null; 
  if(type !== 'bangles') bangleImg = null;

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

function captureToGallery() {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = videoElement.videoWidth; tempCanvas.height = videoElement.videoHeight;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.translate(tempCanvas.width, 0); tempCtx.scale(-1, 1); tempCtx.drawImage(videoElement, 0, 0);
  tempCtx.setTransform(1, 0, 0, 1, 0, 0); 
  try { tempCtx.drawImage(canvasElement, 0, 0); } catch(e) {}
  const dataUrl = tempCanvas.toDataURL('image/png');
  autoSnapshots.push({ url: dataUrl, name: `Look_${Date.now()}.png` });
  
  // NEW: Update Gallery Icon with the captured photo!
  const galBtn = document.getElementById('gallery-btn');
  if(galBtn) {
      galBtn.style.backgroundImage = `url(${dataUrl})`;
      galBtn.innerText = ''; // Hide emoji
  }

  return { url: dataUrl, name: `Look_${Date.now()}.png` }; 
}

function takeSnapshot() { const shotData = captureToGallery(); currentPreviewData = shotData; document.getElementById('preview-image').src = shotData.url; document.getElementById('preview-modal').style.display = 'flex'; }
function closePreview() { document.getElementById('preview-modal').style.display = 'none'; }
function toggleTryAll() { if (!currentType) { alert("Select category!"); return; } if (autoTryRunning) stopAutoTry(); else startAutoTry(); }
function startAutoTry() { autoTryRunning = true; autoSnapshots = []; autoTryIndex = 0; document.getElementById('tryall-btn').textContent = "STOP"; runAutoStep(); }
function stopAutoTry() { autoTryRunning = false; clearTimeout(autoTryTimeout); document.getElementById('tryall-btn').textContent = "Try All"; if (autoSnapshots.length > 0) showGallery(); }
async function runAutoStep() {
    if (!autoTryRunning) return;
    const assets = PRELOADED_IMAGES[currentType];
    if (!assets || autoTryIndex >= assets.length) { stopAutoTry(); return; }
    const targetImg = assets[autoTryIndex];
    if (currentType === 'earrings') earringImg = targetImg; else if (currentType === 'chains') necklaceImg = targetImg; else if (currentType === 'rings') ringImg = targetImg; else if (currentType === 'bangles') bangleImg = targetImg;
    autoTryTimeout = setTimeout(() => { captureToGallery(); autoTryIndex++; runAutoStep(); }, 1500); 
}

/* --- GALLERY FUNCTIONS --- */
function showGallery() {
  const grid = document.getElementById('gallery-grid'); grid.innerHTML = '';
  autoSnapshots.forEach((item, index) => {
    const img = document.createElement('img'); img.src = item.url; img.className = "gallery-thumb";
    img.onclick = () => { document.getElementById('lightbox-image').src = item.url; document.getElementById('lightbox-overlay').style.display = 'flex'; };
    grid.appendChild(img);
  });
  document.getElementById('gallery-modal').style.display = 'flex';
}
function closeGallery() { document.getElementById('gallery-modal').style.display = 'none'; }
function closeLightbox() { document.getElementById('lightbox-overlay').style.display = 'none'; }
function closeWhatsAppModal() { document.getElementById('whatsapp-modal').style.display = 'none'; }
function downloadSingleSnapshot() { if(currentPreviewData.url) requestWhatsApp('single'); }
function downloadAllAsZip() { if (autoSnapshots.length === 0) alert("No images!"); else requestWhatsApp('zip'); }
async function shareSingleSnapshot() { if(currentPreviewData.url && navigator.share) navigator.share({files: [new File([await (await fetch(currentPreviewData.url)).blob()], "look.png", {type: "image/png"})]}); }

/* --- EXPORTS --- */
window.selectJewelryType = selectJewelryType; window.toggleTryAll = toggleTryAll;
window.closeGallery = closeGallery; window.closeLightbox = closeLightbox; window.takeSnapshot = takeSnapshot;
window.downloadAllAsZip = downloadAllAsZip; window.closePreview = closePreview;
window.downloadSingleSnapshot = downloadSingleSnapshot; window.shareSingleSnapshot = shareSingleSnapshot;
window.confirmWhatsAppDownload = confirmWhatsAppDownload; window.closeWhatsAppModal = closeWhatsAppModal;
window.showGallery = showGallery; // Export added