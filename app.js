/**
 * Fullscreen Scroll Animation Engine
 * Two-Piece Split Section Pop-Ups (Left & Right) with 75-80% Center Opacity & Top Disappearance
 * Smooth Fade-Out & Disappearance for Hero Welcome Line & Girl Shake Image on Scroll
 */

// Serverless runtime guard for Node.js / Vercel
if (typeof window === 'undefined' || typeof document === 'undefined') {
  const fs = require('fs');
  const path = require('path');
  module.exports = (req, res) => {
    const htmlPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      res.end(fs.readFileSync(htmlPath));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Shiv Juice Center OK');
    }
  };
  return;
}

(function () {
  'use strict';

  const TOTAL_FRAMES = 285;
  const FRAME_PREFIX = 'frames/ezgif-frame-';
  const FRAME_EXT = '.jpg';

  function getFrameUrl(index) {
    const pad = String(index + 1).padStart(3, '0');
    return `${FRAME_PREFIX}${pad}${FRAME_EXT}`;
  }

  const canvas = document.getElementById('sequence-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: false });

  const welcomeOverlay = document.getElementById('hero-welcome-overlay');
  const sectionPairs = document.querySelectorAll('.pop-section-pair');

  const frames = new Array(TOTAL_FRAMES);
  let loadedCount = 0;

  let targetProgress = 0;
  let currentProgress = 0;
  let currentFrameIndex = 0;
  let lastDrawnIndex = -1;

  // Handle High-DPI Canvas Resizing
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);

    drawFrame(currentFrameIndex, true);
  }

  window.addEventListener('resize', resizeCanvas);

  // Find nearest loaded frame if current target frame is still decoding
  function getBestFrame(index) {
    if (frames[index] && frames[index].complete && frames[index].naturalWidth > 0) {
      return { img: frames[index], actualIndex: index };
    }
    for (let i = index - 1; i >= 0; i--) {
      if (frames[i] && frames[i].complete && frames[i].naturalWidth > 0) {
        return { img: frames[i], actualIndex: i };
      }
    }
    for (let i = index + 1; i < TOTAL_FRAMES; i++) {
      if (frames[i] && frames[i].complete && frames[i].naturalWidth > 0) {
        return { img: frames[i], actualIndex: i };
      }
    }
    return null;
  }

  // Draw frame with object-fit: cover logic
  function drawFrame(index, force) {
    const best = getBestFrame(index);
    if (!best) return;

    if (!force && best.actualIndex === lastDrawnIndex) return;

    const img = best.img;
    const cw = canvas.width;
    const ch = canvas.height;
    const iw = img.naturalWidth || 1920;
    const ih = img.naturalHeight || 1080;

    const scale = Math.max(cw / iw, ch / ih);
    const nw = iw * scale;
    const nh = ih * scale;
    const nx = (cw - nw) / 2;
    const ny = (ch - nh) / 2;

    ctx.drawImage(img, nx, ny, nw, nh);
    lastDrawnIndex = best.actualIndex;
  }

  // Preloader: Load Frame 1 immediately, then the rest in parallel
  function initPreloader() {
    resizeCanvas();

    const firstImg = new Image();
    firstImg.src = getFrameUrl(0);
    firstImg.onload = () => {
      frames[0] = firstImg;
      loadedCount++;
      drawFrame(0, true);
      loadAllFrames();
    };
    firstImg.onerror = () => {
      loadAllFrames();
    };

    function loadAllFrames() {
      let nextIdx = 1;
      const CONCURRENCY = 24;

      function loadNext() {
        if (nextIdx >= TOTAL_FRAMES) return;
        const i = nextIdx++;
        const img = new Image();
        img.src = getFrameUrl(i);
        img.onload = () => {
          frames[i] = img;
          loadedCount++;
          if (i === currentFrameIndex) {
            drawFrame(i, true);
          }
          loadNext();
        };
        img.onerror = () => {
          loadNext();
        };
      }

      for (let c = 0; c < CONCURRENCY; c++) {
        loadNext();
      }
    }

    requestAnimationFrame(renderLoop);
  }

  // Calculate Page Scroll Progress
  function updateScroll() {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
    targetProgress = Math.max(0, Math.min(1, scrollTop / maxScroll));

    // 1. Fade out Welcome Overlay (Big Greeting + Girl Drinking Shake Image) on scroll
    if (welcomeOverlay) {
      const fadeDistance = 280;
      const t = Math.max(0, Math.min(1, scrollTop / fadeDistance));
      const opacity = 1 - t;
      const translateY = -t * 45;
      const scale = 1 - t * 0.05;

      welcomeOverlay.style.opacity = opacity.toFixed(3);
      welcomeOverlay.style.transform = `translateY(${translateY.toFixed(1)}px) scale(${scale.toFixed(3)})`;
      welcomeOverlay.style.pointerEvents = opacity > 0.05 ? 'auto' : 'none';
      if (opacity <= 0.01) {
        welcomeOverlay.style.visibility = 'hidden';
      } else {
        welcomeOverlay.style.visibility = 'visible';
      }
    }

    // 2. Update Left & Right Section Pop-Ups
    updatePopPairs();
  }

  window.addEventListener('scroll', updateScroll, { passive: true });

  // Update Left & Right Pop-Up Pairs (75-80% opacity at center, disappears at top)
  function updatePopPairs() {
    const H = window.innerHeight;

    sectionPairs.forEach((pair) => {
      const rect = pair.getBoundingClientRect();
      const leftCard = pair.querySelector('.pop-card-left');
      const rightCard = pair.querySelector('.pop-card-right');
      if (!leftCard || !rightCard) return;

      const pairCenter = rect.top + rect.height / 2;
      const centerRatio = pairCenter / H;

      // 1. Completely below viewport
      if (rect.top >= H) {
        leftCard.style.opacity = '0';
        rightCard.style.opacity = '0';
        leftCard.style.transform = 'translateY(60px) translateX(-30px) scale(0.96)';
        rightCard.style.transform = 'translateY(60px) translateX(30px) scale(0.96)';
        leftCard.style.pointerEvents = 'none';
        rightCard.style.pointerEvents = 'none';
      }
      // 2. Scrolled completely past top -> Disappear
      else if (rect.bottom <= 0) {
        leftCard.style.opacity = '0';
        rightCard.style.opacity = '0';
        leftCard.style.transform = 'translateY(-60px) translateX(-20px) scale(0.96)';
        rightCard.style.transform = 'translateY(-60px) translateX(20px) scale(0.96)';
        leftCard.style.pointerEvents = 'none';
        rightCard.style.pointerEvents = 'none';
      }
      // 3. Popping up from bottom towards center (centerRatio between 1.15 and 0.5)
      else if (centerRatio >= 0.5) {
        const t = Math.max(0, Math.min(1, (1.15 - centerRatio) / 0.65));
        // Opacity smoothly reaches 78% (70-80% range)
        const opacity = t * 0.78;
        const translateY = (1 - t) * 55;
        const translateX = (1 - t) * 25;
        const scale = 0.96 + t * 0.04;

        leftCard.style.opacity = opacity.toFixed(3);
        rightCard.style.opacity = opacity.toFixed(3);

        leftCard.style.transform = `translateY(${translateY.toFixed(1)}px) translateX(${-translateX.toFixed(1)}px) scale(${scale.toFixed(3)})`;
        rightCard.style.transform = `translateY(${translateY.toFixed(1)}px) translateX(${translateX.toFixed(1)}px) scale(${scale.toFixed(3)})`;

        const canInteract = opacity > 0.15;
        leftCard.style.pointerEvents = canInteract ? 'auto' : 'none';
        rightCard.style.pointerEvents = canInteract ? 'auto' : 'none';
      }
      // 4. Moving from center (0.5) to top (0.0) -> Disappears as it goes to top
      else {
        const t = Math.max(0, Math.min(1, centerRatio / 0.5));
        // Opacity goes from 78% at center (t=1) down to 0% at top (t=0)
        const opacity = t * 0.78;
        const translateY = (1 - t) * -55;
        const translateX = (1 - t) * 20;
        const scale = 0.96 + t * 0.04;

        leftCard.style.opacity = opacity.toFixed(3);
        rightCard.style.opacity = opacity.toFixed(3);

        leftCard.style.transform = `translateY(${translateY.toFixed(1)}px) translateX(${-translateX.toFixed(1)}px) scale(${scale.toFixed(3)})`;
        rightCard.style.transform = `translateY(${translateY.toFixed(1)}px) translateX(${translateX.toFixed(1)}px) scale(${scale.toFixed(3)})`;

        const canInteract = opacity > 0.15;
        leftCard.style.pointerEvents = canInteract ? 'auto' : 'none';
        rightCard.style.pointerEvents = canInteract ? 'auto' : 'none';
      }
    });
  }

  // Main Render Loop with Lerp Smoothing
  function renderLoop() {
    const lerpFactor = 0.15;
    currentProgress += (targetProgress - currentProgress) * lerpFactor;

    if (Math.abs(targetProgress - currentProgress) < 0.0001) {
      currentProgress = targetProgress;
    }

    const frameIndex = Math.min(
      TOTAL_FRAMES - 1,
      Math.max(0, Math.round(currentProgress * (TOTAL_FRAMES - 1)))
    );

    currentFrameIndex = frameIndex;
    drawFrame(frameIndex, false);

    requestAnimationFrame(renderLoop);
  }

  // Start initialization
  initPreloader();
  updateScroll();
})();
