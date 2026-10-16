// Markup of every dialog, inserted before Voodoo starts so the directives work. Each dialog is
// a native <dialog> with Monsoon's modal classes; its state lives in S.dlg.

const close = (id) => `<button type="button" class="modal-close" @click="closeDialog('${id}')" :aria-label="$t('dialog.close')"></button>`;
const actions = (inner) => `<div class="modal-actions">${inner}</div>`;
const cancel = (id) => `<button type="button" class="btn btn-ghost" @click="closeDialog('${id}')">{ $t('dialog.cancel') }</button>`;

export const DIALOGS_HTML = `
<dialog id="dlg-new" class="modal" aria-labelledby="dlg-new-title">
  <form class="modal-box modal-lg" @submit.prevent="createDocument()">
    <div class="modal-header"><h2 id="dlg-new-title" class="modal-title">{ $t('new.title') }</h2></div>${close('dlg-new')}
    <div class="new-grid">
      <div class="new-presets" role="listbox" :aria-label="$t('new.presets')">
        <button type="button" class="preset-row" v-for="p in S.presets" :key="p.id" :class="{ active: S.dlg.new.preset === p.id }" @click="pickPreset(p)" :data-preset="p.id"><span class="tpl-box sm" :style="{ aspectRatio: p.w + ' / ' + p.h }"></span><span><b>{ $t('template.' + p.id) }</b><small>{ p.w } x { p.h } px{ p.dpi !== 72 ? ', ' + p.dpi + ' dpi' : '' }</small></span></button>
      </div>
      <div class="new-fields">
        <label class="field"><span class="label">{ $t('new.name') }</span><input class="input input-sm" v-model="S.dlg.new.name" maxlength="120" data-field="name"></label>
        <div class="field-row">
          <label class="field"><span class="label">{ $t('new.width') }</span><input class="input input-sm" type="number" min="1" max="12000" v-model.number="S.dlg.new.w" data-field="width"></label>
          <label class="field"><span class="label">{ $t('new.height') }</span><input class="input input-sm" type="number" min="1" max="12000" v-model.number="S.dlg.new.h" data-field="height"></label>
          <label class="field"><span class="label">dpi</span><input class="input input-sm" type="number" min="1" max="4800" v-model.number="S.dlg.new.dpi"></label>
        </div>
        <label class="field"><span class="label">{ $t('new.background') }</span><select class="select select-sm" v-model="S.dlg.new.bg"><option value="white">{ $t('new.white') }</option><option value="black">{ $t('new.black') }</option><option value="paper">{ $t('new.paper') }</option><option value="transparent">{ $t('new.transparent') }</option><option value="fg">{ $t('new.fg') }</option></select></label>
        <label class="field"><span class="label">{ $t('new.mode') }</span><select class="select select-sm" v-model="S.dlg.new.mode"><option value="rgb">{ $t('mode.rgb') }</option><option value="gray">{ $t('mode.gray') }</option><option value="cmyk">{ $t('mode.cmyk') }</option></select></label>
        <p class="hint" v-show="S.dlg.new.mode === 'cmyk'">{ $t('cmyk.honest') }</p>
      </div>
    </div>
    ${actions(`${cancel('dlg-new')}<button class="btn btn-primary" type="submit" data-action="create">{ $t('new.create') }</button>`)}
  </form>
</dialog>

<dialog id="dlg-export" class="modal" aria-labelledby="dlg-export-title">
  <form class="modal-box modal-lg" @submit.prevent="doExport()">
    <div class="modal-header"><h2 id="dlg-export-title" class="modal-title">{ $t('export.title') }</h2></div>${close('dlg-export')}
    <div class="export-grid">
      <div class="export-preview"><img id="export-preview" alt="" :src="S.dlg.export.previewUrl"><p class="export-size" role="status">{ S.dlg.export.busy ? $t('export.measuring') : S.dlg.export.sizeText }</p></div>
      <div class="export-fields">
        <label class="field"><span class="label">{ $t('export.format') }</span><select class="select select-sm" v-model="S.dlg.export.format" @change="exportChanged()" data-field="format"><option v-for="f in S.exportFormats" :key="f.id" :value="f.id">{ f.label }</option></select></label>
        <label class="field" v-show="S.dlg.export.hasQuality"><span class="label">{ $t('export.quality') } <b>{ Math.round(S.dlg.export.quality * 100) }</b></span><input type="range" class="range range-sm" min="0.05" max="1" step="0.01" v-model.number="S.dlg.export.quality" @change="exportChanged()" data-field="quality"></label>
        <label class="field"><span class="label">{ $t('export.size') }</span><select class="select select-sm" v-model.number="S.dlg.export.scale" @change="exportChanged()" data-field="scale"><option :value="1">{ $t('export.full') } ({ S.doc.width } x { S.doc.height })</option><option :value="2">200%</option><option :value="0.5">50%</option><option :value="0.25">25%</option></select></label>
        <label class="opt" v-show="S.dlg.export.canCmyk"><input type="checkbox" class="checkbox checkbox-sm" v-model="S.dlg.export.cmyk" @change="exportChanged()">{ $t('export.cmyk') }</label>
        <p class="hint" v-show="S.dlg.export.cmyk">{ $t('cmyk.honest') }</p>
        <label class="opt" v-show="S.dlg.export.canAnimate"><input type="checkbox" class="checkbox checkbox-sm" v-model="S.dlg.export.animated" @change="exportChanged()">{ $t('export.animated') }</label>
        <label class="opt" v-show="S.dlg.export.canPages"><input type="checkbox" class="checkbox checkbox-sm" v-model="S.dlg.export.pages" @change="exportChanged()">{ $t('export.pages') }</label>
        <p class="hint" v-show="S.dlg.export.note">{ S.dlg.export.note }</p>
        <p class="error-text" v-show="S.dlg.export.error" role="alert">{ S.dlg.export.error }</p>
      </div>
    </div>
    ${actions(`${cancel('dlg-export')}<button type="button" class="btn btn-soft" @click="exportAndSend()">{ $t('export.send') }</button><button class="btn btn-primary" type="submit" data-action="do-export">{ $t('export.button') }</button>`)}
  </form>
</dialog>

<dialog id="dlg-imagesize" class="modal" aria-labelledby="dlg-is-title">
  <form class="modal-box" @submit.prevent="applyImageSize()">
    <div class="modal-header"><h2 id="dlg-is-title" class="modal-title">{ $t('cmd.image.imageSize') }</h2></div>${close('dlg-imagesize')}
    <div class="field-row">
      <label class="field"><span class="label">{ $t('new.width') }</span><input class="input input-sm" type="number" min="1" max="12000" .value="S.dlg.size.w" @input="sizeInput('w', $event.target.value)"></label>
      <label class="field"><span class="label">{ $t('new.height') }</span><input class="input input-sm" type="number" min="1" max="12000" .value="S.dlg.size.h" @input="sizeInput('h', $event.target.value)"></label>
      <label class="field"><span class="label">dpi</span><input class="input input-sm" type="number" min="1" max="4800" v-model.number="S.dlg.size.dpi"></label>
    </div>
    <label class="opt"><input type="checkbox" class="checkbox checkbox-sm" v-model="S.dlg.size.keep">{ $t('size.keep') }</label>
    <p class="hint">{ $t('size.hint') }</p>
    ${actions(`${cancel('dlg-imagesize')}<button class="btn btn-primary" type="submit">{ $t('dialog.ok') }</button>`)}
  </form>
</dialog>

<dialog id="dlg-canvassize" class="modal" aria-labelledby="dlg-cs-title">
  <form class="modal-box" @submit.prevent="applyCanvasSize()">
    <div class="modal-header"><h2 id="dlg-cs-title" class="modal-title">{ $t('cmd.image.canvasSize') }</h2></div>${close('dlg-canvassize')}
    <div class="field-row">
      <label class="field"><span class="label">{ $t('new.width') }</span><input class="input input-sm" type="number" min="1" max="12000" v-model.number="S.dlg.canvas.w"></label>
      <label class="field"><span class="label">{ $t('new.height') }</span><input class="input input-sm" type="number" min="1" max="12000" v-model.number="S.dlg.canvas.h"></label>
    </div>
    <p class="label">{ $t('size.anchor') }</p>
    <div class="anchor-grid" role="radiogroup" :aria-label="$t('size.anchor')"><button type="button" v-for="a in [0,1,2,3,4,5,6,7,8]" :key="a" :class="{ active: S.dlg.canvas.anchor === a }" @click="S.dlg.canvas.anchor = a" :aria-label="'anchor ' + a"></button></div>
    ${actions(`${cancel('dlg-canvassize')}<button class="btn btn-primary" type="submit">{ $t('dialog.ok') }</button>`)}
  </form>
</dialog>

<dialog id="dlg-filter" class="modal modal-side" aria-labelledby="dlg-filter-title">
  <form class="modal-box" @submit.prevent="filterOk()">
    <div class="modal-header"><h2 id="dlg-filter-title" class="modal-title">{ S.dlg.filter.title }</h2></div>${close('dlg-filter')}
    <div class="filter-params">
      <div class="fparam" v-for="p in S.dlg.filter.params" :key="p.key">
        <label class="slider" v-if="p.type === 'range'"><span>{ p.label }<b>{ S.dlg.filter.values[p.key] }{ p.unit ? ' ' + p.unit : '' }</b></span><input type="range" class="range range-sm" :min="p.min" :max="p.max" :step="p.step" .value="S.dlg.filter.values[p.key]" @input="filterParam(p.key, +$event.target.value)" :data-param="p.key"></label>
        <label class="slider" v-else-if="p.type === 'angle'"><span>{ p.label }<b>{ S.dlg.filter.values[p.key] }&deg;</b></span><input type="range" class="range range-sm" min="0" max="359" .value="S.dlg.filter.values[p.key]" @input="filterParam(p.key, +$event.target.value)"></label>
        <label class="opt" v-else-if="p.type === 'checkbox'"><input type="checkbox" class="checkbox checkbox-sm" .checked="S.dlg.filter.values[p.key]" @change="filterParam(p.key, $event.target.checked)">{ p.label }</label>
        <label class="field" v-else-if="p.type === 'select'"><span class="label">{ p.label }</span><select class="select select-sm" .value="S.dlg.filter.values[p.key]" @change="filterParam(p.key, $event.target.value)"><option v-for="o in p.options" :key="o" :value="o">{ $t('option.' + o) }</option></select></label>
        <label class="field" v-else-if="p.type === 'color'"><span class="label">{ p.label }</span><input type="color" .value="S.dlg.filter.values[p.key]" @input="filterParam(p.key, $event.target.value)"></label>
        <div v-else-if="p.type === 'triple'" class="triple"><p class="label">{ p.label }</p><label class="slider" v-for="(lbl, k) in p.labels" :key="k"><span>{ lbl }<b>{ S.dlg.filter.values[p.key][k] }</b></span><input type="range" class="range range-xs" :min="p.min" :max="p.max" .value="S.dlg.filter.values[p.key][k]" @input="filterTriple(p.key, k, +$event.target.value)"></label></div>
        <div v-else-if="p.type === 'mix'" class="triple"><p class="label">{ p.label }</p><label class="slider" v-for="(lbl, k) in ['R','G','B','+']" :key="k"><span>{ lbl }<b>{ S.dlg.filter.values[p.key][k] }</b></span><input type="range" class="range range-xs" min="-200" max="200" .value="S.dlg.filter.values[p.key][k]" @input="filterTriple(p.key, k, +$event.target.value)"></label></div>
        <div v-else-if="p.type === 'point'" class="triple"><p class="label">{ p.label }</p><label class="slider"><span>X<b>{ Math.round(S.dlg.filter.values[p.key][0] * 100) }%</b></span><input type="range" class="range range-xs" min="0" max="1" step="0.01" .value="S.dlg.filter.values[p.key][0]" @input="filterTriple(p.key, 0, +$event.target.value)"></label><label class="slider"><span>Y<b>{ Math.round(S.dlg.filter.values[p.key][1] * 100) }%</b></span><input type="range" class="range range-xs" min="0" max="1" step="0.01" .value="S.dlg.filter.values[p.key][1]" @input="filterTriple(p.key, 1, +$event.target.value)"></label></div>
        <div v-else-if="p.type === 'curves'" class="curves-editor"><div class="segmented segmented-xs"><label class="segmented-item" v-for="c in ['rgb','red','green','blue']" :key="c"><input type="radio" name="curvech" :checked="S.dlg.filter.channel === c" @change="S.dlg.filter.channel = c; drawCurves()">{ $t('channel.' + c) }</label></div><canvas id="curves-canvas" width="256" height="256" @pointerdown="curveDown($event)" @pointermove="curveMove($event)" @pointerup="curveUp()" @dblclick="curveRemove($event)" :aria-label="$t('curves.hint')"></canvas><p class="hint">{ $t('curves.hint') }</p></div>
        <div v-else-if="p.type === 'levels'" class="levels-editor"><div class="segmented segmented-xs"><label class="segmented-item" v-for="c in ['master','red','green','blue']" :key="c"><input type="radio" name="levch" :checked="S.dlg.filter.channel === c" @change="S.dlg.filter.channel = c">{ $t('channel.' + c) }</label></div><canvas id="levels-hist" width="256" height="90" aria-hidden="true"></canvas>
          <label class="slider"><span>{ $t('levels.inBlack') }<b>{ levelsVal('inBlack', 0) }</b></span><input type="range" class="range range-xs" min="0" max="253" .value="levelsVal('inBlack', 0)" @input="levelsParam('inBlack', +$event.target.value)"></label>
          <label class="slider"><span>{ $t('levels.gamma') }<b>{ levelsVal('gamma', 1) }</b></span><input type="range" class="range range-xs" min="0.1" max="4" step="0.01" .value="levelsVal('gamma', 1)" @input="levelsParam('gamma', +$event.target.value)"></label>
          <label class="slider"><span>{ $t('levels.inWhite') }<b>{ levelsVal('inWhite', 255) }</b></span><input type="range" class="range range-xs" min="2" max="255" .value="levelsVal('inWhite', 255)" @input="levelsParam('inWhite', +$event.target.value)"></label>
          <label class="slider"><span>{ $t('levels.outBlack') }<b>{ levelsVal('outBlack', 0) }</b></span><input type="range" class="range range-xs" min="0" max="255" .value="levelsVal('outBlack', 0)" @input="levelsParam('outBlack', +$event.target.value)"></label>
          <label class="slider"><span>{ $t('levels.outWhite') }<b>{ levelsVal('outWhite', 255) }</b></span><input type="range" class="range range-xs" min="0" max="255" .value="levelsVal('outWhite', 255)" @input="levelsParam('outWhite', +$event.target.value)"></label></div>
        <div v-else-if="p.type === 'gradient'" class="triple"><p class="label">{ p.label }</p><div class="prop-row"><input type="color" .value="S.dlg.filter.values[p.key][0].color" @input="filterStop(p.key, 0, $event.target.value)" aria-label="Start color"><input type="color" .value="S.dlg.filter.values[p.key][S.dlg.filter.values[p.key].length - 1].color" @input="filterStop(p.key, -1, $event.target.value)" aria-label="End color"></div></div>
      </div>
      <p class="hint" v-show="!S.dlg.filter.params.length">{ $t('filter.noSettings') }</p>
    </div>
    <label class="opt"><input type="checkbox" class="checkbox checkbox-sm" v-model="S.dlg.filter.preview" @change="filterPreview()">{ $t('filter.preview') }</label>
    <p class="hint" v-show="S.dlg.filter.adjustLayer">{ $t('filter.layerHint') }</p>
    ${actions(`<button type="button" class="btn btn-ghost" @click="filterReset()">{ $t('dialog.reset') }</button>${cancel('dlg-filter')}<button class="btn btn-primary" type="submit" data-action="filter-ok">{ $t('dialog.ok') }</button>`)}
  </form>
</dialog>

<dialog id="dlg-style" class="modal" aria-labelledby="dlg-style-title">
  <form class="modal-box modal-lg" @submit.prevent="styleOk()">
    <div class="modal-header"><h2 id="dlg-style-title" class="modal-title">{ $t('cmd.layer.style') }</h2></div>${close('dlg-style')}
    <div class="style-grid">
      <ul class="style-list"><li v-for="k in ['shadow','outerGlow','stroke','innerGlow','bevel','overlay']" :key="k" :class="{ active: S.dlg.style.tab === k }"><label class="opt"><input type="checkbox" class="checkbox checkbox-xs" .checked="S.dlg.style.values[k].enabled" @change="styleSet(k, 'enabled', $event.target.checked)"><button type="button" @click="S.dlg.style.tab = k">{ $t('style.' + k) }</button></label></li></ul>
      <div class="style-fields">
        <div class="fparam" v-for="f in styleFields(S.dlg.style.tab)" :key="f.key">
          <label class="slider" v-if="f.type === 'range'"><span>{ $t('style.f.' + f.key) }<b>{ S.dlg.style.values[S.dlg.style.tab][f.key] }</b></span><input type="range" class="range range-sm" :min="f.min" :max="f.max" :step="f.step || 1" .value="S.dlg.style.values[S.dlg.style.tab][f.key]" @input="styleSet(S.dlg.style.tab, f.key, +$event.target.value)"></label>
          <label class="field" v-else-if="f.type === 'color'"><span class="label">{ $t('style.f.color') }</span><input type="color" .value="S.dlg.style.values[S.dlg.style.tab].color" @input="styleSet(S.dlg.style.tab, 'color', $event.target.value)"></label>
          <label class="field" v-else-if="f.type === 'select'"><span class="label">{ $t('style.f.' + f.key) }</span><select class="select select-sm" .value="S.dlg.style.values[S.dlg.style.tab][f.key]" @change="styleSet(S.dlg.style.tab, f.key, $event.target.value)"><option v-for="o in f.options" :key="o" :value="o">{ $t('option.' + o) }</option></select></label>
        </div>
      </div>
    </div>
    ${actions(`${cancel('dlg-style')}<button class="btn btn-primary" type="submit">{ $t('dialog.ok') }</button>`)}
  </form>
</dialog>

<dialog id="dlg-fill" class="modal" aria-labelledby="dlg-fill-title">
  <form class="modal-box" @submit.prevent="fillOk()">
    <div class="modal-header"><h2 id="dlg-fill-title" class="modal-title">{ $t('cmd.edit.fill') }</h2></div>${close('dlg-fill')}
    <label class="field"><span class="label">{ $t('fill.contents') }</span><select class="select select-sm" v-model="S.dlg.fill.source"><option value="fg">{ $t('opt.fgColor') }</option><option value="bg">{ $t('fill.bgColor') }</option><option value="white">{ $t('new.white') }</option><option value="black">{ $t('new.black') }</option><option value="gray">{ $t('fill.gray') }</option><option value="pattern">{ $t('opt.pattern') }</option><option value="content">{ $t('fill.content') }</option></select></label>
    <label class="field" v-show="S.dlg.fill.source === 'pattern'"><span class="label">{ $t('opt.pattern') }</span><select class="select select-sm" v-model="S.dlg.fill.pattern"><option v-for="p in S.patterns" :key="p" :value="p">{ $t('pattern.' + p) }</option></select></label>
    <label class="slider" v-show="S.dlg.fill.source !== 'content'"><span>{ $t('opt.opacity') }<b>{ S.dlg.fill.opacity }%</b></span><input type="range" class="range range-sm" min="1" max="100" v-model.number="S.dlg.fill.opacity"></label>
    ${actions(`${cancel('dlg-fill')}<button class="btn btn-primary" type="submit">{ $t('dialog.ok') }</button>`)}
  </form>
</dialog>

<dialog id="dlg-stroke" class="modal" aria-labelledby="dlg-stroke-title">
  <form class="modal-box" @submit.prevent="strokeOk()">
    <div class="modal-header"><h2 id="dlg-stroke-title" class="modal-title">{ $t('cmd.edit.stroke') }</h2></div>${close('dlg-stroke')}
    <label class="field"><span class="label">{ $t('style.f.size') }</span><input class="input input-sm" type="number" min="1" max="250" v-model.number="S.dlg.stroke.width"></label>
    <label class="field"><span class="label">{ $t('style.f.position') }</span><select class="select select-sm" v-model="S.dlg.stroke.position"><option value="inside">{ $t('option.inside') }</option><option value="center">{ $t('option.center') }</option><option value="outside">{ $t('option.outside') }</option></select></label>
    <p class="hint">{ $t('stroke.hint') }</p>
    ${actions(`${cancel('dlg-stroke')}<button class="btn btn-primary" type="submit">{ $t('dialog.ok') }</button>`)}
  </form>
</dialog>

<dialog id="dlg-modify" class="modal" aria-labelledby="dlg-mod-title">
  <form class="modal-box" @submit.prevent="modifyOk()">
    <div class="modal-header"><h2 id="dlg-mod-title" class="modal-title">{ $t('cmd.select.' + S.dlg.modify.kind) }</h2></div>${close('dlg-modify')}
    <label class="field"><span class="label">{ $t('modify.radius') }</span><input class="input input-sm" type="number" min="1" max="250" v-model.number="S.dlg.modify.radius" data-field="radius"></label>
    ${actions(`${cancel('dlg-modify')}<button class="btn btn-primary" type="submit">{ $t('dialog.ok') }</button>`)}
  </form>
</dialog>

<dialog id="dlg-colorrange" class="modal modal-side" aria-labelledby="dlg-cr-title">
  <form class="modal-box" @submit.prevent="colorRangeOk()">
    <div class="modal-header"><h2 id="dlg-cr-title" class="modal-title">{ $t('cmd.select.colorRange') }</h2></div>${close('dlg-colorrange')}
    <p class="hint">{ $t('colorRange.hint') }</p>
    <div class="prop-row"><span class="swatch inline" :style="{ background: S.dlg.colorRange.color }"></span><button type="button" class="btn btn-xs btn-ghost" @click="colorRangeUseFg()">{ $t('colorRange.useFg') }</button></div>
    <label class="slider"><span>{ $t('colorRange.fuzziness') }<b>{ S.dlg.colorRange.fuzz }</b></span><input type="range" class="range range-sm" min="0" max="200" v-model.number="S.dlg.colorRange.fuzz" @input="colorRangePreview()"></label>
    <canvas id="colorrange-preview" width="220" height="160" class="mask-preview" aria-hidden="true"></canvas>
    ${actions(`${cancel('dlg-colorrange')}<button class="btn btn-primary" type="submit">{ $t('dialog.ok') }</button>`)}
  </form>
</dialog>

<dialog id="dlg-refine" class="modal modal-side" aria-labelledby="dlg-ref-title">
  <form class="modal-box" @submit.prevent="refineOk()">
    <div class="modal-header"><h2 id="dlg-ref-title" class="modal-title">{ $t('cmd.select.refine') }</h2></div>${close('dlg-refine')}
    <label class="opt"><input type="checkbox" class="checkbox checkbox-sm" v-model="S.dlg.refine.subject" @change="refinePreview()">{ $t('refine.subject') }</label>
    <label class="slider"><span>{ $t('refine.smooth') }<b>{ S.dlg.refine.smooth }</b></span><input type="range" class="range range-sm" min="0" max="20" v-model.number="S.dlg.refine.smooth" @change="refinePreview()"></label>
    <label class="slider"><span>{ $t('refine.feather') }<b>{ S.dlg.refine.feather }px</b></span><input type="range" class="range range-sm" min="0" max="60" v-model.number="S.dlg.refine.feather" @change="refinePreview()"></label>
    <label class="slider"><span>{ $t('refine.contrast') }<b>{ S.dlg.refine.contrast }%</b></span><input type="range" class="range range-sm" min="0" max="100" v-model.number="S.dlg.refine.contrast" @change="refinePreview()"></label>
    <label class="slider"><span>{ $t('refine.shift') }<b>{ S.dlg.refine.shift }px</b></span><input type="range" class="range range-sm" min="-30" max="30" v-model.number="S.dlg.refine.shift" @change="refinePreview()"></label>
    <label class="field"><span class="label">{ $t('refine.output') }</span><select class="select select-sm" v-model="S.dlg.refine.output"><option value="selection">{ $t('refine.toSelection') }</option><option value="mask">{ $t('refine.toMask') }</option></select></label>
    ${actions(`${cancel('dlg-refine')}<button class="btn btn-primary" type="submit">{ $t('dialog.ok') }</button>`)}
  </form>
</dialog>

<dialog id="dlg-content" class="modal" aria-labelledby="dlg-ca-title">
  <form class="modal-box" @submit.prevent="contentAwareOk()">
    <div class="modal-header"><h2 id="dlg-ca-title" class="modal-title">{ $t('cmd.edit.contentAware') }</h2></div>${close('dlg-content')}
    <p class="hint">{ $t('content.hint') }</p>
    <label class="slider"><span>{ $t('content.patch') }<b>{ S.dlg.content.patch }</b></span><input type="range" class="range range-sm" min="5" max="15" step="2" v-model.number="S.dlg.content.patch"></label>
    <p class="hint" v-show="S.dlg.content.busy" role="status">{ $t('content.working') }</p>
    ${actions(`${cancel('dlg-content')}<button class="btn btn-primary" type="submit" :disabled="S.dlg.content.busy" data-action="content-ok">{ $t('dialog.ok') }</button>`)}
  </form>
</dialog>

<dialog id="dlg-liquify" class="modal modal-full" aria-labelledby="dlg-lq-title">
  <form class="modal-box liquify-box" @submit.prevent="liquifyOk()">
    <div class="modal-header"><h2 id="dlg-lq-title" class="modal-title">{ $t('cmd.filter.liquify') }</h2></div>${close('dlg-liquify')}
    <div class="liquify-grid">
      <div class="liquify-tools" role="radiogroup"><button type="button" class="tool-btn wide" v-for="lt in ['push','twirl','twirl-ccw','pucker','bloat','smooth','reconstruct']" :key="lt" :class="{ active: S.dlg.liquify.tool === lt }" @click="S.dlg.liquify.tool = lt">{ $t('liquify.' + lt) }</button>
        <label class="slider"><span>{ $t('opt.size') }<b>{ S.dlg.liquify.size }</b></span><input type="range" class="range range-xs" min="10" max="600" v-model.number="S.dlg.liquify.size"></label>
        <label class="slider"><span>{ $t('liquify.pressure') }<b>{ S.dlg.liquify.pressure }</b></span><input type="range" class="range range-xs" min="0.05" max="1" step="0.05" v-model.number="S.dlg.liquify.pressure"></label>
        <button type="button" class="btn btn-xs btn-ghost" @click="liquifyResetAll()">{ $t('dialog.reset') }</button>
      </div>
      <div class="liquify-stage"><canvas id="liquify-canvas" @pointerdown="lqDown($event)" @pointermove="lqMove($event)" @pointerup="lqUp()" @pointercancel="lqUp()" :aria-label="$t('cmd.filter.liquify')"></canvas></div>
    </div>
    ${actions(`${cancel('dlg-liquify')}<button class="btn btn-primary" type="submit">{ $t('dialog.ok') }</button>`)}
  </form>
</dialog>

<dialog id="dlg-sticker" class="modal" aria-labelledby="dlg-st-title">
  <form class="modal-box modal-lg" @submit.prevent="stickerDownload()">
    <div class="modal-header"><h2 id="dlg-st-title" class="modal-title">{ $t('sticker.title') }</h2></div>${close('dlg-sticker')}
    <div class="sticker-grid">
      <div class="sticker-stage"><canvas id="sticker-canvas" width="512" height="512" :aria-label="$t('sticker.preview')"></canvas><p class="export-size" role="status">{ S.dlg.sticker.status }</p></div>
      <div class="sticker-fields">
        <p class="hint" v-show="S.dlg.sticker.working">{ $t('sticker.cutting') }</p>
        <label class="slider"><span>{ $t('sticker.outline') }<b>{ S.dlg.sticker.outline }px</b></span><input type="range" class="range range-sm" min="0" max="30" v-model.number="S.dlg.sticker.outline" @change="stickerDraw()" data-field="outline"></label>
        <label class="field"><span class="label">{ $t('sticker.outlineColor') }</span><input type="color" v-model="S.dlg.sticker.outlineColor" @change="stickerDraw()"></label>
        <label class="field"><span class="label">{ $t('sticker.caption') }</span><input class="input input-sm" maxlength="40" v-model="S.dlg.sticker.caption" @change="stickerDraw()" :placeholder="$t('sticker.captionHint')" data-field="caption"></label>
        <label class="field"><span class="label">{ $t('opt.font') }</span><select class="select select-sm" v-model="S.dlg.sticker.font" @change="stickerDraw()"><option v-for="f in S.fonts" :key="f" :value="f">{ f }</option></select></label>
        <p class="hint">{ $t('sticker.spec') }</p>
        <p class="error-text" v-show="S.dlg.sticker.error" role="alert">{ S.dlg.sticker.error }</p>
      </div>
    </div>
    ${actions(`${cancel('dlg-sticker')}<button type="button" class="btn btn-soft" @click="stickerShare()" v-show="S.canShareFiles">{ $t('sticker.phone') }</button><button class="btn btn-primary" type="submit" data-action="sticker-save">{ $t('sticker.download') }</button>`)}
  </form>
</dialog>

<dialog id="dlg-live" class="modal" aria-labelledby="dlg-live-title">
  <div class="modal-box modal-lg">
    <div class="modal-header"><h2 id="dlg-live-title" class="modal-title">{ S.live.mode === 'send' ? $t('send.title') : $t('live.title') }</h2></div>${close('dlg-live')}
    <div class="pair" v-show="S.live.step === 'starting'"><span class="spinner spinner-ring spinner-sm"></span>{ $t('live.starting') }</div>
    <div class="pair" v-show="S.live.step === 'code'" id="live-code">
      <p>{ S.live.mode === 'send' ? $t('send.tell') : $t('live.tell') }</p>
      <div class="pair-grid">
        <ol class="word-tiles" id="code-words" :data-words="S.live.words.join(' ')"><li v-for="(w, i) in S.live.words" :key="i"><span>{ i + 1 }</span>{ w }</li></ol>
        <div class="qr-box" v-html="S.live.qr" id="code-qr" :aria-label="$t('live.qr')"></div>
      </div>
      <div class="invite-link" v-show="S.live.qrLink">
        <label class="label" for="invite-link">{ $t('live.linkLabel') }</label>
        <div class="invite-row"><input id="invite-link" class="input input-sm mono" readonly :value="S.live.qrLink || ''" @focus="$event.target.select()"><button type="button" class="btn btn-sm btn-primary" @click="copyInvite()" data-action="copy-invite"><svg class="ic" aria-hidden="true"><use :href="S.live.copied ? 'icons.svg#i-check' : 'icons.svg#i-link'"/></svg>{ S.live.copied ? $t('live.copied') : $t('live.copy') }</button><button type="button" class="btn btn-sm btn-ghost" v-show="canShare()" @click="shareInvite()">{ $t('live.shareLink') }</button></div>
      </div>
      <p class="hint">{ S.live.mode === 'send' ? $t('send.scanHint') : $t('live.scanHint') }</p>
      <p class="hint" v-show="S.live.mode === 'host'">{ $t('live.inRoom', { n: Math.max(0, (S.live.peers || []).length - 1) }) } <button type="button" class="btn btn-xs btn-ghost" @click="newRoomWords()" data-action="new-words">{ $t('live.newWords') }</button></p>
      <p class="hint">{ $t('live.relays', { n: S.live.relays || 0 }) } <span v-show="S.stun.checked">{ S.stun.ok ? $t('stun.ok') : $t('stun.blocked') }</span></p>
    </div>
    <div class="pair" v-show="S.live.step === 'confirm-type'">
      <p>{ $t('live.typeConfirm', { name: S.live.peerName || '' }) }</p>
      <form class="word-inputs" @submit.prevent="confirmWords()" id="confirm-form"><input v-for="i in [0,1,2,3,4,5]" :key="i" class="input input-sm" :id="'confirm-word-' + i" autocomplete="off" autocapitalize="none" spellcheck="false" :aria-label="$t('live.word', { n: i + 1 })" @paste="pasteWords($event, 'confirm-word-')" @input="wordTyped($event, i, 'confirm-word-')"><button class="btn btn-primary btn-sm" type="submit" id="confirm-btn">{ $t('live.confirm') }</button></form>
      <p class="error-text" v-show="S.live.confirmError" role="alert" id="confirm-error">{ S.live.confirmError }</p>
    </div>
    <div class="pair" v-show="S.live.step === 'live'"><p class="ok-line"><svg class="ic" aria-hidden="true"><use href="icons.svg#i-check"/></svg>{ $t('live.connected') }</p><button type="button" class="btn btn-sm btn-soft" @click="inviteMore()">{ $t('live.inviteMore') }</button></div>
    <div class="pair" v-show="S.live.step === 'sending'"><span class="spinner spinner-ring spinner-sm"></span>{ $t('send.sending', { name: S.live.peerName || '' }) }</div>
    <div class="pair" v-show="S.live.step === 'sent'" id="send-result"><p class="ok-line" v-show="S.live.sendState === 'verified'"><svg class="ic" aria-hidden="true"><use href="icons.svg#i-shield"/></svg>{ $t('send.verified') }</p><p class="error-text" v-show="S.live.sendState === 'mismatch'">{ $t('send.mismatch') }</p><code class="hash">{ S.live.sha256 }</code></div>
    <div class="pair" v-show="S.live.step === 'expired' || S.live.step === 'failed'"><p class="error-text" role="alert">{ S.live.step === 'expired' ? $t('live.expired') : S.live.error }</p><button type="button" class="btn btn-sm btn-primary" @click="inviteMore()">{ $t('live.tryAgain') }</button></div>
  </div>
</dialog>

<dialog id="dlg-join" class="modal" aria-labelledby="dlg-join-title">
  <div class="modal-box modal-lg">
    <div class="modal-header"><h2 id="dlg-join-title" class="modal-title">{ $t('join.title') }</h2></div>${close('dlg-join')}
    <div class="pair" v-show="!S.live.step || S.live.step === 'idle' || S.live.mode === 'off'">
      <p>{ $t('join.intro') }</p>
      <form class="word-inputs" @submit.prevent="joinWords()"><input v-for="i in [0,1,2,3,4,5]" :key="i" class="input input-sm" :id="'join-word-' + i" autocomplete="off" autocapitalize="none" spellcheck="false" :aria-label="$t('live.word', { n: i + 1 })" @paste="pasteWords($event, 'join-word-')" @input="wordTyped($event, i, 'join-word-')"><button class="btn btn-primary btn-sm" type="submit" id="join-btn">{ $t('join.button') }</button></form>
      <p class="error-text" v-show="S.dlg.join.error" role="alert">{ S.dlg.join.error }</p>
    </div>
    <div class="pair" v-show="S.live.step === 'joining'"><span class="spinner spinner-ring spinner-sm"></span>{ $t('join.finding') }</div>
    <div class="pair" v-show="S.live.step === 'confirm-show'" id="confirm-show">
      <p>{ $t('join.showConfirm', { name: S.live.peerName || '' }) }</p>
      <ol class="word-tiles big" id="confirm-words" :data-words="(S.live.shownWords || []).join(' ')"><li v-for="(w, i) in (S.live.shownWords || [])" :key="i"><span>{ i + 1 }</span>{ w }</li></ol>
    </div>
    <div class="pair" v-show="S.live.step === 'loading'"><span class="spinner spinner-ring spinner-sm"></span>{ $t('join.loading') }</div>
    <div class="pair" v-show="S.live.step === 'receiving'"><span class="spinner spinner-ring spinner-sm"></span>{ $t('receive.waiting', { name: S.live.peerName || '' }) }</div>
    <div class="pair" v-show="S.live.step === 'received'" id="receive-result">
      <p class="ok-line" v-show="S.live.received && S.live.received.ok"><svg class="ic" aria-hidden="true"><use href="icons.svg#i-shield"/></svg>{ $t('receive.verified') }</p>
      <p class="error-text" v-show="S.live.received && !S.live.received.ok" role="alert">{ $t('receive.mismatch') }</p>
      <img class="received-preview" v-show="S.live.received && S.live.received.ok" :src="S.live.received ? S.live.received.url : ''" alt="">
      <p class="hint">{ S.live.received ? S.live.received.name + ', ' + S.live.received.size + ' bytes' : '' }</p>
      <code class="hash" id="received-hash">{ S.live.received ? S.live.received.sha256 : '' }</code>
      <div class="modal-actions"><button type="button" class="btn btn-soft" @click="saveReceived()">{ $t('receive.save') }</button><button type="button" class="btn btn-primary" @click="openReceived()">{ $t('receive.open') }</button></div>
    </div>
    <div class="pair" v-show="S.live.step === 'failed'"><p class="error-text" role="alert">{ S.live.error }</p><button type="button" class="btn btn-sm btn-primary" @click="S.live.step = 'idle'; S.live.mode = 'off'">{ $t('live.tryAgain') }</button></div>
  </div>
</dialog>

<dialog id="dlg-settings" class="modal" aria-labelledby="dlg-set-title">
  <form class="modal-box modal-lg" @submit.prevent="saveSettings()">
    <div class="modal-header"><h2 id="dlg-set-title" class="modal-title">{ $t('settings.title') }</h2></div>${close('dlg-settings')}
    <div class="settings-grid">
      <fieldset class="fieldset"><legend class="legend">{ $t('settings.general') }</legend>
        <label class="field"><span class="label">{ $t('settings.name') }</span><input class="input input-sm" maxlength="40" v-model="S.settings.name"></label>
        <label class="field"><span class="label">{ $t('settings.language') }</span><select class="select select-sm" .value="S.lang" @change="setLanguage($event.target.value)"><option value="en">English</option><option value="pt-BR">Portugu&ecirc;s</option></select></label>
        <label class="opt"><input type="checkbox" class="checkbox checkbox-sm" v-model="S.settings.autosave">{ $t('settings.autosave') }</label>
        <label class="opt"><input type="checkbox" class="checkbox checkbox-sm" v-model="S.settings.preloadModel">{ $t('settings.preloadModel') }</label>
      </fieldset>
      <fieldset class="fieldset"><legend class="legend">{ $t('settings.network') }</legend>
        <p class="hint">{ $t('settings.stunHint') }</p>
        <p class="hint" role="status">{ S.stun.checked ? (S.stun.ok ? $t('stun.okList', { list: S.stun.answered.join(', ') }) : $t('stun.blocked')) : $t('stun.checking') } <button type="button" class="btn btn-xs btn-ghost" @click="checkStun()">{ $t('stun.check') }</button></p>
        <label class="field"><span class="label">{ $t('settings.turn') }</span><input class="input input-sm" v-model="S.settings.turn.urls" placeholder="turn:turn.example.com:3478"></label>
        <div class="field-row"><label class="field"><span class="label">{ $t('settings.turnUser') }</span><input class="input input-sm" v-model="S.settings.turn.username" autocomplete="off"></label><label class="field"><span class="label">{ $t('settings.turnPass') }</span><input class="input input-sm" type="password" v-model="S.settings.turn.credential" autocomplete="off"></label></div>
        <label class="field"><span class="label">{ $t('settings.defaultRole') }</span><select class="select select-sm" v-model="S.settings.defaultRole"><option value="edit">{ $t('live.role.edit') }</option><option value="view">{ $t('live.role.view') }</option></select></label>
      </fieldset>
      <fieldset class="fieldset"><legend class="legend">{ $t('settings.call') }</legend>
        <label class="field"><span class="label">{ $t('settings.noise') }</span><select class="select select-sm" v-model="S.settings.call.noiseMode"><option value="strong">{ $t('noise.strong') }</option><option value="standard">{ $t('noise.standard') }</option><option value="off">{ $t('noise.off') }</option></select></label>
        <p class="hint">{ $t('noise.hint.' + S.settings.call.noiseMode) }</p>
        <label class="slider"><span>{ $t('settings.gate') }<b>{ S.settings.call.gateSensitivity }</b></span><input type="range" class="range range-sm" min="0" max="100" v-model.number="S.settings.call.gateSensitivity" @input="setGate()"></label>
        <label class="field"><span class="label">{ $t('settings.mic') }</span><select class="select select-sm" v-model="S.settings.call.inputId"><option value="">{ $t('settings.default') }</option><option v-for="d in S.devices.inputs" :key="d.id" :value="d.id">{ d.label }</option></select></label>
        <label class="field"><span class="label">{ $t('settings.speaker') }</span><select class="select select-sm" v-model="S.settings.call.outputId"><option value="">{ $t('settings.default') }</option><option v-for="d in S.devices.outputs" :key="d.id" :value="d.id">{ d.label }</option></select></label>
        <label class="field"><span class="label">{ $t('settings.camera') }</span><select class="select select-sm" v-model="S.settings.call.cameraId"><option value="">{ $t('settings.default') }</option><option v-for="d in S.devices.cameras" :key="d.id" :value="d.id">{ d.label }</option></select></label>
        <div class="mic-test"><button type="button" class="btn btn-xs" :class="S.micTest ? 'btn-danger' : 'btn-soft'" @click="micTest()">{ S.micTest ? $t('settings.micStop') : $t('settings.micTest') }</button><meter class="meter" min="0" max="1" .value="S.micLevel" :aria-label="$t('settings.level')"></meter></div>
      </fieldset>
    </div>
    ${actions(`<button class="btn btn-primary" type="submit">{ $t('dialog.done') }</button>`)}
  </form>
</dialog>

<dialog id="dlg-shortcuts" class="modal" aria-labelledby="dlg-sc-title">
  <div class="modal-box modal-lg">
    <div class="modal-header"><h2 id="dlg-sc-title" class="modal-title">{ $t('shortcuts.title') }</h2></div>${close('dlg-shortcuts')}
    <div class="shortcut-cols"><dl v-for="sec in S.shortcutList" :key="sec.title"><dt class="sc-head">{ $t(sec.title) }</dt><div class="sc-row" v-for="r in sec.rows" :key="r.id"><dt>{ r.label }</dt><dd><kbd class="kbd kbd-sm">{ r.key }</kbd></dd></div></dl></div>
  </div>
</dialog>

<dialog id="dlg-about" class="modal" aria-labelledby="dlg-ab-title">
  <div class="modal-box modal-lg about">
    <div class="modal-header"><h2 id="dlg-ab-title" class="modal-title">{ $t('about.title') }</h2></div>${close('dlg-about')}
    <div class="about-head"><img src="art/otto-loader.svg" width="96" height="90" alt=""><div><p><b>pixelotter { S.version }</b></p><p class="hint">{ $t('about.lede') }</p></div></div>
    <h3>{ $t('about.model') }</h3>
    <table class="table table-compact"><tbody><tr><th>{ $t('about.modelName') }</th><td>{ S.modelName }</td></tr><tr><th>{ $t('about.task') }</th><td>{ $t('about.taskText') }</td></tr><tr><th>{ $t('about.license') }</th><td>{ S.modelLicense }</td></tr><tr><th>{ $t('about.size') }</th><td>{ S.modelMb } MB ({ $t('about.runtime') }: onnxruntime-web { S.runtimeVersion }, MIT, { S.runtimeMb } MB)</td></tr><tr><th>{ $t('about.source') }</th><td>{ S.modelUpstream }</td></tr></tbody></table>
    <h3>{ $t('about.thirdParty') }</h3>
    <ul class="about-list"><li>{ $t('about.fonts') }</li><li>{ $t('about.pdfjs') }</li><li>{ $t('about.monsoon') }</li></ul>
    <h3>{ $t('about.honest') }</h3>
    <ul class="about-list"><li v-for="k in ['approx','cmyk','generative','threeD','plugins','raw','heic','exr','psd','webp','p2p']" :key="k">{ $t('honest.' + k) }</li></ul>
    <p class="hint">{ $t('about.credit') }</p>
  </div>
</dialog>

<dialog id="dlg-confirm" class="modal" aria-labelledby="dlg-cf-title">
  <form class="modal-box" @submit.prevent="confirmAnswer(true)">
    <div class="modal-header"><h2 id="dlg-cf-title" class="modal-title">{ S.dlg.confirm.title }</h2></div>
    <p class="modal-body">{ S.dlg.confirm.text }</p>
    <input class="input input-sm" v-show="S.dlg.confirm.input !== null" v-model="S.dlg.confirm.input" id="confirm-input" maxlength="120">
    <div class="modal-actions"><button type="button" class="btn btn-ghost" v-show="S.dlg.confirm.third" @click="confirmAnswer('third')">{ S.dlg.confirm.third }</button><button type="button" class="btn btn-ghost" @click="confirmAnswer(false)">{ S.dlg.confirm.no || $t('dialog.cancel') }</button><button class="btn btn-primary" type="submit" data-action="confirm-yes">{ S.dlg.confirm.yes || $t('dialog.ok') }</button></div>
  </form>
</dialog>

<dialog id="dlg-guide" class="modal" aria-labelledby="dlg-gd-title">
  <form class="modal-box" @submit.prevent="guideOk()">
    <div class="modal-header"><h2 id="dlg-gd-title" class="modal-title">{ $t('cmd.view.newGuide') }</h2></div>${close('dlg-guide')}
    <div class="segmented segmented-sm" role="radiogroup"><label class="segmented-item"><input type="radio" name="gax" :checked="S.dlg.guide.axis === 'x'" @change="S.dlg.guide.axis = 'x'">{ $t('guide.vertical') }</label><label class="segmented-item"><input type="radio" name="gax" :checked="S.dlg.guide.axis === 'y'" @change="S.dlg.guide.axis = 'y'">{ $t('guide.horizontal') }</label></div>
    <label class="field"><span class="label">{ $t('guide.position') }</span><input class="input input-sm" type="number" v-model.number="S.dlg.guide.pos"></label>
    ${actions(`${cancel('dlg-guide')}<button class="btn btn-primary" type="submit">{ $t('dialog.ok') }</button>`)}
  </form>
</dialog>

<div class="tour" v-show="S.tour.on" role="dialog" aria-modal="true" :aria-label="$t('tour.label')">
  <div class="tour-spot" :style="S.tour.spot"></div>
  <div class="tour-card" :style="S.tour.card">
    <img src="art/otto-loader.svg" width="54" height="51" alt="">
    <p class="tour-step">{ S.tour.i + 1 } / { S.tour.n }</p>
    <h3>{ $t('tour.' + S.tour.key + '.title') }</h3>
    <p>{ $t('tour.' + S.tour.key + '.text') }</p>
    <div class="modal-actions"><button type="button" class="btn btn-ghost btn-sm" @click="tourEnd()">{ $t('tour.skip') }</button><button type="button" class="btn btn-primary btn-sm" @click="tourNext()" data-action="tour-next">{ S.tour.i + 1 === S.tour.n ? $t('tour.done') : $t('tour.next') }</button></div>
  </div>
</div>
`;
