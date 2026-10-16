// One accessible context menu for the whole editor: role menu and menuitem (with checkbox and
// radio states), arrow keys, Home and End, typing a letter, Enter and Space, Escape and Left
// to close a level, submenus, and placement that stays inside the viewport.
// Items: { label, key, run, disabled, checked, danger, items: [...] } or '-' for a separator.

let uid = 0;
const LONG_PRESS_MS = 550;
const LONG_PRESS_SLOP = 10;

export class ContextMenu {
  constructor() {
    this.levels = []; // open menus, the root first
    this.returnFocus = null;
    this.openedAt = 0;
    this.onKey = (e) => this.key(e);
    this.onOutside = (e) => {
      if (!this.levels.some((l) => l.el.contains(e.target))) this.close();
    };
    this.onAway = (e) => {
      // a scroll inside the menu, or the one that brought the target into view, keeps it open
      if (e?.type === 'scroll' && (performance.now() - this.openedAt < 400 || this.levels.some((l) => l.el.contains(e.target)))) return;
      this.close();
    };
  }

  get isOpen() {
    return this.levels.length > 0;
  }

  /** Opens the menu at a viewport point. items as described above. */
  open({ x, y, items, label = '', returnFocus = document.activeElement }) {
    this.close(false);
    if (!items?.length) return;
    this.returnFocus = returnFocus;
    this.openedAt = performance.now();
    this.level(items, { x, y, label });
    document.addEventListener('keydown', this.onKey, true);
    document.addEventListener('pointerdown', this.onOutside, true);
    window.addEventListener('blur', this.onAway);
    window.addEventListener('resize', this.onAway);
    document.addEventListener('scroll', this.onAway, true);
  }

  level(items, { x, y, label = '', parentRow = null }) {
    const el = document.createElement('div');
    el.className = 'ctx-menu';
    el.setAttribute('role', 'menu');
    el.id = `ctx-menu-${++uid}`;
    if (label) el.setAttribute('aria-label', label);
    if (parentRow) el.setAttribute('aria-labelledby', parentRow.id);
    el.tabIndex = -1;
    const rows = [];
    for (const it of items) {
      if (it === '-' || it?.type === 'sep') {
        if (rows.length && el.lastChild?.getAttribute('role') !== 'separator') {
          const sep = document.createElement('div');
          sep.className = 'ctx-sep';
          sep.setAttribute('role', 'separator');
          el.append(sep);
        }
        continue;
      }
      const row = document.createElement('div');
      row.id = `ctx-item-${++uid}`;
      row.className = 'ctx-item';
      row.tabIndex = -1;
      const role = it.radio ? 'menuitemradio' : it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem';
      row.setAttribute('role', role);
      if (role !== 'menuitem') row.setAttribute('aria-checked', it.checked ? 'true' : 'false');
      if (it.disabled) row.setAttribute('aria-disabled', 'true');
      if (it.danger) row.classList.add('danger');
      if (it.items) {
        row.setAttribute('aria-haspopup', 'menu');
        row.setAttribute('aria-expanded', 'false');
      }
      const mark = document.createElement('span');
      mark.className = 'ctx-mark';
      mark.textContent = it.checked ? '✓' : '';
      mark.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.className = 'ctx-label';
      text.textContent = it.label;
      const end = document.createElement('span');
      end.className = 'ctx-key';
      end.setAttribute('aria-hidden', 'true');
      end.textContent = it.items ? '›' : it.key ?? '';
      row.append(mark, text, end);
      row.addEventListener('pointerenter', () => {
        this.focusRow(lvl, rows.indexOf(row));
        clearTimeout(this.hoverTimer);
        this.hoverTimer = setTimeout(() => {
          if (it.items && !it.disabled) this.openSub(lvl, row, it);
          else this.trim(lvl);
        }, 160);
      });
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activate(lvl, row, it);
      });
      row.item = it;
      rows.push(row);
      el.append(row);
    }
    // no trailing separator
    if (el.lastChild?.getAttribute('role') === 'separator') el.lastChild.remove();
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.append(el);
    const lvl = { el, rows, index: -1, parentRow };
    this.levels.push(lvl);
    this.place(el, x, y, parentRow);
    this.focusRow(lvl, this.firstEnabled(rows, 0, 1));
    return lvl;
  }

  /** Keeps the menu inside the viewport: flips left or up when there is no room. */
  place(el, x, y, parentRow) {
    const pad = 6;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let left = x;
    let top = y;
    if (parentRow) {
      const r = parentRow.getBoundingClientRect();
      left = r.right - 2;
      top = r.top - 5;
      if (left + w > vw - pad) left = r.left - w + 2;
    } else if (left + w > vw - pad) left = x - w;
    if (top + h > vh - pad) top = parentRow ? vh - pad - h : y - h;
    left = Math.max(pad, Math.min(left, vw - pad - w));
    top = Math.max(pad, Math.min(top, vh - pad - h));
    if (h > vh - pad * 2) {
      el.style.maxHeight = `${vh - pad * 2}px`;
      top = pad;
    }
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  firstEnabled(rows, from, dir) {
    const n = rows.length;
    for (let k = 0; k < n; k++) {
      const i = (((from + k * dir) % n) + n) % n;
      if (rows[i].getAttribute('aria-disabled') !== 'true') return i;
    }
    return -1;
  }

  focusRow(lvl, i) {
    if (i < 0 || !lvl.rows[i]) return;
    lvl.index = i;
    lvl.rows.forEach((r, k) => r.classList.toggle('is-focus', k === i));
    lvl.rows[i].focus({ preventScroll: true });
  }

  openSub(lvl, row, it) {
    this.trim(lvl);
    row.setAttribute('aria-expanded', 'true');
    const sub = this.level(it.items, { x: 0, y: 0, parentRow: row });
    row.setAttribute('aria-controls', sub.el.id);
    return sub;
  }

  /** Closes every submenu above this level. */
  trim(lvl) {
    while (this.levels.length && this.levels.at(-1) !== lvl) {
      const top = this.levels.pop();
      top.parentRow?.setAttribute('aria-expanded', 'false');
      top.el.remove();
    }
  }

  activate(lvl, row, it) {
    if (it.disabled) return;
    if (it.items) {
      const sub = this.openSub(lvl, row, it);
      this.focusRow(sub, this.firstEnabled(sub.rows, 0, 1));
      return;
    }
    this.close();
    try {
      const out = it.run?.();
      if (out?.catch) out.catch((err) => console.warn('menu action failed', err));
    } catch (err) {
      console.warn('menu action failed', err);
    }
  }

  key(e) {
    const lvl = this.levels.at(-1);
    if (!lvl) return;
    const row = lvl.rows[lvl.index];
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case 'ArrowDown':
        stop();
        return this.focusRow(lvl, this.firstEnabled(lvl.rows, lvl.index + 1, 1));
      case 'ArrowUp':
        stop();
        return this.focusRow(lvl, this.firstEnabled(lvl.rows, lvl.index < 0 ? lvl.rows.length - 1 : lvl.index - 1, -1));
      case 'Home':
        stop();
        return this.focusRow(lvl, this.firstEnabled(lvl.rows, 0, 1));
      case 'End':
        stop();
        return this.focusRow(lvl, this.firstEnabled(lvl.rows, lvl.rows.length - 1, -1));
      case 'ArrowRight':
        stop();
        if (row?.item.items && !row.item.disabled) {
          const sub = this.openSub(lvl, row, row.item);
          this.focusRow(sub, this.firstEnabled(sub.rows, 0, 1));
        }
        return undefined;
      case 'ArrowLeft':
      case 'Escape':
        stop();
        if (this.levels.length > 1) {
          const parent = this.levels.at(-2);
          this.trim(parent);
          return this.focusRow(parent, parent.index);
        }
        return this.close();
      case 'Enter':
      case ' ':
        stop();
        if (row) this.activate(lvl, row, row.item);
        return undefined;
      case 'Tab':
        stop();
        return this.close();
      default:
        if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
          // jump to the next item that starts with the letter
          stop();
          const ch = e.key.toLowerCase();
          const n = lvl.rows.length;
          for (let k = 1; k <= n; k++) {
            const i = (lvl.index + k) % n;
            const r = lvl.rows[i];
            if (r.getAttribute('aria-disabled') !== 'true' && r.textContent.trim().toLowerCase().startsWith(ch)) return this.focusRow(lvl, i);
          }
        }
        return undefined;
    }
  }

  close(restore = true) {
    clearTimeout(this.hoverTimer);
    if (!this.levels.length) return;
    for (const l of this.levels) l.el.remove();
    this.levels = [];
    document.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('pointerdown', this.onOutside, true);
    window.removeEventListener('blur', this.onAway);
    window.removeEventListener('resize', this.onAway);
    document.removeEventListener('scroll', this.onAway, true);
    if (restore && this.returnFocus?.isConnected) this.returnFocus.focus?.({ preventScroll: true });
  }
}

