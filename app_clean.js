// Web app matching the original split-screen layout
// Left: camera + sign detection, Right: speech output + video playback
// Client-side: MediaPipe Hands + Web Speech API + Video playback
//
// CLIP_BASE_URL determines where the sign language video files are loaded
// from. When running locally this just points at the "clips" subfolder,
// which is served by the HTTP server. For a public deployment (e.g. GitHub
// Pages) set this to the absolute URL of your hosted clips directory so
// anyone visiting the page can fetch the videos the same way YouTube
// delivers media from a CDN.
const CLIP_BASE_URL = (function(){
  // default relative path; change to remote host if needed
  return 'clips/';
})();

const videoEl = document.getElementById('video');
const overlay = document.getElementById('overlay');
const overlayCtx = overlay.getContext('2d');
const speechTextEl = document.getElementById('speech-text');
const leftLabelEl = document.getElementById('left-label');
const gestureOverlayEl = document.getElementById('gesture-overlay');
const speechBtn = document.getElementById('speech-btn');

let camera = null;
let speechActive = false;
let mapping = {}; // Will load from clips/mapping.json
let currentVideo = null;
let lastRecognizedText = ''; // Store last recognized text

// Motion tracking for sequence-based gestures
let handHistory = []; // Store hand positions over frames
const MAX_HISTORY = 20; // Keep last 20 frames
let lastDetectedGesture = null;
let gestureConfirmationCount = 0;

// Gesture stability tracking
let lastGestureDetected = null;
let lastGestureTime = 0;
const GESTURE_LOCK_TIME = 300; // Lock gesture for 300ms



// Load mapping.json
async function loadMapping() {
  try {
    // append timestamp to break any cache
    const response = await fetch('clips/mapping.json?v=' + Date.now());
    mapping = await response.json();
    console.log('mapping.json loaded:', mapping);
  } catch (error) {
    console.error('failed to load mapping.json, using fallback', error);
    // mapping load error
    // Fallback mapping
    mapping = {
      "hello": ["hello.mp4"],
      "how are you": ["how_are_you.mp4"],
      "thank you": ["thank_you.mp4"],
      "bad": ["bad.mp4"],
      "bye": ["bye.mp4"],
      "by": ["bye.mp4"],
      "goodbye": ["bye.mp4"],
      "good": ["good.mp4"],
      "help": ["help.mp4"],
      "i love you": ["i_love_you.mp4"],
      "no": ["no.mp4"],
      "know": ["no.mp4"],
      "stop": ["stop.mp4"],
      "yes": ["yes.mp4"],
      "youre welcome": ["you're_welcome.mp4"]
    };
    console.log('fallback mapping used:', mapping);
  }
}

// Video playback functions
function playVideo(clipName) {
  return new Promise((resolve) => {
    // build the absolute path using base URL (can be remote host)
    const videoPath = CLIP_BASE_URL + clipName;
    console.log('playVideo requested', clipName, '=>', videoPath);

    // Create or reuse video element
    if (!currentVideo) {
      currentVideo = document.createElement('video');
      // fill container while preserving aspect ratio
      currentVideo.style.width = '100%';
      currentVideo.style.height = '100%';
      currentVideo.style.objectFit = 'contain';
      // mute by default so clips play silently
      currentVideo.muted = true;

      // Replace the speech text area with video
      const speechContent = document.getElementById('right-content');
      speechContent.innerHTML = '';
      speechContent.appendChild(currentVideo);
    }

    // append timestamp to force reload of updated files (avoid stale cache)
    currentVideo.src = videoPath + '?v=' + Date.now();
    currentVideo.style.display = 'block';

    let playbackStarted = false;

    currentVideo.onloadeddata = () => {
      console.log('video loaded data', videoPath);
      // attempt to play, catch any autoplay restrictions
      currentVideo.play().then(() => {
        console.log('video play() succeeded', videoPath);
      }).catch(err => {
        console.warn('video play() promise rejected', videoPath, err);
        // give up and restore UI after short delay
        setTimeout(() => {
          cleanupAndResolve();
        }, 500);
      });
    };

    currentVideo.onerror = (e) => {
      console.error('video error loading', videoPath, e);
      cleanupAndResolve();
    };

    currentVideo.onplaying = () => {
      playbackStarted = true;
      console.log('video started playing', videoPath);
    };

    currentVideo.onended = () => {
      console.log('video ended naturally', videoPath);
      cleanupAndResolve();
    };

    // if nothing happens within a few seconds, give up
    const fallbackTimer = setTimeout(() => {
      if (!playbackStarted) {
        console.warn('video failed to start within timeout', videoPath);
        cleanupAndResolve();
      }
    }, 5000);

    function cleanupAndResolve() {
      clearTimeout(fallbackTimer);
      const speechContent = document.getElementById('right-content');
      speechContent.innerHTML = `
        <div id="right-label">Speech to Sign (SPACE to start/stop)</div>
        <div id="speech-text"></div>
      `;
      const newSpeechTextEl = document.getElementById('speech-text');
      if (speechActive) {
        newSpeechTextEl.textContent = '(listening...)';
      }
      currentVideo = null;
      resolve();
    }

  });
}

