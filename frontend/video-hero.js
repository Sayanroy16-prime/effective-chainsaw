/* =====================================================================
   METRO VIDEO HERO — POST-LOGIN IMMERSIVE EXPERIENCE
   Brought from scroll-locked-video-hero.tsx
   - 3D cursor tilt card
   - Drifting immersive background with radial light wash
   - Stutter-free seamless dual-video crossfade
   - Coverflow momentum physics & Web Audio rotary click detents
   - Minimal geometry mode vs Video mode
   - "LAUNCH PDS HOMEPAGE" cinematic warp transition
   ===================================================================== */

(function () {
  const REPO = "https://raw.githubusercontent.com/gughigug/run-hero-assets/main";
  const DEFAULT_VIDEO = `${REPO}/Legs_sprinting_on_pavement_1080p_202608312152.mp4`;
  const DEFAULT_BG = `${REPO}/bg-immersive.jpg`;

  const TRACKS = [
    { id: "t1", title: "Grain Flow Actuator", artist: "ESP32 Servo 13/14/25", colorA: "#5db8ff", colorB: "#0b407d" },
    { id: "t2", title: "Strain Load Cell", artist: "HX711 24-bit 5kg Sensor", colorA: "#ff8a5c", colorB: "#7a3418" },
    { id: "t3", title: "Optical Biometrics", artist: "R307S UART2 Fingerprint", colorA: "#4fd8e0", colorB: "#0e4a4c" },
    { id: "t4", title: "RFID Mifare Core", artist: "MFRC522 VSPI 13.56MHz", colorA: "#ffb35c", colorB: "#7a4a10" },
    { id: "t5", title: "Container IR Detect", artist: "GPIO 34 ADC1 Interlock", colorA: "#6c9fff", colorB: "#132248" },
    { id: "t6", title: "Silo Hopper Radar", artist: "GPIO 35 Grain Monitor", colorA: "#5ce0c6", colorB: "#0e4a3c" },
    { id: "t7", title: "Supabase Cloud API", artist: "smart_ration_input v1", colorA: "#ffcc66", colorB: "#7a5410" },
    { id: "t8", title: "Tamil Audio Synthesizer", artist: "DFPlayer Mini UART1", colorA: "#8ab8ff", colorB: "#1a2a5c" },
    { id: "t9", title: "Night Drift", artist: "Halcyon Bloom", colorA: "#5db8ff", colorB: "#0b407d" },
    { id: "t10", title: "Low Static", artist: "Marbled Glass", colorA: "#ff8a5c", colorB: "#7a3418" },
    { id: "t11", title: "Concrete Bloom", artist: "Faded Radio", colorA: "#4fd8e0", colorB: "#0e4a4c" },
    { id: "t12", title: "Second Wind", artist: "Pale Signal", colorA: "#ffb35c", colorB: "#7a4a10" },
  ];

  const ROW_HEIGHT = 60;
  const CYAN = "#74b9f1";
  const AMBER = "#f3724c";
  const MAX_VIDEO_VOLUME = 0.32;
  const CROSSFADE_S = 1.0;

  let audioCtx = null;
  let offset = 0;
  let velocity = 0;
  let snapTarget = null;
  let lastDetent = 0;
  let isDragging = false;
  let lastDragY = 0;
  let lastDragT = 0;
  let activeIndex = 0;
  let isPlaying = true;
  let isFullscreen = false;
  let theme = "video"; // 'video' | 'minimal'
  let videoSoundOn = false;
  let videoVolume = 0.16;
  let activeVideo = "a";
  let isCrossfading = false;
  let animFramePhysics = null;
  let animFrameRender = null;
  let animFrameLoop = null;

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function mod(n, m) { return ((n % m) + m) % m; }

  function getAudioContext() {
    try {
      if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) audioCtx = new Ctx();
      }
      return audioCtx;
    } catch (e) {
      return null;
    }
  }

  function playWheelClick(ctx, vel) {
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const strength = clamp(vel, 0, 1);
      const bufferSize = Math.floor(ctx.sampleRate * 0.012);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2.6);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 4200 + strength * 700;
      bp.Q.value = 3;
      const gain = ctx.createGain();
      const vol = 0.11 + strength * 0.07;
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
      noise.connect(bp);
      bp.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
    } catch (e) {}
  }

  function fireClick(vel) {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      ctx.resume().then(() => playWheelClick(ctx, vel)).catch(() => {});
    } else {
      playWheelClick(ctx, vel);
    }
  }

  // Build the DOM structure inside #hero-screen
  function setupHeroDOM() {
    const heroEl = document.getElementById("hero-screen");
    if (!heroEl) return;

    heroEl.innerHTML = `
      <div id="mh-container" class="mh-container">
        <!-- Drifting Background Image & Glows -->
        <div id="mh-bg-glow" class="mh-bg-glow"></div>
        <div id="mh-bg-img" class="mh-bg-img" style="background-image: url('${DEFAULT_BG}');"></div>
        <div id="mh-bg-vignette" class="mh-bg-vignette"></div>

        <!-- Minimal Mode Backdrop (Canvas/SVG geometric animations) -->
        <div id="mh-minimal-backdrop" class="mh-minimal-backdrop" style="display: none;">
          <div class="mh-geo-orb mh-geo-orb-1"></div>
          <div class="mh-geo-orb mh-geo-orb-2"></div>
          <div class="mh-geo-ring mh-geo-ring-1"></div>
          <div class="mh-geo-ring mh-geo-ring-2"></div>
          <div class="mh-geo-chip mh-geo-chip-1"></div>
          <div class="mh-geo-chip mh-geo-chip-2"></div>
          <div class="mh-geo-chip mh-geo-chip-3"></div>
        </div>

        <!-- Top Right Action Controls -->
        <div class="mh-top-bar">
          <button id="mh-btn-theme" class="mh-circle-btn" title="Toggle Theme (Video / Minimal)" aria-label="Toggle Theme">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12a9 9 0 0 1-9 9c-2.5 0-4.7-1-6.3-2.7M3 12a9 9 0 0 1 9-9c2.5 0 4.7 1 6.3 2.7M3 8v4h4M21 16v-4h-4"/>
            </svg>
          </button>
          <button id="mh-btn-sound" class="mh-circle-btn" title="Toggle Ambient Audio" aria-label="Toggle Ambient Audio">
            <svg id="mh-icon-sound-on" style="display:none;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 5 6 9H2v6h4l5 4V5z"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
            <svg id="mh-icon-sound-off" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 5 6 9H2v6h4l5 4V5z"/>
              <line x1="23" y1="9" x2="17" y2="15"/>
              <line x1="17" y1="9" x2="23" y2="15"/>
            </svg>
          </button>
          <button id="mh-btn-fullscreen" class="mh-circle-btn" title="Toggle Wide View" aria-label="Toggle Wide View">
            <svg id="mh-icon-fs-enter" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3"/>
            </svg>
            <svg id="mh-icon-fs-exit" style="display:none;" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 3v4a1 1 0 0 1-1 1H4M15 3v4a1 1 0 0 0 1 1h4M9 21v-4a1 1 0 0 0-1-1H4M15 21v-4a1 1 0 0 1 1-1h4"/>
            </svg>
          </button>
          <!-- Direct Homepage Launcher CTA -->
          <button id="mh-btn-launch-home" class="mh-launch-btn pulse-glow" title="Proceed to Operational Terminal">
            <span>ENTER HOMEPAGE</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>
        </div>

        <!-- Main Center Stage -->
        <div class="mh-stage-center">
          <div class="mh-header-titles">
            <span class="mh-badge-tag">AUTHENTICATED • ACCESS CLEARED</span>
            <h1 class="mh-title">THE SOUNDTRACK TO EVERY STEP</h1>
            <p class="mh-signature">IoT Smart Ration Dispenser Terminal • Tamil Nadu Civil Supplies</p>
          </div>

          <!-- 3D Card Lens Wrapper -->
          <div class="mh-card-lens-wrap">
            <div class="mh-lens-glow" aria-hidden="true"></div>
            
            <div id="mh-card" class="mh-card" tabindex="0" role="region" aria-label="Music and Telemetry Player">
              <!-- Dual Crossfading Video Wrappers -->
              <div id="mh-video-wrap" class="mh-video-wrap">
                <video id="mh-video-a" class="mh-video" src="${DEFAULT_VIDEO}" playsinline preload="auto" loop muted></video>
                <video id="mh-video-b" class="mh-video" src="${DEFAULT_VIDEO}" playsinline preload="auto" loop muted style="opacity:0;"></video>
                <div class="mh-card-vignette"></div>
                <div class="mh-card-bottom-wash"></div>
              </div>

              <!-- Coverflow List Viewport -->
              <div id="mh-list-viewport" class="mh-list-viewport">
                <div id="mh-track-list-anchor" class="mh-track-list-anchor">
                  ${TRACKS.map((t, i) => `
                    <div class="mh-track-row" id="mh-row-${i}" data-index="${i}">
                      <div class="mh-track-art" style="background: linear-gradient(135deg, ${t.colorA}, ${t.colorB});">
                        <div class="mh-track-art-sheen"></div>
                      </div>
                      <div class="mh-track-info">
                        <div class="mh-track-title">${t.title}</div>
                        <div class="mh-track-artist">${t.artist}</div>
                      </div>
                      <div class="mh-track-eq">
                        <span class="mh-eq-bar b1" style="background:${t.colorA};"></span>
                        <span class="mh-eq-bar b2" style="background:${t.colorA};"></span>
                        <span class="mh-eq-bar b3" style="background:${t.colorA};"></span>
                      </div>
                    </div>
                  `).join("")}
                </div>
              </div>

              <!-- Media Player Control Bar -->
              <div class="mh-player-controls">
                <div class="mh-player-left">
                  <div id="mh-active-art" class="mh-ctrl-art"></div>
                  <div class="mh-ctrl-meta">
                    <div id="mh-active-title" class="mh-ctrl-title"></div>
                    <div id="mh-active-artist" class="mh-ctrl-artist"></div>
                  </div>
                </div>

                <div class="mh-player-center">
                  <button id="mh-btn-prev" class="mh-icon-btn" aria-label="Previous Track">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 6h2v12H6zM20 6 10 12l10 6z"/>
                    </svg>
                  </button>
                  <button id="mh-btn-play" class="mh-play-btn" aria-label="Play or Pause">
                    <svg id="mh-icon-pause" width="14" height="14" viewBox="0 0 24 24" fill="#05060a">
                      <rect x="6" y="5" width="4" height="14" rx="1"/>
                      <rect x="14" y="5" width="4" height="14" rx="1"/>
                    </svg>
                    <svg id="mh-icon-play" style="display:none;" width="14" height="14" viewBox="0 0 24 24" fill="#05060a">
                      <path d="M7 5v14l12-7z"/>
                    </svg>
                  </button>
                  <button id="mh-btn-next" class="mh-icon-btn" aria-label="Next Track">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M16 6h2v12h-2zM4 6l10 6-10 6z"/>
                    </svg>
                  </button>
                </div>

                <div class="mh-player-right">
                  <div class="mh-progress-track">
                    <div id="mh-progress-fill" class="mh-progress-fill"></div>
                  </div>
                  <input id="mh-vol-slider" class="mh-vol-slider" type="range" min="0" max="${MAX_VIDEO_VOLUME}" step="0.01" value="${videoVolume}" aria-label="Ambient volume" />
                </div>
              </div>

            </div>
          </div>

          <!-- Bottom Shortcut Tip -->
          <div class="mh-footer-hint">
            <span>Scroll wheel or touch to flip tracks</span>
            <span>•</span>
            <span>Press <kbd>Space</kbd> to Play/Pause</span>
            <span>•</span>
            <span>Press <kbd>Enter</kbd> to Launch Homepage</span>
          </div>
        </div>
      </div>
    `;

    bindHeroEvents();
  }

  function bindHeroEvents() {
    const card = document.getElementById("mh-card");
    const bgImg = document.getElementById("mh-bg-img");
    const videoWrap = document.getElementById("mh-video-wrap");
    const btnTheme = document.getElementById("mh-btn-theme");
    const btnSound = document.getElementById("mh-btn-sound");
    const btnFs = document.getElementById("mh-btn-fullscreen");
    const btnPlay = document.getElementById("mh-btn-play");
    const btnPrev = document.getElementById("mh-btn-prev");
    const btnNext = document.getElementById("mh-btn-next");
    const volSlider = document.getElementById("mh-vol-slider");
    const btnLaunch = document.getElementById("mh-btn-launch-home");
    const videoA = document.getElementById("mh-video-a");
    const videoB = document.getElementById("mh-video-b");

    // Start video playback
    if (videoA) {
      videoA.volume = videoVolume;
      videoA.muted = !videoSoundOn;
      videoA.play().catch(() => {});
    }
    if (videoB) {
      videoB.volume = videoVolume;
      videoB.muted = !videoSoundOn;
    }

    // 3D Tilt calculation on pointer move
    if (card) {
      card.addEventListener("pointermove", (e) => {
        if (theme === "minimal") return;
        const rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;

        if (isFullscreen) {
          if (videoWrap) {
            videoWrap.style.transition = "transform 0.05s linear";
            videoWrap.style.transform = `scale(1.45) rotateY(${px * 26}deg) rotateX(${-py * 20}deg)`;
          }
        } else {
          card.style.transition = "transform 0.05s linear";
          card.style.transform = `rotateY(${px * 46}deg) rotateX(${-py * 38}deg) scale(1.03)`;
          if (bgImg) {
            bgImg.style.transform = `translate(${-px * 34}px, ${-py * 24}px) scale(1.06)`;
          }
        }
      });

      card.addEventListener("pointerleave", () => {
        if (theme === "minimal") return;
        if (isFullscreen) {
          if (videoWrap) {
            videoWrap.style.transition = "transform 0.6s cubic-bezier(.2,.8,.2,1)";
            videoWrap.style.transform = "scale(1.45) rotateY(0deg) rotateX(0deg)";
          }
        } else {
          card.style.transition = "transform 0.6s cubic-bezier(.2,.8,.2,1)";
          card.style.transform = "rotateY(-13deg) rotateX(5deg) scale(1)";
          if (bgImg) {
            bgImg.style.transition = "transform 0.6s cubic-bezier(.2,.8,.2,1)";
            bgImg.style.transform = "translate(0px, 0px) scale(1.06)";
          }
        }
      });
    }

    // Scroll wheel momentum
    window.addEventListener("wheel", (e) => {
      const heroEl = document.getElementById("hero-screen");
      if (!heroEl || heroEl.style.display === "none") return;
      e.preventDefault();
      snapTarget = null;
      velocity += e.deltaY * 0.045;
      velocity = clamp(velocity, -14, 14);
      fireClick(0.3);
    }, { passive: false });

    // Touch momentum
    window.addEventListener("touchstart", (e) => {
      const heroEl = document.getElementById("hero-screen");
      if (!heroEl || heroEl.style.display === "none") return;
      isDragging = true;
      snapTarget = null;
      velocity = 0;
      lastDragY = e.touches[0] ? e.touches[0].clientY : 0;
      lastDragT = performance.now();
    }, { passive: true });

    window.addEventListener("touchmove", (e) => {
      const heroEl = document.getElementById("hero-screen");
      if (!heroEl || heroEl.style.display === "none" || !isDragging) return;
      e.preventDefault();
      const y = e.touches[0] ? e.touches[0].clientY : lastDragY;
      const dy = lastDragY - y;
      offset += dy;
      const t = performance.now();
      const dt = Math.max(1, t - lastDragT);
      velocity = (dy / dt) * 16;
      lastDragY = y;
      lastDragT = t;
    }, { passive: false });

    window.addEventListener("touchend", () => {
      isDragging = false;
    });

    // Keyboard navigation
    window.addEventListener("keydown", (e) => {
      const heroEl = document.getElementById("hero-screen");
      if (!heroEl || heroEl.style.display === "none") return;

      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        stepTrack(1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        stepTrack(-1);
      } else if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "Enter") {
        e.preventDefault();
        launchHomepage();
      } else if (e.key === "Escape") {
        if (isFullscreen) toggleFullscreen();
      }
    });

    // Prev / Next / Play buttons
    if (btnPrev) btnPrev.addEventListener("click", () => stepTrack(-1));
    if (btnNext) btnNext.addEventListener("click", () => stepTrack(1));
    if (btnPlay) btnPlay.addEventListener("click", togglePlay);

    // Theme Switcher (Video <-> Minimal)
    if (btnTheme) {
      btnTheme.addEventListener("click", () => {
        theme = theme === "video" ? "minimal" : "video";
        applyTheme();
      });
    }

    // Sound toggle
    if (btnSound) {
      btnSound.addEventListener("click", () => {
        videoSoundOn = !videoSoundOn;
        updateSoundState();
      });
    }

    // Fullscreen toggle
    if (btnFs) {
      btnFs.addEventListener("click", toggleFullscreen);
    }

    // Volume slider
    if (volSlider) {
      volSlider.addEventListener("input", (e) => {
        videoVolume = parseFloat(e.target.value);
        if (videoA) videoA.volume = videoVolume;
        if (videoB) videoB.volume = videoVolume;
      });
    }

    // Launch Homepage Button
    if (btnLaunch) {
      btnLaunch.addEventListener("click", launchHomepage);
    }

    // Allow clicking on any row in the coverflow list
    TRACKS.forEach((t, i) => {
      const row = document.getElementById(`mh-row-${i}`);
      if (row) {
        row.addEventListener("click", () => {
          snapTarget = i * ROW_HEIGHT;
          velocity = 0;
          fireClick(0.6);
        });
      }
    });

    startLoops();
    updateTrackMetadata();
  }

  function stepTrack(dir) {
    const current = Math.round(offset / ROW_HEIGHT);
    snapTarget = (current + dir) * ROW_HEIGHT;
    velocity = 0;
    fireClick(0.5);
  }

  function togglePlay() {
    isPlaying = !isPlaying;
    const videoA = document.getElementById("mh-video-a");
    const videoB = document.getElementById("mh-video-b");
    const iconPlay = document.getElementById("mh-icon-play");
    const iconPause = document.getElementById("mh-icon-pause");
    const progressFill = document.getElementById("mh-progress-fill");

    if (isPlaying) {
      if (activeVideo === "a" && videoA) videoA.play().catch(() => {});
      if (activeVideo === "b" && videoB) videoB.play().catch(() => {});
      if (iconPlay) iconPlay.style.display = "none";
      if (iconPause) iconPause.style.display = "inline";
      if (progressFill) progressFill.classList.remove("paused");
    } else {
      if (videoA) videoA.pause();
      if (videoB) videoB.pause();
      if (iconPlay) iconPlay.style.display = "inline";
      if (iconPause) iconPause.style.display = "none";
      if (progressFill) progressFill.classList.add("paused");
    }
  }

  function applyTheme() {
    const bgGlow = document.getElementById("mh-bg-glow");
    const bgImg = document.getElementById("mh-bg-img");
    const videoWrap = document.getElementById("mh-video-wrap");
    const minimalEl = document.getElementById("mh-minimal-backdrop");
    const btnSound = document.getElementById("mh-btn-sound");

    if (theme === "minimal") {
      if (bgGlow) bgGlow.style.display = "none";
      if (bgImg) bgImg.style.display = "none";
      if (videoWrap) videoWrap.style.display = "none";
      if (minimalEl) minimalEl.style.display = "block";
      if (btnSound) btnSound.style.display = "none";
    } else {
      if (bgGlow) bgGlow.style.display = "block";
      if (bgImg) bgImg.style.display = "block";
      if (videoWrap) videoWrap.style.display = "block";
      if (minimalEl) minimalEl.style.display = "none";
      if (btnSound) btnSound.style.display = "flex";
    }
  }

  function updateSoundState() {
    const videoA = document.getElementById("mh-video-a");
    const videoB = document.getElementById("mh-video-b");
    const soundOnIcon = document.getElementById("mh-icon-sound-on");
    const soundOffIcon = document.getElementById("mh-icon-sound-off");
    const btnSound = document.getElementById("mh-btn-sound");

    [videoA, videoB].forEach(v => {
      if (v) v.muted = !videoSoundOn;
    });

    if (videoSoundOn) {
      if (soundOnIcon) soundOnIcon.style.display = "inline";
      if (soundOffIcon) soundOffIcon.style.display = "none";
      if (btnSound) {
        btnSound.style.borderColor = CYAN;
        btnSound.style.boxShadow = `0 0 14px ${CYAN}55`;
        btnSound.style.color = CYAN;
      }
    } else {
      if (soundOnIcon) soundOnIcon.style.display = "none";
      if (soundOffIcon) soundOffIcon.style.display = "inline";
      if (btnSound) {
        btnSound.style.borderColor = "";
        btnSound.style.boxShadow = "";
        btnSound.style.color = "";
      }
    }
  }

  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
    const card = document.getElementById("mh-card");
    const videoWrap = document.getElementById("mh-video-wrap");
    const fsEnter = document.getElementById("mh-icon-fs-enter");
    const fsExit = document.getElementById("mh-icon-fs-exit");
    const btnFs = document.getElementById("mh-btn-fullscreen");

    if (isFullscreen) {
      if (card) card.classList.add("fullscreen");
      if (videoWrap) videoWrap.style.transform = "scale(1.45)";
      if (fsEnter) fsEnter.style.display = "none";
      if (fsExit) fsExit.style.display = "inline";
      if (btnFs) {
        btnFs.style.borderColor = AMBER;
        btnFs.style.boxShadow = `0 0 14px ${AMBER}55`;
        btnFs.style.color = AMBER;
      }
    } else {
      if (card) card.classList.remove("fullscreen");
      if (videoWrap) videoWrap.style.transform = "none";
      if (fsEnter) fsEnter.style.display = "inline";
      if (fsExit) fsExit.style.display = "none";
      if (btnFs) {
        btnFs.style.borderColor = "";
        btnFs.style.boxShadow = "";
        btnFs.style.color = "";
      }
    }
  }

  function startLoops() {
    const n = TRACKS.length;

    // Physics Loop
    function physicsTick() {
      if (snapTarget !== null) {
        offset += (snapTarget - offset) * 0.22;
        if (Math.abs(snapTarget - offset) < 0.4) {
          offset = snapTarget;
          snapTarget = null;
        }
      } else if (!isDragging) {
        offset += velocity;
        velocity *= 0.93;
        if (Math.abs(velocity) < 0.02) velocity = 0;
      }

      const detent = Math.round(offset / ROW_HEIGHT);
      if (detent !== lastDetent) {
        lastDetent = detent;
        fireClick(clamp(Math.abs(velocity) / ROW_HEIGHT, 0.15, 1));
      }
      animFramePhysics = requestAnimationFrame(physicsTick);
    }

    // Coverflow 3D Transform Render Loop
    function renderTick() {
      const centerIndexFloat = offset / ROW_HEIGHT;

      TRACKS.forEach((t, i) => {
        const el = document.getElementById(`mh-row-${i}`);
        if (!el) return;
        let d = i - centerIndexFloat;
        d = mod(d + n / 2, n) - n / 2;
        const absD = Math.abs(d);
        const rotate = clamp(d * 9, -22, 22);
        const scale = clamp(1 - absD * 0.1, 0.72, 1);
        const opacity = clamp(1 - absD * 0.4, 0, 1);
        const z = -absD * 18;
        const y = d * ROW_HEIGHT;

        el.style.transform = `translateY(${y}px) translateZ(${z}px) rotateX(${rotate}deg) scale(${scale})`;
        el.style.opacity = String(opacity);
        el.style.pointerEvents = absD < 0.5 ? "auto" : "none";
        el.style.zIndex = String(1000 - Math.round(absD * 10));

        if (absD < 0.5) {
          el.classList.add("active");
        } else {
          el.classList.remove("active");
        }
      });

      const nearest = mod(Math.round(centerIndexFloat), n);
      if (nearest !== activeIndex) {
        activeIndex = nearest;
        updateTrackMetadata();
      }

      animFrameRender = requestAnimationFrame(renderTick);
    }

    // Video Seamless Crossfade Loop
    function videoLoopTick() {
      const videoA = document.getElementById("mh-video-a");
      const videoB = document.getElementById("mh-video-b");
      if (videoA && videoB && videoA.duration) {
        const active = activeVideo === "a" ? videoA : videoB;
        const inactive = activeVideo === "a" ? videoB : videoA;

        const remaining = active.duration - active.currentTime;
        if (!isCrossfading && remaining <= CROSSFADE_S) {
          isCrossfading = true;
          inactive.currentTime = 0;
          inactive.play().catch(() => {});
        }

        if (isCrossfading) {
          const t = Math.min(1, Math.max(0, 1 - remaining / CROSSFADE_S));
          if (activeVideo === "a") {
            videoA.style.opacity = String(1 - t);
            videoB.style.opacity = String(t);
          } else {
            videoB.style.opacity = String(1 - t);
            videoA.style.opacity = String(t);
          }

          if (remaining <= 0.03) {
            active.pause();
            isCrossfading = false;
            activeVideo = activeVideo === "a" ? "b" : "a";
          }
        }
      }
      animFrameLoop = requestAnimationFrame(videoLoopTick);
    }

    animFramePhysics = requestAnimationFrame(physicsTick);
    animFrameRender = requestAnimationFrame(renderTick);
    animFrameLoop = requestAnimationFrame(videoLoopTick);
  }

  function updateTrackMetadata() {
    const track = TRACKS[activeIndex];
    if (!track) return;
    const artEl = document.getElementById("mh-active-art");
    const titleEl = document.getElementById("mh-active-title");
    const artistEl = document.getElementById("mh-active-artist");
    const fillEl = document.getElementById("mh-progress-fill");

    if (artEl) {
      artEl.style.background = `linear-gradient(135deg, ${track.colorA}, ${track.colorB})`;
      artEl.style.boxShadow = `0 0 16px ${track.colorA}55`;
    }
    if (titleEl) titleEl.textContent = track.title;
    if (artistEl) artistEl.textContent = track.artist;
    if (fillEl) fillEl.style.background = track.colorA;
  }

  // Cinematic launch transition into the dashboard homepage
  function launchHomepage() {
    const heroEl = document.getElementById("hero-screen");
    const card = document.getElementById("mh-card");
    const rootEl = document.getElementById("fx-root");

    // Play high-tech entry chime
    fireClick(1.0);
    setTimeout(() => fireClick(0.8), 60);

    if (card) {
      card.style.transition = "transform 0.75s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.75s ease, filter 0.75s ease";
      card.style.transform = "scale(2.4) translateZ(300px)";
      card.style.opacity = "0";
      card.style.filter = "blur(18px)";
    }

    if (heroEl) {
      heroEl.style.transition = "opacity 0.65s ease, background 0.65s ease";
      heroEl.style.opacity = "0";
      heroEl.style.pointerEvents = "none";
    }

    setTimeout(() => {
      if (heroEl) {
        heroEl.style.display = "none";
        heroEl.style.opacity = "";
        heroEl.style.pointerEvents = "";
      }
      if (card) {
        card.style.transition = "";
        card.style.transform = "";
        card.style.opacity = "";
        card.style.filter = "";
      }
      if (rootEl) {
        rootEl.style.opacity = "1";
      }

      // Show welcome toast notification
      if (window.showToast) {
        window.showToast("Welcome to e-PDS Smart Ration Dispenser Terminal", "SUCCESS");
      }
    }, 700);
  }

  // Public launcher function called from login.js or showcase button
  window.launchMetroHero = function () {
    const heroEl = document.getElementById("hero-screen");
    if (!heroEl) return;

    if (!heroEl.hasChildNodes()) {
      setupHeroDOM();
    }

    heroEl.style.display = "flex";
    heroEl.style.opacity = "0";
    void heroEl.offsetWidth;
    heroEl.style.transition = "opacity 0.5s ease";
    heroEl.style.opacity = "1";

    // Play initial startup chime
    fireClick(0.7);

    // Auto unlock audio context on click
    const unlock = () => {
      const ctx = getAudioContext();
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
      window.removeEventListener("pointerdown", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
  };

  // Wire up Top Bar Showcase Button
  document.addEventListener("DOMContentLoaded", () => {
    const showcaseBtn = document.getElementById("btn-hero-showcase");
    if (showcaseBtn) {
      showcaseBtn.addEventListener("click", () => {
        window.launchMetroHero();
      });
    }
  });

})();
