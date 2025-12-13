// Web app matching the original split-screen layout
// Left: camera + sign detection, Right: speech output + video playback
// Client-side: MediaPipe Hands + Web Speech API + Video playback

const videoEl = document.getElementById('video');
const overlay = document.getElementById('overlay');
const overlayCtx = overlay.getContext('2d');
const speechTextEl = document.getElementById('speech-text');
const leftLabelEl = document.getElementById('left-label');
const gestureOverlayEl = document.getElementById('gesture-overlay');
const cameraBtn = document.getElementById('camera-btn');
const speechBtn = document.getElementById('speech-btn');
const fullscreenBtn = document.getElementById('fullscreen-btn');

let camera = null;
let cameraActive = true;  // Start with camera ON like desktop
let speechActive = false; // Start with speech OFF like desktop
let fullscreenMode = false;
let mapping = {}; // Will load from clips/mapping.json
let currentVideo = null;

// Load mapping.json
async function loadMapping() {
  try {
    const response = await fetch('clips/mapping.json');
    mapping = await response.json();
    console.log('Loaded mapping:', mapping);
  } catch (error) {
    console.log('Could not load mapping.json:', error);
    // Fallback mapping
    mapping = {
      "hello": ["hello.mp4"],
      "help": ["help.mp4"],
      "i love you": ["i_love_you.mp4"]
    };
  }
}

// Video playback functions
function playVideo(clipName) {
  return new Promise((resolve) => {
    const videoPath = `clips/${clipName}`;

    // Create or reuse video element
    if (!currentVideo) {
      currentVideo = document.createElement('video');
      currentVideo.style.width = '100%';
      currentVideo.style.height = '100%';
      currentVideo.style.objectFit = 'contain';
      currentVideo.style.backgroundColor = '#000';
      currentVideo.controls = false;
      currentVideo.muted = true; // Required for autoplay in some browsers

      // Replace the speech text area with video
      const speechContent = document.getElementById('right-content');
      speechContent.innerHTML = '';
      speechContent.appendChild(currentVideo);
    }

    currentVideo.src = videoPath;
    currentVideo.style.display = 'block';

    currentVideo.onloadeddata = () => {
      currentVideo.play();
    };

    currentVideo.onended = () => {
      // Restore speech text area after video ends
      const speechContent = document.getElementById('right-content');
      speechContent.innerHTML = `
        <div id="right-label">Speech to Sign (SPACE to start/stop)</div>
        <div id="speech-text">(listening...)</div>
      `;
      currentVideo = null;
      resolve();
    };

    currentVideo.onerror = () => {
      console.log('Video failed to load:', videoPath);
      // Restore speech text area on error
      const speechContent = document.getElementById('right-content');
      speechContent.innerHTML = `
        <div id="right-label">Speech to Sign (SPACE to start/stop)</div>
        <div id="speech-text">Video not found: ${clipName}</div>
      `;
      currentVideo = null;
      resolve();
    };
  });
}

function normalizeText(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

async function processSpeech(text) {
  const normalizedText = normalizeText(text);
  console.log('Processing speech:', normalizedText);

  // Check for exact phrase match first
  if (mapping[normalizedText]) {
    const clips = mapping[normalizedText];
    for (const clip of clips) {
      await playVideo(clip);
    }
    return;
  }

  // Check individual words
  const words = normalizedText.split(' ');
  for (const word of words) {
    if (mapping[word]) {
      const clips = mapping[word];
      for (const clip of clips) {
        await playVideo(clip);
      }
    }
  }
}

// Setup MediaPipe Hands
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.5
});

hands.onResults(onResults);

function resizeCanvas() {
  if (!videoEl.videoWidth) return;
  overlay.width = videoEl.videoWidth;
  overlay.height = videoEl.videoHeight;
}

async function startCamera() {
  if (camera) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false
    });
    videoEl.srcObject = stream;
    await videoEl.play();
    resizeCanvas();
    camera = new Camera(videoEl, {
      onFrame: async () => {
        await hands.send({ image: videoEl });
      },
      width: 640,
      height: 480
    });
    camera.start();
    cameraActive = true;
    cameraBtn.textContent = 'Stop Camera';
    videoEl.style.display = 'block';
  } catch (err) {
    console.log('Camera error:', err.message);
    cameraActive = false;
    cameraBtn.textContent = 'Start Camera';
  }
}

function stopCamera() {
  if (!camera) return;
  try { camera.stop(); } catch (e) {}
  const s = videoEl.srcObject;
  if (s && s.getTracks) s.getTracks().forEach(t => t.stop());
  videoEl.srcObject = null;
  camera = null;
  cameraActive = false;
  cameraBtn.textContent = 'Start Camera';
  // Show black screen when camera is off
  overlayCtx.fillStyle = '#000';
  overlayCtx.fillRect(0, 0, overlay.width, overlay.height);
  videoEl.style.display = 'none';
}