function normalizeText(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

async function processSpeech(text) {
  // make sure the transcribed words remain visible until the next utterance
  speechTextEl.textContent = text;

  const normalizedText = normalizeText(text);
  console.log('processSpeech normalized text:', normalizedText);

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
  let foundAny = false;
  for (const word of words) {
    console.log('checking word mapping for', word, '=>', mapping[word]);
    if (mapping[word]) {
      foundAny = true;
      const clips = mapping[word];
      for (const clip of clips) {
        await playVideo(clip);
      }
    }
  }

  if (!foundAny) {
    console.log('no mapping for text or any word:', normalizedText);
  }
}

// Setup MediaPipe Hands (will be initialized when camera starts)
let hands = null;

function resizeCanvas() {
  if (!videoEl.videoWidth) return;
  overlay.width = videoEl.videoWidth;
  overlay.height = videoEl.videoHeight;
}

async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    videoEl.srcObject = stream;
    await videoEl.play();
    resizeCanvas();

    // Initialize MediaPipe Hands
    hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
    hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5 });
    hands.onResults(onResults);

    camera = new Camera(videoEl, { onFrame: async () => { await hands.send({ image: videoEl }); }, width: 640, height: 480 });
    camera.start();
    videoEl.style.display = 'block';
  } catch (err) {
    console.log('Camera error:', err.message);
  }
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
    // Auto-restart if speech was active
    if (speechActive) {
      setTimeout(() => {
        if (speechActive) {
          recognition.start();
        }
      }, 100);
    } else {
      speechBtn.textContent = 'Start Listening';
      speechTextEl.textContent = 'Click "Start Listening" to begin speech recognition';
    }
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
    // do not display the recognized words; keep the UI showing only listening state

    // Process final results
    if (final.trim()) {
      lastRecognizedText = final.trim(); // Store for after video if needed
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
    speechActive = false;
    speechBtn.textContent = 'Start Listening';
    speechTextEl.textContent = 'Click "Start Listening" to begin speech recognition';
    recognition.stop();
  } else {
    lastRecognizedText = '';
    speechActive = true;
    recognition.start();
  }
}

// fullscreen functionality removed for demo simplicity

// Button listeners
speechBtn.addEventListener('click', toggleSpeech);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    toggleSpeech();
  }
  if (e.code === 'Escape') {
    // Close window/tab
    window.close();
  }
});

// Gesture detection helpers (ported from Python)
function fingerExtended(landmarks, tipIdx, mcpIdx) {
  const tip = landmarks[tipIdx];
  const mcp = landmarks[mcpIdx];
  const dy = mcp.y - tip.y; // positive if tip is above mcp
  const dist = Math.hypot(tip.x - mcp.x, tip.y - mcp.y);
  // finger considered extended if tip sits above mcp OR is sufficiently far away
  return dy > 0.01 || dist > 0.1;
}

