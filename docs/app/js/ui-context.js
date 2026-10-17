// Right click, long press and Menu key (or Shift+F10) menus for the canvas, the layers list,
// chat messages and people in the room, built on the one menu component in context-menu.js.

import { ContextMenu, bindContextMenu } from './context-menu.js';
import { BLEND_MODES } from '../lib/blend.js';
import { findLayer } from '../lib/doc.js';

const PAINT = new Set(['brush', 'pencil', 'eraser', 'clone', 'spot-heal', 'heal', 'dodge', 'burn', 'sponge', 'blur', 'sharpen', 'smudge']);
const SELECT = new Set(['marquee', 'marquee-ellipse', 'lasso', 'lasso-poly', 'wand', 'quick-select']);

export function installContext(ctx) {
  const { app, S, t, globals, ui } = ctx;
  const menu = new ContextMenu();
  ctx.contextMenu = menu;
  const cmd = (id, extra) => ctx.cmdItem(id, extra);
  const sub = (label, items) => ({ label, items });

  // ---------- canvas ----------
  const canvasItems = () => {
    if (!app.edoc) return null;
    const tool = app.toolId;
    const hasSel = S.selection.active;
    const items = [];
    if (tool === 'crop' && app.tools.get('crop')?.rect) {
      items.push({ label: t('ctx.cropApply'), key: 'Enter', run: () => globals.cropCommit() }, { label: t('ctx.cropCancel'), key: 'Esc', run: () => globals.cropCancel() }, '-');
    }
    items.push(cmd('edit.undo'), cmd('edit.redo'), '-', cmd('edit.cut'), cmd('edit.copy'), cmd('edit.copyMerged'), cmd('edit.paste'), cmd('edit.pasteInPlace'), cmd('edit.pasteInto'), '-');
    if (hasSel) {
      items.push(cmd('select.none', { label: t('ctx.deselect') }), cmd('select.inverse', { label: t('ctx.inverse') }), cmd('select.reselect'), sub(t('menu.select.modify'), [cmd('select.feather'), cmd('select.expand'), cmd('select.contract')]), cmd('select.refine'), '-', cmd('layer.viaCopy'), cmd('layer.viaCut'), cmd('edit.fill'), cmd('edit.stroke'), cmd('edit.contentAware'), cmd('select.toMask'), cmd('edit.clear'));
    } else {
      items.push(cmd('select.all', { label: t('ctx.selectAll') }), cmd('select.reselect'), cmd('select.subject', { label: t('ctx.selectSubject') }));
      if (SELECT.has(tool)) items.push(cmd('select.colorRange'));
      items.push('-', cmd('edit.fill'));
    }
    items.push('-', cmd('edit.freeTransform'), sub(t('menu.edit.transform'), [cmd('edit.rotate90'), cmd('edit.rotate-90'), cmd('edit.rotate180'), cmd('edit.flipH'), cmd('edit.flipV')]));
    if (PAINT.has(tool)) {
      const o = app.opts(tool);
      if (o.size) {
        items.push(sub(t('ctx.brushSize'), [5, 10, 20, 40, 80, 160, 320].map((n) => ({ label: `${n} px`, radio: true, checked: o.size === n, run: () => {
          o.size = n;
          app.vp.needsOverlay = true;
        } }))));
      }
    }
    if (tool === 'move' || tool === 'transform') items.push(sub(t('menu.layer.arrange'), [cmd('layer.front'), cmd('layer.forward'), cmd('layer.backward'), cmd('layer.back')]));
    items.push('-', cmd('layer.new'), cmd('view.fit'), cmd('view.actual'));
    return { items, label: t('ctx.canvas') };
  };

  // ---------- layers ----------
  const layerItems = (id) => {
    const l = app.edoc && findLayer(app.edoc.doc, id);
    if (!l) return null;
    if (app.edoc.active !== id) globals.selectLayer(id);
    const items = [
      cmd('layer.duplicate'),
      cmd('layer.delete', { danger: true }),
      { label: t('cmd.layer.rename'), run: () => globals.renameLayerInline(id) },
      '-',
      cmd('layer.mergeDown'),
      cmd('layer.mergeVisible'),
      cmd('layer.rasterize'),
      '-',
      sub(t('menu.layer.mask'), [cmd('layer.addMask:auto'), cmd('layer.addMask:hide'), cmd('layer.addMask:selection'), '-', cmd('layer.editMask'), cmd('layer.toggleMask'), cmd('layer.invertMask'), cmd('layer.applyMask'), cmd('layer.deleteMask', { danger: true })]),
      cmd('layer.clip', { checked: !!l.clip }),
      cmd('select.fromLayer'),
    ];
    if (l.type !== 'group' && l.type !== 'adjust') items.push(cmd('layer.style'));
    items.push(
      '-',
      sub(t('layers.blend'), BLEND_MODES.map((b) => ({ label: t(`blend.${b}`), radio: true, checked: l.blend === b, run: () => globals.setProp('blend', b) }))),
      { label: l.visible ? t('layers.hide') : t('layers.show'), run: () => globals.toggleVisible(id) },
      { label: t('ctx.lock'), checked: !!l.locked, run: () => globals.toggleLock(id) },
    );
    return { items, label: l.name };
  };

  // ---------- chat ----------
  const chatItems = (msgId) => {
    const m = S.chat.find((x) => x.id === msgId);
    if (!m) return null;
    const items = [
      { label: t('chat.reply'), run: () => {
        S.replyTo = msgId;
        document.getElementById('chat-input')?.focus();
      } },
      sub(t('chat.react'), ['heart', 'thumbs', 'laugh', 'star', 'wow'].map((k) => ({ label: t(`react.${k}`), checked: m.reactions.some((r) => r.k === k && r.mine), run: () => globals.react(msgId, k) }))),
    ];
    if (m.text) items.push({ label: t('ctx.copyText'), run: () => navigator.clipboard?.writeText(m.text).then(() => ctx.toast(t('live.copied'), 'success'), () => {}) });
    if (m.url) items.push({ label: t('ctx.openImage'), run: () => ctx.openChatImage?.(msgId) });
    return { items, label: t('ctx.message', { name: m.name }) };
  };

  // ---------- people in the room ----------
  const peerItems = (peerId, tileEl = null) => {
    const p = S.live.peers.find((x) => x.id === peerId);
    if (!p) return null;
    const live = app.live;
    const items = [];
    if (tileEl) items.push({ label: tileEl.classList.contains('is-focus') ? t('ctx.shrink') : t('ctx.enlarge'), run: () => tileEl.classList.toggle('is-focus') });
    if (!p.me) {
      items.push({ label: S.live.follow === peerId ? t('live.unfollow') : t('live.follow'), run: () => globals.followPeer(peerId) });
      if (S.call.inCall) items.push({ label: t('ctx.muteForMe'), checked: live.call.isPeerMuted(peerId), run: () => live.call.setPeerMuted(peerId, !live.call.isPeerMuted(peerId)) });
    } else if (S.call.inCall) {
      items.push({ label: S.call.muted ? t('call.unmute') : t('call.mute'), run: () => globals.toggleMute() }, { label: t('call.camera'), checked: S.call.camera, run: () => globals.toggleCamera() }, { label: t('call.screen'), checked: S.call.screen, run: () => globals.toggleScreen() });
    }
    if (live.mode === 'host' && !p.host && !p.me) {
      items.push('-', { label: t('live.role.edit'), radio: true, checked: p.role === 'edit', run: () => globals.setRole(peerId, 'edit') }, { label: t('live.role.view'), radio: true, checked: p.role === 'view', run: () => globals.setRole(peerId, 'view') }, '-', { label: t('ctx.remove'), danger: true, run: () => live.kick(peerId) });
    }
    if (p.safety) items.push('-', { label: `${t('live.safety')}: ${p.safety}`, disabled: true });
    return items.length ? { items, label: p.name } : null;
  };

  const resolve = (target) => {
    if (!(target instanceof Element)) return null;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return null; // the browser's own text menu
    const row = target.closest('[data-layer]');
    if (row) return layerItems(row.dataset.layer);
    const msg = target.closest('[data-msg]');
    if (msg) return chatItems(msg.dataset.msg);
    const tile = target.closest('.tile[data-peer]');
    if (tile) return peerItems(tile.dataset.peer, tile);
    const person = target.closest('[data-peer]');
    if (person) return peerItems(person.dataset.peer);
    if (target.closest('#viewport')) return canvasItems();
    return null;
  };

  bindContextMenu(document, menu, resolve, {
    defaultTarget: () => (S.screen === 'editor' ? document.getElementById('viewport') : null),
    // a long press on the canvas must not leave a brush dab behind
    onLongPress: (target) => {
      if (target.closest?.('#viewport') && app.vp.toolActive) {
        app.vp.toolActive = false;
        app.vp.onTool?.('cancel');
      }
    },
  });
  ui.contextMenu = menu;
  return menu;
}