function toggleCamera() {
  if (cameraActive) stopCamera();
  else startCamera();
}

// Web Speech API
let recognition = null;
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    speechActive = true;
    speechBtn.textContent = 'Stop Listening';
    speechTextEl.textContent = '(listening...)';
  };

  recognition.onend = () => {
    speechActive = false;
    speechBtn.textContent = 'Start Listening';
    speechTextEl.textContent = 'Click "Start Listening" to begin speech recognition';
  };

  recognition.onresult = async (ev) => {
    let interim = '';
    let final = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) final += r[0].transcript + ' ';
      else interim += r[0].transcript;
    }
    const fullText = (final + interim).trim();
    speechTextEl.textContent = fullText;

    // Process final results
    if (final.trim()) {
      await processSpeech(final.trim());
    }
  };

  recognition.onerror = (e) => console.log('Speech error:', e.error);
} else {
  speechTextEl.textContent = 'Speech Recognition not supported in this browser';
  speechBtn.disabled = true;
}

function toggleSpeech() {
  if (!recognition) return;
  if (speechActive) {
    recognition.stop();
  } else {
    recognition.start();
  }
}

function toggleFullscreen() {
  fullscreenMode = !fullscreenMode;
  if (fullscreenMode) {
    document.body.classList.add('fullscreen');
    fullscreenBtn.textContent = 'Exit Fullscreen';
  } else {
    document.body.classList.remove('fullscreen');
    fullscreenBtn.textContent = 'Enter Fullscreen';
  }
}

// Button listeners
cameraBtn.addEventListener('click', toggleCamera);
speechBtn.addEventListener('click', toggleSpeech);
fullscreenBtn.addEventListener('click', toggleFullscreen);

// Keyboard shortcuts (match desktop exactly)
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    toggleSpeech();
  }
  if (e.code === 'Tab') {
    e.preventDefault();
    toggleCamera();
  }
  if (e.code === 'F11') {
    e.preventDefault();
    toggleFullscreen();
  }
  if (e.code === 'Escape') {
    // Close window/tab
    window.close();
  }
});

// Gesture detection helpers (ported from Python)
function fingerExtended(landmarks, tipIdx, mcpIdx) {
  return landmarks[tipIdx].y < landmarks[mcpIdx].y;
}

function thumbExtended(landmarks, isRight) {
  const tip = landmarks[4], mcp = landmarks[2];
  return isRight ? (tip.x < mcp.x) : (tip.x > mcp.x);
}

function bboxFromLandmarks(landmarks) {
  const xs = landmarks.map(l => l.x);
  const ys = landmarks.map(l => l.y);
  const x1 = Math.min(...xs), x2 = Math.max(...xs);
  const y1 = Math.min(...ys), y2 = Math.max(...ys);
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const w = x2 - x1, h = y2 - y1;
  return { x1, y1, x2, y2, cx, cy, w, h };
}

function thumbOnPalm(thumbLandmarks, palmBBox) {
  const tip = thumbLandmarks[4];
  const marginX = Math.max(0.06, palmBBox.w * 0.25);
  const marginY = Math.max(0.06, palmBBox.h * 0.25);
  const withinX = (tip.x >= (palmBBox.x1 - marginX)) && (tip.x <= (palmBBox.x2 + marginX));
  const withinY = tip.y <= (palmBBox.cy + marginY);
  return withinX && withinY;
}

function detectSingleGesture(landmarks, isRight) {
  const thumb = thumbExtended(landmarks, isRight);
  const index = fingerExtended(landmarks, 8, 5);
  const middle = fingerExtended(landmarks, 12, 9);
  const ring = fingerExtended(landmarks, 16, 13);
  const pinky = fingerExtended(landmarks, 20, 17);
  const fingers = [thumb, index, middle, ring, pinky];

  // Hello: all extended
  const fingerYs = [landmarks[4].y, landmarks[8].y, landmarks[12].y, landmarks[16].y, landmarks[20].y];
  const yVar = Math.max(...fingerYs) - Math.min(...fingerYs);
  const spread = Math.hypot(landmarks[8].x - landmarks[20].x, landmarks[8].y - landmarks[20].y);
  if (fingers.every(Boolean) && (yVar < 0.22 || spread > 0.06)) {
    return { name: 'Hello', confidence: Math.round((fingers.filter(Boolean).length / 5) * 100) };
  }

  // I Love You: thumb, index, pinky extended; middle+ring folded
  if (thumb && index && !middle && !ring && pinky) {
    return { name: 'I Love You', confidence: 85 };
  }

  // Yes (closed fist)
  if (!thumb && !index && !middle && !ring && !pinky) {
    return { name: 'Yes', confidence: 90 };
  }

  return null;
}