function thumbExtended(landmarks, isRight) {
  const tip = landmarks[4], mcp = landmarks[2];
  return isRight ? (tip.x < mcp.x) : (tip.x > mcp.x);
}

function bboxFromLandmarks(landmarks) { const xs = landmarks.map(l => l.x); const ys = landmarks.map(l => l.y); const x1 = Math.min(...xs), x2 = Math.max(...xs); const y1 = Math.min(...ys), y2 = Math.max(...ys); const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2; const w = x2 - x1, h = y2 - y1; return { x1, y1, x2, y2, cx, cy, w, h }; }
function thumbOnPalm(thumbLandmarks, palmBBox) { const tip = thumbLandmarks[4]; const marginX = Math.max(0.06, palmBBox.w * 0.25); const marginY =Math.max(0.06, palmBBox.h * 0.25); const withinX = (tip.x >= (palmBBox.x1 - marginX)) && (tip.x <= (palmBBox.x2 + marginX)); const withinY = tip.y <= (palmBBox.cy + marginY); return withinX && withinY; }
function detectSingleGesture(landmarks, isRight) {
  // helper values for all the single-hand shapes
  const thumb = thumbExtended(landmarks, isRight);
  const index = fingerExtended(landmarks, 8, 5);
  const middle = fingerExtended(landmarks, 12, 9);
  const ring = fingerExtended(landmarks, 16, 13);
  const pinky = fingerExtended(landmarks, 20, 17);
  const fingers = [thumb, index, middle, ring, pinky];

  // if the classic two-finger “no” posture is present (thumb ignored)
  // we want to recognise it *before* the open-palm “bye” rule so it
  // never gets overridden during the lock period or by noise on the
  // thumb.
  if (index && middle && !ring && !pinky) {
    return { name: 'No', confidence: 80 };
  }

  const fingerYs = [landmarks[4].y, landmarks[8].y, landmarks[12].y, landmarks[16].y, landmarks[20].y];
  const yVar = Math.max(...fingerYs) - Math.min(...fingerYs);
  const spread = Math.hypot(landmarks[8].x - landmarks[20].x, landmarks[8].y - landmarks[20].y);

  // waving palm = bye
  if (fingers.every(Boolean) && (yVar < 0.22 || spread > 0.06)) {
    return { name: 'Bye', confidence: Math.round((fingers.filter(Boolean).length / 5) * 100) };
  }
  if (thumb && index && !middle && !ring && pinky) {
    return { name: 'I Love You', confidence: 85 };
  }
  // You gesture currently disabled for demo (index-only pointing)
  // if (!thumb && index && !middle && !ring && !pinky) {
  //   return { name: 'You', confidence: 80 };
  // }
  if (!thumb && !index && !middle && !ring && !pinky) {
    return { name: 'Yes', confidence: 90 };
  }
  return null;
}

function detectTwoHandGesture(allLandmarks, handedness) { const l1 = allLandmarks[0], l2 = allLandmarks[1]; const h1 = (handedness && handedness[0]) ? (handedness[0].label || handedness[0].categoryName) : 'Right'; const h2 = (handedness && handedness[1]) ? (handedness[1].label || handedness[1].categoryName) : 'Left'; const isRight1 = (h1.toLowerCase().startsWith('right')); const isRight2 = (h2.toLowerCase().startsWith('right')); const h1_thumb = thumbExtended(l1, isRight1); const h1_open = [8, 12, 16, 20].map((i, idx) => fingerExtended(l1, i, [5, 9, 13, 17][idx])).filter(Boolean).length >= 3; const h2_thumb = thumbExtended(l2, isRight2); const h2_open = [8, 12, 16, 20].map((i, idx) => fingerExtended(l2, i, [5, 9, 13, 17][idx])).filter(Boolean).length >= 3; const b1 = bboxFromLandmarks(l1); const b2 = bboxFromLandmarks(l2); const centerDist = Math.hypot(b1.cx - b2.cx, b1.cy - b2.cy); let matched = false; if (h1_thumb && h2_open) { if (thumbOnPalm(l1, b2) && centerDist < Math.max(b2.w, b2.h) * 2.0 + 0.1) matched = true; } if (!matched && h2_thumb && h1_open) { if (thumbOnPalm(l2, b1) && centerDist < Math.max(b1.w, b1.h) * 2.0 + 0.1) matched = true; } if (matched) return { name: 'Help', confidence: 90 }; return null; }

