/* =====================================================================
   FULLSCREEN SCROLL FX ENGINE FOR SMART RATION DISPENSER
   Pinned Board Slideshow with GSAP ScrollTrigger
   ===================================================================== */

(function () {
  function startEngine() {
    if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
      setTimeout(startEngine, 100);
      return;
    }
    initScrollFX();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startEngine);
  } else {
    startEngine();
  }

  function initScrollFX() {
    gsap.registerPlugin(ScrollTrigger);

    const TOTAL = 5;
    let currentIndex = 0;
    let isSnapping = false;
    let sectionTops = [];

    const fixedSection = document.getElementById('fx-fixed-section');
    const fixedEl = document.getElementById('fx-fixed');
    const leftTrack = document.getElementById('left-track');
    const rightTrack = document.getElementById('right-track');
    const leftItems = Array.from(document.querySelectorAll('.fx-left-item'));
    const rightItems = Array.from(document.querySelectorAll('.fx-right-item'));
    const navTabs = Array.from(document.querySelectorAll('.nav-tab'));
    const bgs = Array.from(document.querySelectorAll('.fx-bg'));
    const featureds = Array.from(document.querySelectorAll('.fx-featured'));
    const progressFill = document.getElementById('progress-fill');
    const currentNumber = document.getElementById('current-number');
    const bottomSubtitle = document.getElementById('fx-bottom-subtitle');

    if (!fixedSection || !fixedEl || featureds.length === 0) return;

    const SUBTITLES = [
      "BOARD 01: MACHINE HARDWARE ARCHITECTURE · LOAD CELL & SERVO GATES",
      "BOARD 02: AADHAAR SMART PDS BENEFICIARY DATABASE & MONTHLY QUOTAS",
      "BOARD 03: 4 COMMODITY GRAIN SILOS · GRAVITY PIPES & IR LEVEL TELEMETRY",
      "BOARD 04: REAL-TIME CRYPTOGRAPHIC AUDIT LEDGER · ZERO FRAUD LOSS",
      "BOARD 05: VIRTUAL HARDWARE TESTBENCH · RFID, BIOMETRICS & SENSORS"
    ];

    // Word splitting for center titles (Matches React splitWords)
    const wordBuckets = [];
    featureds.forEach((feat, sIdx) => {
      const titleEl = feat.querySelector('.fx-featured-title');
      if (!titleEl) return;
      const rawText = titleEl.getAttribute('data-title') || titleEl.textContent || '';
      const words = rawText.split(/\s+/).filter(Boolean);
      titleEl.innerHTML = '';
      const wordsArr = [];

      words.forEach((w, i) => {
        const mask = document.createElement('span');
        mask.className = 'fx-word-mask';
        const span = document.createElement('span');
        span.className = 'fx-word';
        span.textContent = w;
        mask.appendChild(span);
        titleEl.appendChild(mask);
        if (i < words.length - 1) {
          titleEl.appendChild(document.createTextNode(' '));
        }
        wordsArr.push(span);
      });

      wordBuckets[sIdx] = wordsArr;
    });

    // Calculate snap positions
    function computePositions() {
      const top = fixedSection.offsetTop || 0;
      const h = fixedSection.offsetHeight || window.innerHeight * 5;
      sectionTops = [];
      for (let i = 0; i < TOTAL; i++) {
        sectionTops.push(top + (h * i) / TOTAL);
      }
    }

    // Align left & right list tracks
    function measureAndCenterLists(toIndex, animate) {
      function centerTrack(container, items) {
        if (!container || items.length === 0) return;
        const first = items[0];
        const second = items[1];
        const contRect = container.getBoundingClientRect();
        let rowH = first.getBoundingClientRect().height || 36;
        if (second) {
          rowH = second.getBoundingClientRect().top - first.getBoundingClientRect().top;
        }
        const targetY = contRect.height / 2 - rowH / 2 - toIndex * rowH;
        if (animate) {
          gsap.to(container, {
            y: targetY,
            duration: 0.55,
            ease: 'power3.out'
          });
        } else {
          gsap.set(container, { y: targetY });
        }
      }

      requestAnimationFrame(() => {
        centerTrack(leftTrack, leftItems);
        centerTrack(rightTrack, rightItems);
      });
    }

    // Initial setup: activate Board 0
    computePositions();
    changeSection(0, false);
    measureAndCenterLists(0, false);

    // Section change visuals (Instant board activation + smooth GSAP reveal)
    function changeSection(to, animate = true) {
      to = Math.max(0, Math.min(TOTAL - 1, to));
      const from = currentIndex;
      const down = to >= from;
      currentIndex = to;

      // 1. Update numbers & subtitle
      if (currentNumber) {
        currentNumber.textContent = String(to + 1).padStart(2, '0');
      }
      if (progressFill) {
        const p = (to / (TOTAL - 1 || 1)) * 100;
        progressFill.style.width = `${p}%`;
      }
      if (bottomSubtitle) {
        bottomSubtitle.textContent = SUBTITLES[to] || "SMART RATION DISPENSER";
      }

      // 2. Activate target featured board container & deactivate others
      featureds.forEach((feat, i) => {
        const isActive = (i === to);
        feat.classList.toggle('active', isActive);
        if (isActive) {
          feat.style.display = 'flex';
          feat.style.visibility = 'visible';
          feat.style.opacity = '1';
          feat.style.pointerEvents = 'auto';
        } else {
          feat.style.display = 'none';
          feat.style.visibility = 'hidden';
          feat.style.opacity = '0';
          feat.style.pointerEvents = 'none';
        }
      });

      // 3. Ensure tab-panes inside are displayed block
      document.querySelectorAll('.tab-pane').forEach((pane, i) => {
        pane.classList.toggle('active', i === to);
      });

      // 4. Update track lists & top nav tabs
      leftItems.forEach((el, i) => el.classList.toggle('active', i === to));
      rightItems.forEach((el, i) => el.classList.toggle('active', i === to));
      navTabs.forEach((tab, i) => tab.classList.toggle('active', i === to));

      // 5. Center list tracks
      measureAndCenterLists(to, animate);

      // 6. Dynamic Backgrounds transition
      bgs.forEach((bg, i) => {
        const isTarget = (i === to);
        bg.classList.toggle('active', isTarget);
        if (animate) {
          if (isTarget) {
            gsap.fromTo(bg,
              { opacity: 0, scale: 1.03 },
              { opacity: 1, scale: 1, duration: 0.6, ease: 'power2.out' }
            );
          } else if (i === from) {
            gsap.to(bg, { opacity: 0, duration: 0.6, ease: 'power2.out' });
          }
        } else {
          bg.style.opacity = isTarget ? '1' : '0';
        }
      });

      // 7. Title word mask slide-in animation
      const inWords = wordBuckets[to] || [];
      if (inWords.length) {
        if (animate) {
          gsap.fromTo(inWords,
            { yPercent: down ? 100 : -100, opacity: 0 },
            { yPercent: 0, opacity: 1, duration: 0.5, stagger: down ? 0.04 : -0.04, ease: 'power3.out' }
          );
        } else {
          gsap.set(inWords, { yPercent: 0, opacity: 1 });
        }
      }
    }

    function goTo(to, withScroll = true) {
      const clamped = Math.max(0, Math.min(TOTAL - 1, to));
      isSnapping = true;
      changeSection(clamped, true);

      const pos = sectionTops[clamped] || 0;
      if (withScroll) {
        window.scrollTo({ top: pos, behavior: 'smooth' });
        setTimeout(() => { isSnapping = false; }, 600);
      } else {
        setTimeout(() => { isSnapping = false; }, 20);
      }
    }

    // ScrollTrigger Pinned Stage
    const st = ScrollTrigger.create({
      trigger: fixedSection,
      start: 'top top',
      end: 'bottom bottom',
      pin: fixedEl,
      pinSpacing: true,
      onUpdate: (self) => {
        if (isSnapping) return;
        const prog = self.progress;
        const target = Math.min(TOTAL - 1, Math.floor(prog * TOTAL));
        if (target !== currentIndex) {
          changeSection(target, true);
        }
      }
    });

    // Click Listeners for Left & Right Menu Items
    leftItems.forEach((item, idx) => {
      item.addEventListener('click', () => goTo(idx, true));
    });
    rightItems.forEach((item, idx) => {
      item.addEventListener('click', () => goTo(idx, true));
    });

    // Click Listeners for Top Header Navigation Tabs
    navTabs.forEach((tab, idx) => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        goTo(idx, true);
      });
    });

    // Keyboard Navigation
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        if (currentIndex < TOTAL - 1) {
          e.preventDefault();
          goTo(currentIndex + 1, true);
        }
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        if (currentIndex > 0) {
          e.preventDefault();
          goTo(currentIndex - 1, true);
        }
      }
    });

    window.addEventListener('resize', () => {
      computePositions();
      measureAndCenterLists(currentIndex, false);
      ScrollTrigger.refresh();
    });

    // Expose global controller
    window.scrollFX = {
      goTo,
      next: () => goTo(currentIndex + 1, true),
      prev: () => goTo(currentIndex - 1, true),
      getIndex: () => currentIndex,
      refresh: () => {
        computePositions();
        ScrollTrigger.refresh();
      }
    };
  }
})();