function detectTwoHandGesture(allLandmarks, handedness) {
  const l1 = allLandmarks[0], l2 = allLandmarks[1];
  const h1 = (handedness && handedness[0]) ? (handedness[0].label || handedness[0].categoryName) : 'Right';
  const h2 = (handedness && handedness[1]) ? (handedness[1].label || handedness[1].categoryName) : 'Left';
  const isRight1 = (h1.toLowerCase().startsWith('right'));
  const isRight2 = (h2.toLowerCase().startsWith('right'));

  const h1_thumb = thumbExtended(l1, isRight1);
  const h1_open = [8, 12, 16, 20].map((i, idx) => fingerExtended(l1, i, [5, 9, 13, 17][idx])).filter(Boolean).length >= 3;
  const h2_thumb = thumbExtended(l2, isRight2);
  const h2_open = [8, 12, 16, 20].map((i, idx) => fingerExtended(l2, i, [5, 9, 13, 17][idx])).filter(Boolean).length >= 3;

  const b1 = bboxFromLandmarks(l1);
  const b2 = bboxFromLandmarks(l2);
  const centerDist = Math.hypot(b1.cx - b2.cx, b1.cy - b2.cy);

  let matched = false;
  if (h1_thumb && h2_open) {
    if (thumbOnPalm(l1, b2) && centerDist < Math.max(b2.w, b2.h) * 2.0 + 0.1) matched = true;
  }
  if (!matched && h2_thumb && h1_open) {
    if (thumbOnPalm(l2, b1) && centerDist < Math.max(b1.w, b1.h) * 2.0 + 0.1) matched = true;
  }

  if (matched) return { name: 'Help', confidence: 90 };
  return null;
}

function onResults(results) {
  resizeCanvas();
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  // Only clear to black if camera is off, otherwise let video show through
  if (!cameraActive) {
    overlayCtx.fillStyle = '#000';
    overlayCtx.fillRect(0, 0, overlay.width, overlay.height);
  }

  const multi = results.multiHandLandmarks || [];
  const handedness = results.multiHandedness || [];

  // Save context, flip horizontally to match mirrored video, then restore
  overlayCtx.save();
  overlayCtx.scale(-1, 1);
  overlayCtx.translate(-overlay.width, 0);

  // Draw all hands with green highlighting for detected gestures
  let detectedGesture = null;

  for (let i = 0; i < multi.length; i++) {
    const lm = multi[i];
    const isRight = (handedness[i] && handedness[i].label && handedness[i].label.toLowerCase().startsWith('right'));

    // Check for gestures and highlight in green if detected
    let gestureColor = '#FF0000'; // Default red

    if (multi.length === 1) {
      const single = detectSingleGesture(lm, isRight);
      if (single && ['Hello', 'I Love You'].includes(single.name)) {
        detectedGesture = single.name;
        gestureColor = '#00FF00'; // Green for detected gestures
      }
    } else if (multi.length === 2 && i === 0) { // Only check first hand for two-hand gestures
      const twoHand = detectTwoHandGesture(multi, handedness);
      if (twoHand && twoHand.name === 'Help') {
        detectedGesture = twoHand.name;
        gestureColor = '#00FF00'; // Green for detected gestures
        // Draw both hands in green
        for (let j = 0; j < multi.length; j++) {
          const lm2 = multi[j];
          drawConnectors(overlayCtx, lm2, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 3 });
          drawLandmarks(overlayCtx, lm2, { color: '#00FF00', lineWidth: 2 });
        }
        break; // Don't draw individual hands again
      }
    }

    // Draw hand landmarks
    drawConnectors(overlayCtx, lm, HAND_CONNECTIONS, { color: gestureColor, lineWidth: gestureColor === '#00FF00' ? 3 : 2 });
    drawLandmarks(overlayCtx, lm, { color: gestureColor, lineWidth: gestureColor === '#00FF00' ? 2 : 1 });
  }

  // Restore context
  overlayCtx.restore();

  // Update status label and big overlay
  if (detectedGesture) {
    leftLabelEl.textContent = `Current Gesture: ${detectedGesture}`;
    leftLabelEl.style.color = '#00FF00'; // Green text for detected gestures
    
    // Show big overlay with detected gesture
    gestureOverlayEl.textContent = detectedGesture;
    gestureOverlayEl.style.display = 'block';
  } else {
    leftLabelEl.textContent = 'Sign Language Detector';
    leftLabelEl.style.color = '#fff'; // White text for default state
    
    // Hide overlay when no gesture detected
    gestureOverlayEl.style.display = 'none';
  }
}

// Initialize - load mapping and start camera
loadMapping().then(() => {
  startCamera();
});