function getHandCentroid(landmarks) { let x = 0, y = 0; for (let lm of landmarks) { x += lm.x; y += lm.y; } return { x: x / landmarks.length, y: y / landmarks.length }; }

// No gesture detector removed
// function detectNoGesture(handLandmarks, isRight) {
//   // simple two-finger shape; thumb may be visible
//   const index = fingerExtended(handLandmarks, 8, 5);
//   const middle = fingerExtended(handLandmarks, 12, 9);
//   const ring = fingerExtended(handLandmarks, 16, 13);
//   const pinky = fingerExtended(handLandmarks, 20, 17);
//   if (index && middle && !ring && !pinky) {
//     return { name: 'No', confidence: 80 };
//   }
//   return null;
//}

function detectHelloGesture(handLandmarks) { if (handHistory.length < 8) return null; const recentFrames = handHistory.slice(-8); const centroids = recentFrames.map(frame => { if (frame.length === 0) return null; return getHandCentroid(frame[0]); }).filter(c => c !== null); if (centroids.length < 4) return null; let totalXMovement = 0; for (let i = 1; i < centroids.length; i++) { totalXMovement += Math.abs(centroids[i].x - centroids[i - 1].x); } const avgXMovement = totalXMovement / (centroids.length - 1); if (avgXMovement > 0.02) { const avgY = centroids.reduce((sum, c) => sum + c.y, 0) / centroids.length; if (avgY < 0.5) { return { name: 'Hello', confidence: 80 }; } } return null; }

// Good gesture detection temporarily disabled; returns null so callers can stay unchanged
function detectGoodGesture(handLandmarks) {
  return null;
}

function detectThankYouGesture(handLandmarks) { if (handHistory.length < 8) return null; const recentFrames = handHistory.slice(-8); const centroids = recentFrames.map(frame => { if (frame.length === 0) return null; return getHandCentroid(frame[0]); }).filter(c => c !== null); if (centroids.length < 4) return null; let totalYMovement = 0; for (let i = 1; i < centroids.length; i++) { totalYMovement += (centroids[i].y - centroids[i - 1].y); } const avgYMovement = totalYMovement / (centroids.length - 1); if (avgYMovement > 0.02) { return { name: 'Thank You', confidence: 80 }; } return null; }

// How gesture detection temporarily disabled; returns null for simplicity
function detectHowGesture(allLandmarks, handedness) {
  return null;
}

function detectStopGesture(allLandmarks, handedness) { if (allLandmarks.length !== 2) return null; const l1 = allLandmarks[0]; const l2 = allLandmarks[1]; const b1 = bboxFromLandmarks(l1); const b2 = bboxFromLandmarks(l2); const topBBox = b1.cy < b2.cy ? b1 : b2; const bottomBBox = b1.cy < b2.cy ? b2 : b1; const verticalGap = bottomBBox.y1 - topBBox.y2; const xOverlap = !(topBBox.x2 < bottomBBox.x1 || topBBox.x1 > bottomBBox.x2); if (xOverlap && verticalGap <= 0.05) { return { name: 'Stop', confidence: 85 }; } return null; }

