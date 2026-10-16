// Tooltips for the whole interface: a name, a line on what it does, a tip and the keyboard
// shortcut, in the interface language. They show after a short pause on hover, or at once on
// keyboard focus, sit beside the control (never on the canvas under the pointer) and hide on
// any click, key or scroll. Tools, menu commands and plain controls describe themselves:
//   data-tool="brush"       name, shortcut, description and tip from the help text
//   data-cmd="file.save"    the description of the command (the row shows name and shortcut)
//   title / aria-label      the name; data-tip adds a line, data-tip-key a shortcut

const HOVER_MS = 450;
const FOCUS_MS = 150;
const GAP = 8;
const SELECTOR = '[data-tool], [data-cmd], [data-tip], [title], button[aria-label], [role="tab"][aria-label], input[aria-label], select[aria-label]';

export function installTooltips(ctx) {
  const { S, t } = ctx;
  const has = (k) => {
    const v = t(k);
    return v && v !== k ? v : '';
  };
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.id = 'po-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);
  let current = null;
  let timer = 0;
  let pointer = { x: -1, y: -1 };
  let keyboard = false; // the last input came from the keyboard: focus shows tooltips

  /** What the tooltip says about an element, or null when there is nothing to add. */
  const describe = (el) => {
    // a title attribute would show the browser's own tooltip too: keep it for ourselves
    if (el.hasAttribute('title')) {
      const v = el.getAttribute('title');
      if (v) el.dataset.tipTitle = v;
      el.removeAttribute('title');
    }
    const tool = el.dataset.tool;
    if (tool) {
      const group = S.toolGroups.find((g) => g.tools.includes(tool));
      const many = el.classList.contains('tool-btn') && group?.tools.length > 1;
      return { title: t(`tool.${tool}`), key: group?.key?.toUpperCase() ?? '', text: has(`tip.tool.${tool}`), more: [has(`tipx.tool.${tool}`), many ? t('tip.tools.more') : ''].filter(Boolean).join(' ') };
    }
    const cmd = el.dataset.cmd;
    if (cmd) {
      const text = has(`tip.cmd.${cmd}`);
      if (!text) return null;
      return { title: el.querySelector('.menu-label')?.textContent ?? '', key: el.querySelector('.menu-key')?.textContent ?? '', text, more: '' };
    }
    const title = el.dataset.tipTitle || el.getAttribute('aria-label') || '';
    const text = el.dataset.tip || '';
    const key = el.dataset.tipKey || '';
    if (!title && !text) return null;
    // a button that already reads its own name needs no tooltip
    if (!text && !key && el.textContent.trim() && el.textContent.trim().includes(title.trim())) return null;
    return { title, key, text: text === title ? '' : text, more: '' };
  };

  const render = (d) => {
    tip.replaceChildren();
    const head = document.createElement('div');
    head.className = 'tip-head';
    const b = document.createElement('b');
    b.textContent = d.title;
    head.append(b);
    if (d.key) {
      const k = document.createElement('kbd');
      k.textContent = d.key;
      k.title = '';
      k.setAttribute('aria-label', `${t('tip.shortcut')} ${d.key}`);
      head.append(k);
    }
    tip.append(head);
    for (const [text, cls] of [
      [d.text, 'tip-text'],
      [d.more, 'tip-more'],
    ]) {
      if (!text) continue;
      const p = document.createElement('p');
      p.className = cls;
      p.textContent = text;
      tip.append(p);
    }
  };

  /** Beside the control: right of the toolbox, below the top bars, above the status bar. */
  const place = (el) => {
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const vw = innerWidth;
    const vh = innerHeight;
    let side = 'below';
    if (el.closest('.toolbox, .quick-tabs')) side = 'right';
    else if (r.bottom + GAP + h > vh - 4 || el.closest('.status, .layer-foot')) side = 'above';
    else if (el.closest('.panel-dock') && r.top > 120) side = 'left';
    const at = {
      right: { x: r.right + GAP, y: r.top + r.height / 2 - h / 2 },
      left: { x: r.left - GAP - w, y: r.top + r.height / 2 - h / 2 },
      below: { x: r.left + r.width / 2 - w / 2, y: r.bottom + GAP },
      above: { x: r.left + r.width / 2 - w / 2, y: r.top - GAP - h },
    };
    let p = at[side];
    const fits = (q) => q.x >= 4 && q.y >= 4 && q.x + w <= vw - 4 && q.y + h <= vh - 4;
    if (!fits(p)) p = [at.below, at.above, at.right, at.left].find(fits) ?? p;
    let x = Math.max(4, Math.min(vw - w - 4, p.x));
    let y = Math.max(4, Math.min(vh - h - 4, p.y));
    // never under the pointer
    if (pointer.x >= x && pointer.x <= x + w && pointer.y >= y && pointer.y <= y + h) y = r.bottom + GAP + h <= vh ? r.bottom + GAP : Math.max(4, r.top - GAP - h);
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };

  const show = (el) => {
    if (!el.isConnected || el.closest('[hidden]')) return;
    const d = describe(el);
    if (!d) return;
    render(d);
    tip.hidden = false;
    tip.classList.remove('in');
    place(el);
    void tip.offsetWidth;
    tip.classList.add('in');
    el.setAttribute('aria-describedby', 'po-tip');
    current = el;
  };
  const hide = () => {
    clearTimeout(timer);
    if (current) current.removeAttribute('aria-describedby');
    current = null;
    tip.hidden = true;
  };
  const target = (node) => {
    const el = node?.closest?.(SELECTOR);
    if (!el || el.closest('.vp-stage, .tour, .ctx-menu, #po-tip, .toasts')) return null;
    return el;
  };
  const later = (el, ms) => {
    clearTimeout(timer);
    // the browser tooltip would otherwise appear as well
    describe(el);
    timer = setTimeout(() => show(el), ms);
  };

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    pointer = { x: e.clientX, y: e.clientY };
    const el = target(e.target);
    if (el === current) return;
    hide();
    if (el) later(el, HOVER_MS);
  });
  document.addEventListener('pointermove', (e) => {
    pointer = { x: e.clientX, y: e.clientY };
  }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    const el = target(e.target);
    if (el && (!e.relatedTarget || !el.contains(e.relatedTarget))) hide();
  });
  document.addEventListener('focusin', (e) => {
    const el = target(e.target);
    if (!el || !keyboard) return;
    hide();
    later(el, FOCUS_MS);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', () => (keyboard = true), true);
  document.addEventListener('pointerdown', () => (keyboard = false), true);
  for (const ev of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(ev, (e) => {
    // Tab moves the focus and brings the next tooltip; other keys hide this one
    if (ev === 'keydown' && e.key === 'Tab') return;
    hide();
  }, { capture: true, passive: true });
  window.addEventListener('scroll', hide, { capture: true, passive: true });
  window.addEventListener('blur', hide);
  ctx.tooltip = { hide, show };
}
