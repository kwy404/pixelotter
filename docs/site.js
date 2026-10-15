// Interactive parts of the pixelotter landing page, built with Voodoo.js
// (https://kwy404.github.io/Voodoo.js/). Voodoo loads with data-manual: this module puts the
// helpers the markup uses on V.config.globals and then calls V.start().
//   at(event, el)  the before and after slider position under the pointer, in percent
//   sweep(state)   one slow sweep of the slider when the page opens (skipped for reduced motion)
// Scrolling moves the prints at different depths (parallax) and develops the contact sheet
// frames as they come into view. Everything stops for people who prefer reduced motion.

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function at(event, el) {
  const r = el.getBoundingClientRect();
  return Math.max(0, Math.min(100, ((event.clientX - r.left) / r.width) * 100));
}

function sweep(state) {
  if (reduced) return;
  const start = performance.now() + 900;
  const dur = 3600;
  const frame = (now) => {
    if (state.dragging) return;
    const t = Math.min(1, Math.max(0, (now - start) / dur));
    // 40 -> 70 -> 40 -> 10 -> 40, a slow sine
    state.pos = 40 + Math.sin(t * Math.PI * 2) * 30;
    if (t < 1) requestAnimationFrame(frame);
    else state.pos = 40;
  };
  requestAnimationFrame(frame);
}

// Parallax: one custom property per frame, read by CSS transforms.
const tray = document.querySelector('[data-tray]');
if (tray && !reduced) {
  let queued = false;
  const update = () => {
    queued = false;
    tray.style.setProperty('--scroll', String(Math.min(window.scrollY, window.innerHeight * 1.5)));
  };
  window.addEventListener('scroll', () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
}

// Contact sheet frames develop as they scroll into view.
const frames = [...document.querySelectorAll('.frame')];
if ('IntersectionObserver' in window && !reduced) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const i = frames.indexOf(en.target);
        setTimeout(() => en.target.classList.add('seen'), (i % 3) * 140);
        io.unobserve(en.target);
      }
    },
    { rootMargin: '0px 0px -10% 0px' },
  );
  frames.forEach((f) => io.observe(f));
} else frames.forEach((f) => f.classList.add('seen'));

const start = () => {
  const V = window.V;
  Object.assign(V.config.globals, { at, sweep });
  V.start();
};
if (window.V) start();
else window.addEventListener('load', start, { once: true });