function onResults(results) {
  try {
    resizeCanvas();
    overlayCtx.clearRect(0, 0, overlay.width, 0);

    const multi = results.multiHandLandmarks || [];
    const handedness = results.multiHandedness || [];

  // DEBUG: Log hand detection and update UI label
  // debug: hand count logged above if needed
  if (multi.length >= 2) {
    const b1 = bboxFromLandmarks(multi[0]);
    const b2 = bboxFromLandmarks(multi[1]);
    const centerDist = Math.hypot(b1.cx - b2.cx, b1.cy - b2.cy);
    const avgHandSize = (Math.max(b1.w, b1.h) + Math.max(b2.w, b2.h)) / 2;
  }

  // Store hand positions for motion tracking
  if (multi.length > 0) {
    handHistory.push(multi);
    if (handHistory.length > MAX_HISTORY) {
      handHistory.shift();
    }
  }

  // Save context, flip horizontally to match mirrored video, then restore
  overlayCtx.save();
  overlayCtx.scale(-1, 1);
  overlayCtx.translate(-overlay.width, 0);

  // Draw all hands with green highlighting for detected gestures
  let detectedGesture = null;

  // Check for motion-based gestures (single hand)
  if (multi.length === 1) {
    // determine handedness for this hand
    const isRight = (handedness[0] && handedness[0].label && handedness[0].label.toLowerCase().startsWith('right'));

    const hello = detectHelloGesture(multi[0]);
    if (hello) {
      detectedGesture = hello.name;
      lastGestureDetected = hello.name;
      lastGestureTime = Date.now();
      // Draw hand in green
      drawConnectors(overlayCtx, multi[0], HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 3 });
      drawLandmarks(overlayCtx, multi[0], { color: '#00FF00', lineWidth: 2 });
      overlayCtx.restore();
      
      // Update status and overlay
      leftLabelEl.textContent = `Current Gesture: ${detectedGesture}`;
      leftLabelEl.style.color = '#00FF00';
      gestureOverlayEl.textContent = detectedGesture;
      gestureOverlayEl.style.display = 'block';
      return;
    }
    
    // "No" gesture detection has been removed for demo simplicity
    /*
    const no = detectNoGesture(multi[0], isRight);
    if (no) {
      detectedGesture = no.name;
      lastGestureDetected = no.name;
      lastGestureTime = Date.now();
      // Draw hand in green
      drawConnectors(overlayCtx, multi[0], HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 3 });
      drawLandmarks(overlayCtx, multi[0], { color: '#00FF00', lineWidth: 2 });
      overlayCtx.restore();
      
      // Update status and overlay
      leftLabelEl.textContent = `Current Gesture: ${detectedGesture}`;
      leftLabelEl.style.color = '#00FF00';
      gestureOverlayEl.textContent = detectedGesture;
      gestureOverlayEl.style.display = 'block';
      return;
    }
    */
    
    const thankYou = detectThankYouGesture(multi);
    if (thankYou) {
      detectedGesture = thankYou.name;
      lastGestureDetected = thankYou.name;
      lastGestureTime = Date.now();
      // Draw hand in green
      drawConnectors(overlayCtx, multi[0], HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 3 });
      drawLandmarks(overlayCtx, multi[0], { color: '#00FF00', lineWidth: 2 });
      overlayCtx.restore();
      
      // Update status and overlay
      leftLabelEl.textContent = `Current Gesture: ${detectedGesture}`;
      leftLabelEl.style.color = '#00FF00';
      gestureOverlayEl.textContent = detectedGesture;
      gestureOverlayEl.style.display = 'block';
      return;
    }
    
  }

  // Check for two-hand gestures first (stop only – Good/How are temporarily disabled)
  if (multi.length === 2) {
    /*
    // static how (thumbs-up fists touching) – on hold
    const how = detectHowGesture(multi, handedness);
    if (how) {
      detectedGesture = how.name;
      lastGestureDetected = how.name;
      lastGestureTime = Date.now();
      // draw both hands in green
      drawConnectors(overlayCtx, multi[0], HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 3 });
      drawLandmarks(overlayCtx, multi[0], { color: '#00FF00', lineWidth: 2 });
      drawConnectors(overlayCtx, multi[1], HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 3 });
      drawLandmarks(overlayCtx, multi[1], { color: '#00FF00', lineWidth: 2 });
      overlayCtx.restore();
      // Update status and overlay
      leftLabelEl.textContent = `Current Gesture: ${detectedGesture}`;
      leftLabelEl.style.color = '#00FF00';
      gestureOverlayEl.textContent = detectedGesture;
      gestureOverlayEl.style.display = 'block';
      return;
    }

    // Check motion-based two-hand gestures first
    const good = detectGoodGesture(multi);
    if (good) {
      detectedGesture = good.name;
      lastGestureDetected = good.name;
      lastGestureTime = Date.now();
      // Draw both hands in green for detected two-hand gestures
      for (let j = 0; j < multi.length; j++) {
        const lm2 = multi[j];
        drawConnectors(overlayCtx, lm2, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 3 });
        drawLandmarks(overlayCtx, lm2, { color: '#00FF00', lineWidth: 2 });
      }
      overlayCtx.restore();
      
      // Update status and overlay
      leftLabelEl.textContent = `Current Gesture: ${detectedGesture}`;
      leftLabelEl.style.color = '#00FF00';
      gestureOverlayEl.textContent = detectedGesture;
      gestureOverlayEl.style.display = 'block';
      return;
    }
    */
    const stop = detectStopGesture(multi, handedness);
    if (stop) {
      detectedGesture = stop.name;
      lastGestureDetected = 'Stop';
      lastGestureTime = Date.now();
      // Draw both hands in green for detected two-hand gestures
      for (let j = 0; j < multi.length; j++) {
        const lm2 = multi[j];
        drawConnectors(overlayCtx, lm2, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 3 });
        drawLandmarks(overlayCtx, lm2, { color: '#00FF00', lineWidth: 2 });
      }
      overlayCtx.restore();
      
      // Update status and overlay
      leftLabelEl.textContent = `Current Gesture: ${detectedGesture}`;
      leftLabelEl.style.color = '#00FF00';
      gestureOverlayEl.textContent = detectedGesture;
      gestureOverlayEl.style.display = 'block';
      return;
    }
  }

  // Check for single-hand gestures including "How" and "You"
  for (let i = 0; i < multi.length; i++) {
    const lm = multi[i];
    const isRight = (handedness[i] && handedness[i].label && handedness[i].label.toLowerCase().startsWith('right'));

    let gestureColor = '#FF0000'; // Default red

    if (multi.length === 1) {
      // Check for single-hand gestures
      const single = detectSingleGesture(lm, isRight);
      
      // Don't switch away from Stop if we're still in the lock period
      const now = Date.now();
      const inStopLock = lastGestureDetected === 'Stop' && (now - lastGestureTime) < GESTURE_LOCK_TIME;
      
      if (single && ['Bye', 'I Love You', /* 'You', */ 'Yes'].includes(single.name) && !inStopLock) {
        detectedGesture = single.name;
        lastGestureDetected = single.name;
        lastGestureTime = now;
        gestureColor = '#00FF00'; // Green for detected gestures
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
  } else if ((lastGestureDetected === 'Stop' || lastGestureDetected === 'How' || /*'No'*/ 'Hello' || lastGestureDetected === 'Thank You' || lastGestureDetected === 'Good' || lastGestureDetected === 'Bye') && 
             (Date.now() - lastGestureTime) < GESTURE_LOCK_TIME) {
    // Keep showing gesture during lock period
    leftLabelEl.textContent = `Current Gesture: ${lastGestureDetected}`;
    leftLabelEl.style.color = '#00FF00';
    gestureOverlayEl.textContent = lastGestureDetected;
    gestureOverlayEl.style.display = 'block';
  } else {
    // Clear gesture lock if time expired
    if (lastGestureDetected && (Date.now() - lastGestureTime) >= GESTURE_LOCK_TIME) {
      lastGestureDetected = null;
    }
    
    leftLabelEl.textContent = 'Sign Language Detector';
    leftLabelEl.style.color = '#fff'; // White text for default state
    
    // Hide overlay when no gesture detected
    gestureOverlayEl.style.display = 'none';
  }
  } catch (e) {
    console.error('onResults error', e);
  }
}

// Initialize – start camera immediately and also after mapping loads
// (camera on its own should not depend on mapping fetch)
initCamera();
loadMapping().then(() => {
  initCamera();
});