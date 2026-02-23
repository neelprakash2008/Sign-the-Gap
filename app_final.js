// Clean, final version of sign detection + speech app

const videoEl = document.getElementById('video');
const overlay = document.getElementById('overlay');
const overlayCtx = overlay.getContext('2d');
const speechTextEl = document.getElementById('speech-text');
const leftLabelEl = document.getElementById('left-label');
const gestureOverlayEl = document.getElementById('gesture-overlay');
const speechBtn = document.getElementById('speech-btn');
const fullscreenBtn = document.getElementById('fullscreen-btn');

let camera = null;
let speechActive = false;
let fullscreenMode = false;
let mapping = {};
let currentVideo = null;
let lastRecognizedText = '';

let handHistory = [];
const MAX_HISTORY = 20;
let lastGestureDetected = null;
let lastGestureTime = 0;
const GESTURE_LOCK_TIME = 300;

async function loadMapping() {
  try {
    const response = await fetch('clips/mapping.json');
    mapping = await response.json();
  } catch (error) {
    mapping = {
      hello: ['hello.mp4'],
      help: ['help.mp4'],
      'i love you': ['i_love_you.mp4']
    };
  }
}

function playVideo(clipName) {
  return new Promise((resolve) => {
    const videoPath = `clips/${clipName}`;
    if (!currentVideo) {
      currentVideo = document.createElement('video');
      currentVideo.style.width = '100%';
      currentVideo.style.height = '100%';
      currentVideo.style.objectFit = 'contain';
      currentVideo.style.backgroundColor = '#000';
      currentVideo.controls = false;
      currentVideo.muted = true;
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
      const speechContent = document.getElementById('right-content');
      speechContent.innerHTML = `
        <div id="right-label">Speech to Sign (SPACE to start/stop)</div>
        <div id="speech-text"></div>
      `;
      const newSpeechTextEl = document.getElementById('speech-text');
      if (speechActive) {
        newSpeechTextEl.textContent = `${lastRecognizedText} (listening...)`;
      }
      currentVideo = null;
      resolve();
    };
    currentVideo.onerror = () => {
      const speechContent = document.getElementById('right-content');
      speechContent.innerHTML = `
        <div id="right-label">Speech to Sign (SPACE to start/stop)</div>
        <div id="speech-text"></div>
      `;
      const newSpeechTextEl = document.getElementById('speech-text');
      newSpeechTextEl.textContent = `Video not found: ${clipName}`;
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
  if (mapping[normalizedText]) {
    for (const clip of mapping[normalizedText]) {
      await playVideo(clip);
    }
    return;
  }
  const words = normalizedText.split(' ');
  for (const word of words) {
    if (mapping[word]) {
      for (const clip of mapping[word]) {
        await playVideo(clip);
      }
    }
  }
}

async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    videoEl.srcObject = stream;
    await videoEl.play();
    resizeCanvas();
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
    if (speechActive) {
      setTimeout(() => { if (speechActive) recognition.start(); }, 100);
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
    speechTextEl.textContent = fullText;
    if (final.trim()) {
      lastRecognizedText = final.trim();
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
    recognition.stop();
  } else {
    lastRecognizedText = '';
    speechActive = true;
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

speechBtn.addEventListener('click', toggleSpeech);
fullscreenBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); toggleSpeech(); }
  if (e.code === 'F11') { e.preventDefault(); toggleFullscreen(); }
  if (e.code === 'Escape') { window.close(); }
});

function fingerExtended(landmarks, tipIdx, mcpIdx) {
  const tip = landmarks[tipIdx];
  const mcp = landmarks[mcpIdx];
  const dy = mcp.y - tip.y;
  const dist = Math.hypot(tip.x - mcp.x, tip.y - mcp.y);
  return dy > 0.01 || dist > 0.1;
}

function thumbExtended(landmarks, isRight) {
  const tip = landmarks[4], mcp = landmarks[2];
  return isRight ? (tip.x < mcp.x) : (tip.x > mcp.x);
}

function bboxFromLandmarks(landmarks) { ... }
function thumbOnPalm(thumbLandmarks, palmBBox) { ... }
// plus all detect* functions unchanged

// (rest of file identical to final app.js, trimmed here for brevity)

loadMapping().then(() => { initCamera(); });