/**
 * Wires the three ways to ask for a context menu inside root: right click, a long press on a
 * touch screen, and the Menu key or Shift+F10 on the focused element. resolve(target, point)
 * returns { items, label } or null to leave the browser's own menu alone.
 */
export function bindContextMenu(root, menu, resolve, { onLongPress = null, defaultTarget = null } = {}) {
  const show = (target, x, y, e) => {
    const res = resolve(target, { x, y });
    if (!res) return false;
    e?.preventDefault();
    menu.open({ x, y, ...res });
    return true;
  };
  root.addEventListener('contextmenu', (e) => {
    // a long press already opened the menu (some touch browsers send contextmenu as well)
    if (menu.isOpen && performance.now() - menu.openedAt < 700) {
      e.preventDefault();
      return;
    }
    let { clientX: x, clientY: y } = e;
    if (e.button !== 2 && x === 0 && y === 0) {
      // from the keyboard: open next to the focused element
      const r = e.target.getBoundingClientRect?.();
      if (r) [x, y] = [r.left + Math.min(24, r.width / 2), r.top + Math.min(r.height, 28)];
    }
    show(e.target, x, y, e);
  });
  root.addEventListener('keydown', (e) => {
    if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
    const focused = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const target = focused ?? defaultTarget?.() ?? e.target;
    const r = target.getBoundingClientRect?.() ?? { left: 40, top: 40, width: 0, height: 0 };
    if (show(target, r.left + Math.min(24, r.width / 2), r.top + Math.min(r.height, 28), e)) e.stopPropagation();
  });
  // long press on touch
  let press = null;
  const clear = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    clear();
    const target = e.target;
    const start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    press = {
      ...start,
      timer: setTimeout(() => {
        press = null;
        if (!resolve(target, start)) return;
        onLongPress?.(target);
        show(target, start.x, start.y, null);
      }, LONG_PRESS_MS),
    };
  }, true);
  root.addEventListener('pointermove', (e) => {
    if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > LONG_PRESS_SLOP) clear();
  }, true);
  for (const type of ['pointerup', 'pointercancel']) root.addEventListener(type, (e) => press && e.pointerId === press.id && clear(), true);
}
