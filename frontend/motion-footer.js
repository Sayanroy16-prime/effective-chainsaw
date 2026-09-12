/* =====================================================================
   CINEMATIC CURTAIN REVEAL MOTION FOOTER ENGINE
   GSAP ScrollTrigger Parallax + Magnetic Button Physics
   ===================================================================== */

(function () {
  window.addEventListener('DOMContentLoaded', () => {
    initMotionFooter();
  });

  function initMotionFooter() {
    const curtainWrapper = document.getElementById('motion-footer-curtain');
    const giantText      = document.getElementById('footer-giant-text');
    const heading        = document.getElementById('footer-heading');
    const linksGroup     = document.getElementById('footer-links-group');
    const scrollTopBtn   = document.getElementById('footer-scroll-top');

    // Smooth scroll to top
    if (scrollTopBtn) {
      scrollTopBtn.addEventListener('click', (e) => {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    // Magnetic Button Hover Physics
    const magneticButtons = document.querySelectorAll('.magnetic-btn');
    magneticButtons.forEach((btn) => {
      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const halfW = rect.width / 2;
        const halfH = rect.height / 2;
        const deltaX = e.clientX - rect.left - halfW;
        const deltaY = e.clientY - rect.top - halfH;

        if (window.gsap) {
          gsap.to(btn, {
            x: deltaX * 0.35,
            y: deltaY * 0.35,
            rotationX: -deltaY * 0.12,
            rotationY: deltaX * 0.12,
            scale: 1.05,
            ease: 'power2.out',
            duration: 0.35,
          });
        } else {
          btn.style.transform = `translate(${deltaX * 0.3}px, ${deltaY * 0.3}px) scale(1.05)`;
        }
      });

      btn.addEventListener('mouseleave', () => {
        if (window.gsap) {
          gsap.to(btn, {
            x: 0,
            y: 0,
            rotationX: 0,
            rotationY: 0,
            scale: 1,
            ease: 'elastic.out(1, 0.3)',
            duration: 1.1,
          });
        } else {
          btn.style.transform = 'translate(0px, 0px) scale(1)';
        }
      });
    });

    // GSAP ScrollTrigger Animations
    if (window.gsap && window.ScrollTrigger && curtainWrapper) {
      gsap.registerPlugin(ScrollTrigger);

      // Parallax on giant background text
      if (giantText) {
        gsap.fromTo(
          giantText,
          { y: '12vh', scale: 0.85, opacity: 0 },
          {
            y: '0vh',
            scale: 1,
            opacity: 1,
            ease: 'power1.out',
            scrollTrigger: {
              trigger: curtainWrapper,
              start: 'top 85%',
              end: 'bottom bottom',
              scrub: 1,
            },
          }
        );
      }

      // Staggered Content Reveal
      if (heading && linksGroup) {
        gsap.fromTo(
          [heading, linksGroup],
          { y: 45, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            stagger: 0.15,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: curtainWrapper,
              start: 'top 50%',
              end: 'bottom bottom',
              scrub: 1,
            },
          }
        );
      }
    }
  }
})();
