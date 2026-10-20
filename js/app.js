/* ImageEQ — app glue: image loading, EQ panel, live preview, export. */
'use strict';

(function () {
  const PREVIEW_SIZE = 512;
  const MAX_EXPORT_SIZE = 2048;

  const state = {
    bands: EQ.makeBands(),
    selected: 3,
    bypass: false,
    presetName: 'Flat',
    mode: 'flat',
    range: { min: 20, max: 20000 },
    view: 'fit',
    split: 0.36,
    source: null,
    crop: null,
    processedReady: false,
    previewLayout: null,
    previewW: 0,
    previewH: 0,
    exporting: false,
  };

  let gainTable = EQ.buildGainTable(state.bands, state.mode);
  let editor = null;
  let pipeline = null;
  let toastTimer = 0;
  let dragDepth = 0;
  let splitDrag = false;
  let sampleCanvas = null;

  const originalCanvas = document.createElement('canvas');
  const processedCanvas = document.createElement('canvas');
  originalCanvas.width = originalCanvas.height = PREVIEW_SIZE;
  processedCanvas.width = processedCanvas.height = PREVIEW_SIZE;
  const originalCtx = originalCanvas.getContext('2d');
  const processedCtx = processedCanvas.getContext('2d');

  const els = {
    bypassBtn: document.getElementById('bypassBtn'),
    presetSelect: document.getElementById('presetSelect'),
    viewSelect: document.getElementById('viewSelect'),
    bandButtons: document.getElementById('bandButtons'),
    eqCanvas: document.getElementById('eqCanvas'),
    baseZero: document.getElementById('baseZero'),
    baseFlat: document.getElementById('baseFlat'),
    rangeBtn: document.getElementById('rangeBtn'),
    rangeValue: document.getElementById('rangeValue'),
    rangePopover: document.getElementById('rangePopover'),
    rangeMin: document.getElementById('rangeMin'),
    rangeMax: document.getElementById('rangeMax'),
    rangeApply: document.getElementById('rangeApply'),
    rangeFull: document.getElementById('rangeFull'),
    readFreq: document.getElementById('readFreq'),
    readGain: document.getElementById('readGain'),
    readQ: document.getElementById('readQ'),
    stage: document.getElementById('stage'),
    previewCanvas: document.getElementById('previewCanvas'),
    sourceName: document.getElementById('sourceName'),
    sourceDims: document.getElementById('sourceDims'),
    fftInfo: document.getElementById('fftInfo'),
    timingInfo: document.getElementById('timingInfo'),
    bypassPill: document.getElementById('bypassPill'),
    stageLoading: document.getElementById('stageLoading'),
    loadingLabel: document.getElementById('loadingLabel'),
    stageHint: document.getElementById('stageHint'),
    emptyState: document.getElementById('emptyState'),
    dropOverlay: document.getElementById('dropOverlay'),
    openBtn: document.getElementById('openBtn'),
    sampleBtn: document.getElementById('sampleBtn'),
    exportBtn: document.getElementById('exportBtn'),
    fileInput: document.getElementById('fileInput'),
    emptyOpenBtn: document.getElementById('emptyOpenBtn'),
    toast: document.getElementById('toast'),
  };

  const previewCtx = els.previewCanvas.getContext('2d');
  const checkerTile = createCheckerTile();

  function createCheckerTile() {
    const tile = document.createElement('canvas');
    tile.width = 16;
    tile.height = 16;
    const tileCtx = tile.getContext('2d');
    tileCtx.fillStyle = '#191d22';
    tileCtx.fillRect(0, 0, 16, 16);
    tileCtx.fillStyle = '#20252b';
    tileCtx.fillRect(0, 0, 8, 8);
    tileCtx.fillRect(8, 8, 8, 8);
    return tile;
  }

  init();

  function init() {
    buildPresetSelect();
    buildBandButtons();
    syncReadouts();
    syncBaseButtons();
    updateRangeLabel();

    pipeline = new ImgPipeline.Pipeline({
      size: PREVIEW_SIZE,
      onFrame: handlePipelineFrame,
      onBusy: handlePipelineBusy,
      onError: (message) => {
        hideLoading();
        showToast(message, true);
      },
    });

    editor = new CurveEditor(els.eqCanvas, {
      getBands: () => state.bands,
      getSelected: () => state.selected,
      getMode: () => state.mode,
      getRange: () => state.range,
      isBypassed: () => state.bypass,
      onSelect: selectBand,
      onChange: handleCurveChange,
      onHover: setHoveredBand,
    });

    wireToolbar();
    wirePreview();
    wireFileDrop();
    wireKeyboard();

    els.fftInfo.textContent = 'FFT ' + PREVIEW_SIZE + '²';
    els.viewSelect.value = state.view;
    updateEmptyState();
    resizePreview();

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => drawPreview());
    }

    // Open on something interesting instead of an empty canvas.
    loadSample();
  }

  /* ---------- EQ panel ---------- */

  function buildPresetSelect() {
    const custom = document.createElement('option');
    custom.value = 'Custom';
    custom.textContent = 'Custom';
    custom.disabled = true;
    els.presetSelect.appendChild(custom);
    for (const preset of EQ.PRESETS) {
      const option = document.createElement('option');
      option.value = preset.name;
      option.textContent = preset.name;
      els.presetSelect.appendChild(option);
    }
    els.presetSelect.value = state.presetName;
  }

  function bandLabel(band) {
    if (band.type === 'lowshelf') return 'low shelf';
    if (band.type === 'highshelf') return 'high shelf';
    return 'bell';
  }

  function buildBandButtons() {
    els.bandButtons.textContent = '';
    state.bands.forEach((band, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'band-btn';
      button.dataset.band = String(index);
      button.style.setProperty('--band-color', band.color);
      button.title = `Band ${index + 1} · ${bandLabel(band)} — on`;
      button.setAttribute('aria-label', `Band ${index + 1}, ${bandLabel(band)}`);

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 27 16');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', EQ.iconPath(band.type));
      svg.appendChild(path);
      button.appendChild(svg);

      button.addEventListener('click', () => selectBand(index));
      els.bandButtons.appendChild(button);
    });
    syncBandButtons();
  }

  function syncBandButtons() {
    const buttons = els.bandButtons.children;
    for (let i = 0; i < buttons.length; i++) {
      const band = state.bands[i];
      const button = buttons[i];
      if (!band || !button) continue;
      button.classList.toggle('is-selected', i === state.selected);
      button.title = `Band ${i + 1} · ${bandLabel(band)} — click to edit`;
    }
  }

  function setHoveredBand(index) {
    const buttons = els.bandButtons.children;
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('is-hover', i === index);
    }
  }

  function selectBand(index) {
    state.selected = index;
    syncBandButtons();
    syncReadouts();
    updateStageHint();
    if (editor) editor.invalidate();
  }

  function freqLabel(freq) {
    if (freq >= 1000) {
      const k = freq / 1000;
      const text = k >= 10 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, '');
      return text + ' kHz';
    }
    return Math.round(freq) + ' Hz';
  }

  function syncReadouts() {
    const band = state.selected >= 0 ? state.bands[state.selected] : null;
    const values = [
      [els.readFreq, band ? freqLabel(band.freq) : '—'],
      [els.readGain, band ? EQ.formatLevel(band.level) : '—'],
      [els.readQ, band ? EQ.formatQ(band.q) : '—'],
    ];
    for (const [element, text] of values) {
      element.textContent = text;
      element.classList.toggle('is-empty', !band);
    }
  }

  function handleCurveChange() {
    state.presetName = 'Custom';
    els.presetSelect.value = 'Custom';
    gainTable = EQ.buildGainTable(state.bands, state.mode);
    if (pipeline) pipeline.setGain(gainTable);
    syncReadouts();
    syncBandButtons();
    updateStageHint();
  }

  function applyPresetByName(name) {
    const preset = EQ.PRESETS.find((item) => item.name === name);
    if (!preset) return;
    EQ.applyPreset(state.bands, preset);
    state.mode = preset.base || 'flat';
    state.presetName = preset.name;
    els.presetSelect.value = preset.name;
    gainTable = EQ.buildGainTable(state.bands, state.mode);
    if (pipeline) pipeline.setGain(gainTable);
    syncBaseButtons();
    syncReadouts();
    syncBandButtons();
    updateStageHint();
    if (editor) editor.invalidate();
  }

  function syncBaseButtons() {
    const zero = state.mode === 'zero';
    els.baseZero.classList.toggle('is-active', zero);
    els.baseFlat.classList.toggle('is-active', !zero);
    els.baseZero.setAttribute('aria-pressed', String(zero));
    els.baseFlat.setAttribute('aria-pressed', String(!zero));
  }

  function setBase(mode) {
    state.mode = mode;
    const base = mode === 'zero' ? 0 : EQ.LEVEL_NEUTRAL;
    for (const band of state.bands) band.level = base;
    state.presetName = mode === 'zero' ? 'Zero' : 'Flat';
    els.presetSelect.value = state.presetName;
    gainTable = EQ.buildGainTable(state.bands, state.mode);
    if (pipeline) pipeline.setGain(gainTable);
    syncBaseButtons();
    syncReadouts();
    syncBandButtons();
    updateStageHint();
    if (editor) editor.invalidate();
  }

  function updateRangeLabel() {
    els.rangeValue.textContent =
      EQ.formatHz(state.range.min) + '–' + EQ.formatHz(state.range.max);
    els.rangeBtn.title = `Frequency range ${Math.round(
      state.range.min
    )} Hz – ${Math.round(state.range.max)} Hz`;
  }

  function openRangePopover() {
    els.rangeMin.value = String(Math.round(state.range.min));
    els.rangeMax.value = String(Math.round(state.range.max));
    els.rangePopover.hidden = false;
    els.rangeBtn.classList.add('is-open');
    els.rangeBtn.setAttribute('aria-expanded', 'true');
    els.rangeMin.focus();
    els.rangeMin.select();
    document.addEventListener('pointerdown', onRangeOutside, true);
    document.addEventListener('keydown', onRangeKeydown);
  }

  function closeRangePopover() {
    els.rangePopover.hidden = true;
    els.rangeBtn.classList.remove('is-open');
    els.rangeBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onRangeOutside, true);
    document.removeEventListener('keydown', onRangeKeydown);
  }

  function onRangeOutside(event) {
    if (!event.target.closest || !event.target.closest('.range-wrap')) {
      closeRangePopover();
    }
  }

  function onRangeKeydown(event) {
    if (event.key === 'Escape') closeRangePopover();
  }

  function applyRange(min, max) {
    min = Math.round(Number(min));
    max = Math.round(Number(max));
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 20 || max > 20000 || min >= max) {
      showToast('Use a range between 20 and 20000 Hz with From < To.', true);
      return;
    }
    const old = state.range;
    const next = { min, max };
    for (const band of state.bands) {
      const norm = EQ.freqToNorm(band.freq, old);
      band.freq = EQ.normToFreq(norm, next);
    }
    state.range = next;
    state.presetName = 'Custom';
    els.presetSelect.value = 'Custom';
    gainTable = EQ.buildGainTable(state.bands, state.mode);
    if (pipeline) pipeline.setGain(gainTable);
    updateRangeLabel();
    syncReadouts();
    updateStageHint();
    if (editor) editor.invalidate();
    closeRangePopover();
  }

  function setBypass(bypass) {
    state.bypass = bypass;
    els.bypassBtn.classList.toggle('is-on', !bypass);
    els.bypassBtn.setAttribute('aria-pressed', String(bypass));
    els.bypassPill.hidden = !bypass;
    updateStageHint();
    if (editor) editor.invalidate();
    drawPreview();
  }

  /* ---------- preview pipeline ---------- */

  function updateStageHint() {
    const zero =
      state.mode === 'zero' &&
      state.bands.every((band) => band.level <= 0.01);
    els.stageHint.textContent = zero
      ? 'All bands at 0% — drag a node up'
      : 'Drag the divider to compare';
    els.stageHint.classList.toggle(
      'is-hidden',
      state.bypass || !state.processedReady || !state.source
    );
  }

  function handlePipelineFrame(rgba, meta) {
    if (meta.size !== PREVIEW_SIZE) return;
    processedCtx.putImageData(
      new ImageData(rgba, PREVIEW_SIZE, PREVIEW_SIZE),
      0,
      0
    );
    state.processedReady = true;
    hideLoading();
    els.timingInfo.textContent = Math.round(meta.renderMs) + ' ms';
    els.timingInfo.title = `FFT ${Math.round(meta.forwardMs)} ms · filter render ${Math.round(meta.renderMs)} ms (3 channels, in parallel)`;
    updateStageHint();
    drawPreview();
  }

  function handlePipelineBusy(busy) {
    if (busy && !state.processedReady && state.source) {
      showLoading('Analyzing spectrum…');
    }
  }

  function showLoading(label) {
    els.loadingLabel.textContent = label;
    els.stageLoading.classList.add('is-visible');
  }

  function hideLoading() {
    els.stageLoading.classList.remove('is-visible');
  }

  /* ---------- images ---------- */

  function updateEmptyState() {
    els.emptyState.hidden = Boolean(state.source);
    if (!state.source) {
      els.sourceName.textContent = 'No image';
      els.sourceDims.textContent = '—';
      els.timingInfo.textContent = '—';
    }
  }

  async function decode(blob) {
    if ('createImageBitmap' in window) {
      try {
        return await createImageBitmap(blob, { imageOrientation: 'from-image' });
      } catch (error) {
        // Fall through to <img> decoding.
      }
    }
    const url = URL.createObjectURL(blob);
    try {
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('Could not decode image'));
        element.src = url;
      });
      return image;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }

  async function loadFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('That file is not an image.', true);
      return;
    }
    showLoading('Decoding image…');
    try {
      const bitmap = await decode(file);
      const name = (file.name || 'Pasted image').replace(/\.[^.]+$/, '') || 'Pasted image';
      await setSource(bitmap, name);
    } catch (error) {
      hideLoading();
      showToast(error.message || 'Could not load that image.', true);
    }
  }

  async function setSource(bitmap, name) {
    if (!bitmap || !bitmap.width || !bitmap.height) {
      throw new Error('Image has no pixels');
    }
    showLoading('Analyzing spectrum…');
    state.processedReady = false;
    state.source = {
      bitmap,
      name,
      width: bitmap.width,
      height: bitmap.height,
    };
    state.split = 0.36;

    const padded = buildPadded(bitmap, PREVIEW_SIZE);
    state.crop = padded.crop;

    originalCtx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    originalCtx.putImageData(
      new ImageData(padded.rgba, PREVIEW_SIZE, PREVIEW_SIZE),
      0,
      0
    );
    processedCtx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);

    document.title = name + ' — Image EQ';
    els.sourceName.textContent = name;
    els.sourceDims.textContent = bitmap.width + ' × ' + bitmap.height;
    els.timingInfo.textContent = '—';
    els.bypassPill.hidden = !state.bypass;
    els.stageHint.classList.add('is-hidden');
    updateEmptyState();
    drawPreview();

    gainTable = EQ.buildGainTable(state.bands, state.mode);
    pipeline.load(padded.rgba, gainTable);
  }

  function buildPadded(bitmap, size) {
    const scale = Math.min(size / bitmap.width, size / bitmap.height);
    const width = Math.max(1, Math.min(size, Math.round(bitmap.width * scale)));
    const height = Math.max(1, Math.min(size, Math.round(bitmap.height * scale)));
    const x = Math.floor((size - width) / 2);
    const y = Math.floor((size - height) / 2);

    const scratch = document.createElement('canvas');
    scratch.width = size;
    scratch.height = size;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(bitmap, x, y, width, height);

    const content = ctx.getImageData(x, y, width, height).data;
    const rgba = new Uint8ClampedArray(size * size * 4);
    const xMap = new Int32Array(size);
    const yMap = new Int32Array(size);
    for (let i = 0; i < size; i++) {
      xMap[i] = reflect(i - x, width);
      yMap[i] = reflect(i - y, height);
    }

    // Mirror the image into the FFT's square padding so the transform does
    // not see artificial hard edges at the border.
    for (let py = 0; py < size; py++) {
      const sy = yMap[py];
      let dst = py * size * 4;
      for (let px = 0; px < size; px++) {
        const src = (sy * width + xMap[px]) * 4;
        rgba[dst] = content[src];
        rgba[dst + 1] = content[src + 1];
        rgba[dst + 2] = content[src + 2];
        rgba[dst + 3] = content[src + 3];
        dst += 4;
      }
    }

    return { rgba, crop: { x, y, w: width, h: height } };
  }

  function reflect(index, length) {
    if (length <= 1) return 0;
    const period = 2 * length - 2;
    let value = index % period;
    if (value < 0) value += period;
    return value < length ? value : period - value;
  }

  /* ---------- preview drawing ---------- */

  function resizePreview() {
    const rect = els.stage.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width));
    const height = Math.max(180, Math.round(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (
      width === state.previewW &&
      height === state.previewH &&
      els.previewCanvas.width === Math.round(width * dpr)
    ) {
      return;
    }
    state.previewW = width;
    state.previewH = height;
    els.previewCanvas.width = Math.round(width * dpr);
    els.previewCanvas.height = Math.round(height * dpr);
    els.previewCanvas.style.width = width + 'px';
    els.previewCanvas.style.height = height + 'px';
    previewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPreview();
  }

  function drawPreview() {
    const ctx = previewCtx;
    const width = state.previewW || 1;
    const height = state.previewH || 1;
    ctx.clearRect(0, 0, width, height);

    if (!state.source || !state.crop) {
      state.previewLayout = null;
      return;
    }

    const crop = state.crop;
    const sidePad = width < 620 ? 14 : 22;
    const availW = width - sidePad * 2;
    const availTop = 14;
    const availBottom = height - 28;
    const availH = availBottom - availTop;

    let scale = Math.min(availW / crop.w, availH / crop.h);
    if (state.view === '1') scale = 1;
    else if (state.view === '2') scale = 2;
    scale = Math.max(0.05, Math.min(scale, 4));

    const dw = crop.w * scale;
    const dh = crop.h * scale;
    const dx = (width - dw) / 2;
    const dy = availTop + (availH - dh) / 2;

    const radius = 4;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 14;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    roundRect(ctx, dx, dy, dw, dh, radius);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, dx, dy, dw, dh, radius);
    ctx.clip();

    // Transparency checkerboard.
    const pattern = ctx.createPattern(checkerTile, 'repeat');
    ctx.fillStyle = pattern;
    ctx.fillRect(dx, dy, dw, dh);

    const s = crop;
    if (!state.bypass && state.processedReady) {
      ctx.drawImage(
        processedCanvas,
        s.x,
        s.y,
        s.w,
        s.h,
        dx,
        dy,
        dw,
        dh
      );

      const splitX = dx + dw * state.split;
      ctx.save();
      ctx.beginPath();
      ctx.rect(dx, dy, Math.max(0, splitX - dx), dh);
      ctx.clip();
      ctx.drawImage(originalCanvas, s.x, s.y, s.w, s.h, dx, dy, dw, dh);
      ctx.restore();

      if (state.split > 0.015 && state.split < 0.985) {
        drawSplit(ctx, splitX, dy, dh);
      }

      if (dw > 280) {
        drawLabel(ctx, 'ORIGINAL', dx + 10, dy + dh - 27, 'left');
        drawLabel(ctx, 'EQUALIZED', dx + dw - 10, dy + dh - 27, 'right');
      }
      state.previewLayout = {
        dx,
        dy,
        dw,
        dh,
        splitX,
        split: state.split,
      };
    } else {
      ctx.drawImage(originalCanvas, s.x, s.y, s.w, s.h, dx, dy, dw, dh);
      state.previewLayout = null;
    }

    ctx.restore();

    ctx.save();
    roundRect(ctx, dx + 0.5, dy + 0.5, dw - 1, dh - 1, radius);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.11)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function drawSplit(ctx, x, dy, dh) {
    ctx.save();
    ctx.strokeStyle = 'rgba(240, 248, 248, 0.78)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, dy);
    ctx.lineTo(x, dy + dh);
    ctx.stroke();

    const cy = dy + dh / 2;
    ctx.beginPath();
    ctx.arc(x, cy, 12, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12, 16, 20, 0.86)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 5, cy - 3.5);
    ctx.lineTo(x - 8, cy);
    ctx.lineTo(x - 5, cy + 3.5);
    ctx.moveTo(x + 5, cy - 3.5);
    ctx.lineTo(x + 8, cy);
    ctx.lineTo(x + 5, cy + 3.5);
    ctx.stroke();
    ctx.restore();
  }

  function drawLabel(ctx, text, x, y, align) {
    ctx.save();
    ctx.font =
      '600 8.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif';
    const width = ctx.measureText(text).width + 12;
    const height = 17;
    const left = align === 'right' ? x - width : x;
    roundRect(ctx, left, y, width, height, 4);
    ctx.fillStyle = 'rgba(7, 10, 13, 0.62)';
    ctx.fill();
    ctx.fillStyle = 'rgba(214, 229, 222, 0.82)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + width / 2, y + height / 2 + 0.5);
    ctx.restore();
  }

  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  /* ---------- preview interaction ---------- */

  function wirePreview() {
    const canvas = els.previewCanvas;
    const observer = new ResizeObserver(() => resizePreview());
    observer.observe(els.stage);

    canvas.addEventListener('pointerdown', (event) => {
      if (state.bypass || !state.processedReady || !state.previewLayout) return;
      const point = localPoint(event);
      const layout = state.previewLayout;
      if (
        Math.abs(point.x - layout.splitX) <= 26 &&
        point.y >= layout.dy - 10 &&
        point.y <= layout.dy + layout.dh + 10
      ) {
        splitDrag = true;
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = 'ew-resize';
        updateSplit(point.x);
        event.preventDefault();
      }
    });

    canvas.addEventListener('pointermove', (event) => {
      if (splitDrag) {
        updateSplit(localPoint(event).x);
        event.preventDefault();
        return;
      }
      if (!state.previewLayout || state.bypass) {
        canvas.style.cursor = 'default';
        return;
      }
      const layout = state.previewLayout;
      const near =
        Math.abs(localPoint(event).x - layout.splitX) <= 26 &&
        localPoint(event).y >= layout.dy - 10 &&
        localPoint(event).y <= layout.dy + layout.dh + 10;
      canvas.style.cursor = near ? 'ew-resize' : 'default';
    });

    const end = (event) => {
      if (!splitDrag) return;
      splitDrag = false;
      canvas.style.cursor = 'default';
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  function updateSplit(x) {
    const layout = state.previewLayout;
    if (!layout) return;
    state.split = Math.max(0.02, Math.min(0.98, (x - layout.dx) / layout.dw));
    drawPreview();
  }

  function localPoint(event) {
    const rect = els.previewCanvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /* ---------- toolbar + files ---------- */

  function wireToolbar() {
    els.bypassBtn.addEventListener('click', () => setBypass(!state.bypass));
    els.presetSelect.addEventListener('change', () => {
      applyPresetByName(els.presetSelect.value);
    });
    els.baseZero.addEventListener('click', () => setBase('zero'));
    els.baseFlat.addEventListener('click', () => setBase('flat'));
    els.rangeBtn.addEventListener('click', () => {
      if (els.rangePopover.hidden) openRangePopover();
      else closeRangePopover();
    });
    els.rangeApply.addEventListener('click', () =>
      applyRange(els.rangeMin.value, els.rangeMax.value)
    );
    els.rangeFull.addEventListener('click', () => applyRange(20, 20000));
    els.rangeMin.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') applyRange(els.rangeMin.value, els.rangeMax.value);
    });
    els.rangeMax.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') applyRange(els.rangeMin.value, els.rangeMax.value);
    });
    els.viewSelect.addEventListener('change', () => {
      state.view = els.viewSelect.value;
      drawPreview();
    });
    els.openBtn.addEventListener('click', () => els.fileInput.click());
    els.emptyOpenBtn.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', () => {
      const file = els.fileInput.files && els.fileInput.files[0];
      if (file) loadFile(file);
      els.fileInput.value = '';
    });
    els.sampleBtn.addEventListener('click', () => loadSample());
    els.exportBtn.addEventListener('click', exportPng);
  }

  function wireFileDrop() {
    const hasFiles = (event) =>
      event.dataTransfer &&
      Array.from(event.dataTransfer.types || []).includes('Files');

    window.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth += 1;
      els.dropOverlay.classList.add('is-visible');
    });
    window.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', (event) => {
      if (!hasFiles(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) els.dropOverlay.classList.remove('is-visible');
    });
    window.addEventListener('drop', (event) => {
      if (!event.dataTransfer) return;
      event.preventDefault();
      dragDepth = 0;
      els.dropOverlay.classList.remove('is-visible');
      const file = Array.from(event.dataTransfer.files || []).find((item) =>
        item.type.startsWith('image/')
      );
      if (file) loadFile(file);
      else showToast('Drop an image file.', true);
    });

    window.addEventListener('paste', (event) => {
      const items = event.clipboardData && event.clipboardData.files;
      if (!items || !items.length) return;
      const file = Array.from(items).find((item) => item.type.startsWith('image/'));
      if (file) {
        event.preventDefault();
        loadFile(file);
      }
    });
  }

  function wireKeyboard() {
    window.addEventListener('keydown', (event) => {
      const tag = (event.target && event.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (event.key === 'b' || event.key === 'B') {
        setBypass(!state.bypass);
      }
    });
  }

  function showToast(message, isError) {
    els.toast.textContent = message;
    els.toast.classList.toggle('is-error', Boolean(isError));
    els.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.remove('is-visible');
    }, 3200);
  }

  /* ---------- export ---------- */

  async function exportPng() {
    if (state.exporting) return;
    if (!state.source) {
      showToast('Open an image first.', true);
      return;
    }

    state.exporting = true;
    const originalLabel = els.exportBtn.textContent;
    els.exportBtn.disabled = true;
    els.exportBtn.textContent = 'Rendering…';

    const source = state.source;
    const size = exportSize(source.width, source.height);
    try {
      const padded = buildPadded(source.bitmap, size);
      const gain = EQ.buildGainTable(state.bands, state.mode);
      const result = await ImgPipeline.renderStill({
        rgba: padded.rgba,
        size,
        gain,
        onProgress: (progress) => {
          els.exportBtn.textContent = `Rendering ${Math.round(progress * 100)}%`;
        },
      });

      const crop = padded.crop;
      const output = new ImageData(crop.w, crop.h);
      const rowBytes = crop.w * 4;
      for (let y = 0; y < crop.h; y++) {
        const start = ((crop.y + y) * size + crop.x) * 4;
        output.data.set(
          result.rgba.subarray(start, start + rowBytes),
          y * rowBytes
        );
      }

      const canvas = document.createElement('canvas');
      canvas.width = crop.w;
      canvas.height = crop.h;
      canvas.getContext('2d').putImageData(output, 0, 0);
      const blob = await canvasToBlob(canvas);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const base = (source.name || 'image').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '');
      link.download = (base || 'image') + '-eq.png';
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      showToast(
        `Saved ${crop.w} × ${crop.h} PNG · ${Math.round(result.ms)} ms`
      );
    } catch (error) {
      showToast(error.message || 'Export failed.', true);
    } finally {
      state.exporting = false;
      els.exportBtn.disabled = false;
      els.exportBtn.textContent = originalLabel;
    }
  }

  function exportSize(width, height) {
    const longest = Math.max(width || 1, height || 1);
    const power = 2 ** Math.ceil(Math.log2(longest));
    return Math.max(512, Math.min(MAX_EXPORT_SIZE, power));
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not encode PNG'));
      }, 'image/png');
    });
  }

  /* ---------- sample image ---------- */

  async function loadSample() {
    try {
      showLoading('Rendering sample…');
      if (!sampleCanvas) sampleCanvas = createSampleCanvas();
      const bitmap = await createImageBitmap(sampleCanvas);
      await setSource(bitmap, 'Sunset sample');
    } catch (error) {
      hideLoading();
      showToast(error.message || 'Could not build the sample.', true);
    }
  }

  function createSampleCanvas() {
    const W = 1800;
    const H = 1200;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const random = mulberry32(0x1a2b3c4d);
    const horizon = H * 0.61;
    const sunX = W * 0.67;
    const sunY = H * 0.545;

    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#040a14');
    sky.addColorStop(0.28, '#0a1d30');
    sky.addColorStop(0.55, '#233b50');
    sky.addColorStop(0.76, '#735452');
    sky.addColorStop(0.9, '#d68a5d');
    sky.addColorStop(1, '#f7c483');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizon);

    // Stars.
    for (let i = 0; i < 240; i++) {
      const x = random() * W;
      const y = random() * horizon * 0.68;
      const alpha = 0.15 + random() * 0.7 * (1 - y / (horizon * 0.75));
      const radius = 0.5 + random() * 1.3;
      ctx.fillStyle = `rgba(225, 240, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Thin high clouds.
    for (let i = 0; i < 7; i++) {
      const cx = random() * W;
      const cy = H * (0.18 + random() * 0.3);
      const rx = 160 + random() * 340;
      const ry = 12 + random() * 26;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
      grad.addColorStop(0, `rgba(255, 176, 133, ${0.035 + random() * 0.05})`);
      grad.addColorStop(1, 'rgba(255, 176, 133, 0)');
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Sun glow and disc.
    const glow = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 430);
    glow.addColorStop(0, 'rgba(255, 210, 150, 0.55)');
    glow.addColorStop(0.25, 'rgba(255, 173, 105, 0.28)');
    glow.addColorStop(0.62, 'rgba(255, 143, 84, 0.10)');
    glow.addColorStop(1, 'rgba(255, 143, 84, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - 460, sunY - 460, 920, 920);

    const disc = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 78);
    disc.addColorStop(0, '#fff6dd');
    disc.addColorStop(0.65, '#ffd79a');
    disc.addColorStop(1, '#ffb56e');
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 74, 0, Math.PI * 2);
    ctx.fill();

    // Birds.
    ctx.strokeStyle = 'rgba(20, 26, 34, 0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      const bx = W * (0.16 + random() * 0.28);
      const by = H * (0.2 + random() * 0.18);
      const span = 5 + random() * 7;
      ctx.beginPath();
      ctx.moveTo(bx - span, by);
      ctx.quadraticCurveTo(bx - span * 0.4, by - span * 0.5, bx, by);
      ctx.quadraticCurveTo(bx + span * 0.4, by - span * 0.5, bx + span, by);
      ctx.stroke();
    }

    // Distant ridges.
    drawRidge(ctx, W, H, horizon, 62, '#2a4052', 1.6);
    drawRidge(ctx, W, H, horizon + 4, 92, '#182a39', 4.1);
    drawRidge(ctx, W, H, horizon + 8, 128, '#0d1a25', 7.3);

    // Water.
    const water = ctx.createLinearGradient(0, horizon, 0, H);
    water.addColorStop(0, 'rgba(157, 107, 80, 0.92)');
    water.addColorStop(0.16, 'rgba(76, 66, 67, 0.95)');
    water.addColorStop(0.5, '#182a35');
    water.addColorStop(1, '#071117');
    ctx.fillStyle = water;
    ctx.fillRect(0, horizon, W, H - horizon);

    // Sun reflection.
    for (let y = horizon + 4; y < H; y += 4 + random() * 8) {
      const progress = (y - horizon) / (H - horizon);
      const spread = 24 + progress * 210;
      const width = 10 + random() * spread;
      const x = sunX + (random() - 0.5) * spread * 1.25 - width / 2;
      ctx.fillStyle = `rgba(255, 196, 132, ${(0.28 - progress * 0.2) * (0.4 + random() * 0.6)})`;
      ctx.fillRect(x, y, width, 1 + random() * 2.2);
    }

    // Ripples.
    for (let i = 0; i < 430; i++) {
      const y = horizon + 6 + random() * (H - horizon - 6);
      const progress = (y - horizon) / (H - horizon);
      const length = 12 + random() * (30 + progress * 260);
      const x = random() * (W - length);
      const nearSun = Math.abs(x + length / 2 - sunX) < 300;
      ctx.fillStyle = nearSun
        ? `rgba(255, 205, 150, ${0.03 + random() * 0.09})`
        : `rgba(126, 171, 193, ${0.02 + random() * 0.07})`;
      ctx.fillRect(x, y, length, 1 + random() * 1.6);
    }

    // Foreground banks.
    ctx.fillStyle = '#050c11';
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, H * 0.93);
    for (let x = 0; x <= W; x += 8) {
      const t = x / W;
      const y =
        H * 0.93 -
        22 * Math.sin(t * 5.4 + 2.2) -
        12 * Math.sin(t * 15.7 + 0.6) -
        (t > 0.8 ? 40 : 0);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    // Vignette.
    const vignette = ctx.createRadialGradient(
      W / 2,
      H * 0.48,
      Math.min(W, H) * 0.25,
      W / 2,
      H * 0.5,
      Math.max(W, H) * 0.72
    );
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);

    return canvas;
  }

  function drawRidge(ctx, W, H, baseY, amplitude, color, phase) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) {
      const t = x / W;
      const y =
        baseY -
        amplitude *
          (0.36 +
            0.3 * Math.sin(t * 6.2 + phase) +
            0.19 * Math.sin(t * 14.7 + phase * 1.9) +
            0.09 * Math.sin(t * 39 + phase * 3.1));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }

  function mulberry32(seed) {
    let value = seed >>> 0;
    return function () {
      value = (value + 0x6d2b79f5) >>> 0;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
})();
