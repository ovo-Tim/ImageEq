/* ImageEQ — GarageBand-flavoured EQ curve canvas and pointer editing. */
'use strict';

(function (global) {
  const PEAK_SAMPLES = 640;

  class CurveEditor {
    constructor(canvas, options) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.getBands = options.getBands;
      this.getSelected = options.getSelected;
      this.getMode = options.getMode || (() => 'flat');
      this.getRange =
        options.getRange || (() => ({ min: EQ.F_MIN, max: EQ.F_MAX }));
      this.onSelect = options.onSelect || function () {};
      this.onChange = options.onChange || function () {};
      this.onHover = options.onHover || function () {};
      this.isBypassed = options.isBypassed || (() => false);

      this.selected = -1;
      this.hovered = -1;
      this.drag = null;
      this.geom = null;
      this.dpr = 1;
      this.width = 0;
      this.height = 0;

      this.bind();
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas.parentElement);
      this.resize();
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => this.invalidate());
      }
    }

    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const width = Math.max(320, Math.round(rect.width));
      const height = Math.max(210, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (width === this.width && height === this.height && dpr === this.dpr) {
        return;
      }
      this.width = width;
      this.height = height;
      this.dpr = dpr;
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.canvas.style.width = width + 'px';
      this.canvas.style.height = height + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.layout();
      this.draw();
    }

    layout() {
      const width = this.width;
      const height = this.height;
      const narrow = width < 640;
      const padLeft = narrow ? 34 : 44;
      const padRight = narrow ? 16 : 52;
      const plotTop = 16;
      const plotBottom = height - 26;
      const plotLeft = padLeft;
      const plotRight = width - padRight;
      const levelScale = (plotBottom - plotTop) / EQ.LEVEL_MAX;
      const neutralY = plotBottom - EQ.LEVEL_NEUTRAL * levelScale;
      this.geom = {
        plotLeft,
        plotRight,
        plotTop,
        plotBottom,
        plotWidth: plotRight - plotLeft,
        plotHeight: plotBottom - plotTop,
        neutralY,
        levelScale,
        narrow,
      };
    }

    xOf(freq) {
      const g = this.geom;
      return g.plotLeft + EQ.freqToNorm(freq, this.getRange()) * g.plotWidth;
    }

    freqOf(x) {
      const g = this.geom;
      const norm = Math.max(0, Math.min(1, (x - g.plotLeft) / g.plotWidth));
      return EQ.normToFreq(norm, this.getRange());
    }

    yOf(level) {
      const g = this.geom;
      return g.plotBottom - level * g.levelScale;
    }

    levelOf(y) {
      const g = this.geom;
      return Math.max(
        0,
        Math.min(
          EQ.LEVEL_MAX,
          (g.plotBottom - y) / g.levelScale
        )
      );
    }

    invalidate() {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.draw();
      });
    }

    draw() {
      if (!this.geom) this.layout();
      const ctx = this.ctx;
      const g = this.geom;
      const bands = this.getBands();
      const selected = this.getSelected();
      const bypassed = this.isBypassed();

      ctx.clearRect(0, 0, this.width, this.height);

      const bg = ctx.createLinearGradient(0, 0, 0, this.height);
      bg.addColorStop(0, '#0d2130');
      bg.addColorStop(0.55, '#0b1a26');
      bg.addColorStop(1, '#08131b');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, this.width, this.height);

      const glow = ctx.createRadialGradient(
        (g.plotLeft + g.plotRight) / 2,
        g.plotTop,
        0,
        (g.plotLeft + g.plotRight) / 2,
        g.plotTop,
        g.plotWidth * 0.55
      );
      glow.addColorStop(0, 'rgba(38, 116, 140, 0.16)');
      glow.addColorStop(1, 'rgba(38, 116, 140, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, this.width, this.height);

      ctx.save();
      ctx.beginPath();
      ctx.rect(g.plotLeft, g.plotTop, g.plotWidth, g.plotHeight);
      ctx.clip();
      this.drawSelectedRegion(ctx, bands, selected);
      ctx.restore();

      this.drawGrid(ctx);
      this.drawCurve(ctx, bands, bypassed);
      this.drawNodes(ctx, bands, selected);
      this.drawSelectionHandles(ctx, bands, selected);
      this.drawAxisLabels(ctx);

      if (bypassed) {
        ctx.fillStyle = 'rgba(8, 18, 24, 0.55)';
        ctx.fillRect(g.plotLeft, g.plotTop, g.plotWidth, g.plotHeight);
        ctx.fillStyle = 'rgba(220, 232, 238, 0.66)';
        ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('EQ BYPASSED', (g.plotLeft + g.plotRight) / 2, g.plotTop + 20);
      }
    }

    drawGrid(ctx) {
      const g = this.geom;

      ctx.lineWidth = 1;
      ctx.font = '10px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      for (let level = 0; level <= EQ.LEVEL_MAX; level += 25) {
        const y = Math.round(this.yOf(level)) + 0.5;
        ctx.strokeStyle =
          level === EQ.LEVEL_NEUTRAL
            ? 'rgba(148, 183, 200, 0.36)'
            : 'rgba(112, 155, 175, 0.12)';
        ctx.beginPath();
        ctx.moveTo(g.plotLeft, y);
        ctx.lineTo(g.plotRight, y);
        ctx.stroke();

        ctx.fillStyle =
          level === EQ.LEVEL_NEUTRAL
            ? 'rgba(172, 198, 210, 0.78)'
            : 'rgba(151, 178, 192, 0.62)';
        ctx.fillText(String(level), g.plotLeft - 9, y);
        if (!g.narrow) {
          ctx.textAlign = 'left';
          ctx.fillText(String(level), g.plotRight + 9, y);
          ctx.textAlign = 'right';
        }
      }

      const range = this.getRange();
      const ticks = EQ.ticksForRange(range.min, range.max);
      const { formatHz } = EQ;
      let lastLabelEnd = -999;
      for (let i = 0; i < ticks.length; i++) {
        const freq = ticks[i];
        const x = Math.round(this.xOf(freq)) + 0.5;
        const decade = freq === 100 || freq === 1000 || freq === 10000;
        ctx.strokeStyle = decade
          ? 'rgba(130, 173, 192, 0.24)'
          : 'rgba(112, 155, 175, 0.10)';
        ctx.beginPath();
        ctx.moveTo(x, g.plotTop);
        ctx.lineTo(x, g.plotBottom);
        ctx.stroke();

        const label = formatHz(freq);
        const labelWidth = label.length * 5.5;
        if (x - labelWidth / 2 > lastLabelEnd + 8) {
          ctx.fillStyle = 'rgba(158, 186, 200, 0.72)';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(label, x, g.plotBottom + 16);
          lastLabelEnd = x + labelWidth / 2;
        }
      }
    }

    drawCurve(ctx, bands, bypassed) {
      const g = this.geom;
      const values = new Float32Array(PEAK_SAMPLES);
      const range = this.getRange();
      for (let i = 0; i < PEAK_SAMPLES; i++) {
        const freq = EQ.normToFreq(i / (PEAK_SAMPLES - 1), range);
        values[i] = EQ.curveLevel(bands, freq, this.getMode());
      }

      const points = new Array(PEAK_SAMPLES);
      for (let i = 0; i < PEAK_SAMPLES; i++) {
        const x = g.plotLeft + (i / (PEAK_SAMPLES - 1)) * g.plotWidth;
        const y = Math.max(
          g.plotTop + 1,
          Math.min(g.plotBottom - 1, this.yOf(values[i]))
        );
        points[i] = [x, y];
      }

      // Fill from the base plane to the curve. In Flat mode the base is
      // 100%, so boosts are green and cuts are grey; in Zero mode the base
      // is the bottom, so a band's contribution is always a green shape.
      const mode = this.getMode();
      const baseLevel = mode === 'zero' ? 0 : EQ.LEVEL_NEUTRAL;
      const baseY = this.yOf(baseLevel);

      ctx.save();
      ctx.beginPath();
      ctx.rect(g.plotLeft, g.plotTop, g.plotWidth, baseY - g.plotTop);
      ctx.clip();
      this.traceArea(ctx, points, baseY);
      const pos = ctx.createLinearGradient(0, g.plotTop, 0, baseY);
      pos.addColorStop(0, 'rgba(82, 232, 154, 0.26)');
      pos.addColorStop(1, 'rgba(74, 214, 139, 0.52)');
      ctx.fillStyle = pos;
      ctx.fill();
      ctx.restore();

      if (baseY < g.plotBottom - 1) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(g.plotLeft, baseY, g.plotWidth, g.plotBottom - baseY);
        ctx.clip();
        this.traceArea(ctx, points, baseY);
        const neg = ctx.createLinearGradient(0, baseY, 0, g.plotBottom);
        neg.addColorStop(0, 'rgba(121, 156, 173, 0.20)');
        neg.addColorStop(1, 'rgba(88, 121, 138, 0.08)');
        ctx.fillStyle = neg;
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(g.plotLeft, g.plotTop, g.plotWidth, g.plotHeight);
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0], points[i][1]);
      }
      ctx.strokeStyle = bypassed ? 'rgba(120, 158, 174, 0.55)' : '#54e39a';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = bypassed ? 'transparent' : 'rgba(78, 235, 155, 0.45)';
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.restore();
      ctx.shadowBlur = 0;
    }

    traceArea(ctx, points, baselineY) {
      ctx.beginPath();
      ctx.moveTo(points[0][0], baselineY);
      for (let i = 0; i < points.length; i++) {
        ctx.lineTo(points[i][0], points[i][1]);
      }
      ctx.lineTo(points[points.length - 1][0], baselineY);
      ctx.closePath();
    }

    bandSpan(band) {
      if (band.type === 'lowshelf') {
        return [EQ.F_MIN, band.freq];
      }
      if (band.type === 'highshelf') {
        return [band.freq, EQ.F_MAX];
      }
      const sigma = 1 / (2 * band.q);
      return [band.freq * Math.pow(2, -sigma), band.freq * Math.pow(2, sigma)];
    }

    drawSelectedRegion(ctx, bands, selected) {
      if (selected < 0 || !bands[selected]) return;
      const band = bands[selected];
      const g = this.geom;
      const [lo, hi] = this.bandSpan(band);
      const x0 = this.xOf(Math.max(EQ.F_MIN, lo));
      const x1 = this.xOf(Math.min(EQ.F_MAX, hi));
      const grad = ctx.createLinearGradient(0, g.plotTop, 0, g.plotBottom);
      grad.addColorStop(0, 'rgba(77, 233, 156, 0.16)');
      grad.addColorStop(0.55, 'rgba(77, 233, 156, 0.08)');
      grad.addColorStop(1, 'rgba(77, 233, 156, 0.16)');
      ctx.fillStyle = grad;
      ctx.fillRect(x0, g.plotTop, Math.max(1, x1 - x0), g.plotHeight);

      ctx.strokeStyle = 'rgba(94, 236, 165, 0.30)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x0) + 0.5, g.plotTop);
      ctx.lineTo(Math.round(x0) + 0.5, g.plotBottom);
      ctx.moveTo(Math.round(x1) + 0.5, g.plotTop);
      ctx.lineTo(Math.round(x1) + 0.5, g.plotBottom);
      ctx.stroke();
    }

    drawSelectionHandles(ctx, bands, selected) {
      if (selected < 0 || !bands[selected]) return;
      const band = bands[selected];
      if (band.type !== 'peaking') return;
      const [lo, hi] = this.bandSpan(band);
      const g = this.geom;
      const y = Math.max(
        g.plotTop + 8,
        Math.min(g.plotBottom - 8, this.yOf(band.level))
      );
      for (const [x, dir] of [
        [this.xOf(lo), -1],
        [this.xOf(hi), 1],
      ]) {
        ctx.fillStyle = 'rgba(124, 240, 181, 0.55)';
        ctx.beginPath();
        ctx.moveTo(x + dir * 5, y);
        ctx.lineTo(x - dir * 1, y - 3.5);
        ctx.lineTo(x - dir * 1, y + 3.5);
        ctx.closePath();
        ctx.fill();
      }
    }

    drawNodes(ctx, bands, selected) {
      const g = this.geom;
      for (let i = 0; i < bands.length; i++) {
        const band = bands[i];
        const x = this.xOf(band.freq);
        const y = Math.max(
          g.plotTop + 4,
          Math.min(g.plotBottom - 4, this.yOf(band.level))
        );
        const isSelected = i === selected;
        const isHovered = i === this.hovered;
        const radius = isSelected ? 6 : isHovered ? 4.6 : 3.3;

        if (isSelected) {
          ctx.save();
          ctx.shadowColor = band.color;
          ctx.shadowBlur = 14;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
          ctx.beginPath();
          ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = band.color;
        ctx.globalAlpha = isSelected || isHovered ? 1 : 0.72;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = isSelected ? 1.6 : 1;
        ctx.strokeStyle = isSelected
          ? 'rgba(255, 255, 255, 0.92)'
          : 'rgba(5, 18, 24, 0.85)';
        ctx.stroke();

        if (isSelected) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 2.5, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(84, 227, 154, 0.45)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    drawAxisLabels(ctx) {
      const g = this.geom;
      ctx.font = '9px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif';
      ctx.fillStyle = 'rgba(133, 166, 181, 0.48)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('%', 10, 3);
      if (this.width >= 640) {
        ctx.textAlign = 'right';
        ctx.fillText('Hz', this.width - 10, this.height - 12);
      }
    }

    nodeAt(x, y) {
      const bands = this.getBands();
      const selected = this.getSelected();
      let best = -1;
      let bestDistance = 13 * 13;
      for (let i = 0; i < bands.length; i++) {
        const nx = this.xOf(bands[i].freq);
        const ny = Math.max(
          this.geom.plotTop + 4,
          Math.min(this.geom.plotBottom - 4, this.yOf(bands[i].level))
        );
        const distance = (nx - x) ** 2 + (ny - y) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      if (best >= 0) return { kind: 'node', index: best };
      return null;
    }

    edgeAt(x, y) {
      const selected = this.getSelected();
      const bands = this.getBands();
      if (selected < 0 || !bands[selected]) return null;
      const band = bands[selected];
      if (band.type !== 'peaking') return null;
      if (y < this.geom.plotTop || y > this.geom.plotBottom) return null;
      const [lo, hi] = this.bandSpan(band);
      const edges = [
        { edge: -1, x: this.xOf(lo) },
        { edge: 1, x: this.xOf(hi) },
      ];
      for (const item of edges) {
        if (Math.abs(x - item.x) <= 7) {
          return { kind: 'q', index: selected, edge: item.edge };
        }
      }
      return null;
    }

    bandAt(x, y) {
      const g = this.geom;
      if (x < g.plotLeft || x > g.plotRight || y < g.plotTop || y > g.plotBottom) {
        return null;
      }
      const bands = this.getBands();
      const mode = this.getMode();
      const freq = this.freqOf(x);
      let best = -1;
      let bestWeight = 0;
      for (let i = 0; i < bands.length; i++) {
        const weight = EQ.bandWeight(bands[i], freq, mode);
        const [lo, hi] = this.bandSpan(bands[i]);
        const inSpan = freq >= lo && freq <= hi;
        if (inSpan && weight > bestWeight) {
          bestWeight = weight;
          best = i;
        }
      }
      if (best < 0) {
        let nearest = Infinity;
        for (let i = 0; i < bands.length; i++) {
          const d = Math.abs(Math.log(freq / bands[i].freq));
          if (d < nearest) {
            nearest = d;
            best = i;
          }
        }
      }
      if (best < 0) return null;
      const [lo, hi] = this.bandSpan(bands[best]);
      if (freq < lo || freq > hi) return null;

      const curveLevel = EQ.curveLevel(bands, freq, mode);
      const curveY = Math.max(
        g.plotTop,
        Math.min(g.plotBottom, this.yOf(curveLevel))
      );
      const top = Math.min(g.neutralY, curveY);
      const bottom = Math.max(g.neutralY, curveY);
      if (y >= top - 18 && y <= bottom + 18) {
        return { kind: 'band', index: best };
      }
      return null;
    }

    bind() {
      const canvas = this.canvas;

      canvas.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const point = this.localPoint(event);
        canvas.focus({ preventScroll: true });
        this.canvas.setPointerCapture(event.pointerId);
        const selected = this.getSelected();

        const edge = this.edgeAt(point.x, point.y);
        const node = edge ? null : this.nodeAt(point.x, point.y);
        const band = node || edge ? null : this.bandAt(point.x, point.y);

        if (edge) {
          this.drag = {
            kind: 'q',
            index: edge.index,
            edge: edge.edge,
            startQ: this.getBands()[edge.index].q,
            pointerId: event.pointerId,
          };
          canvas.style.cursor = 'ew-resize';
        } else if (node) {
          if (selected !== node.index) this.onSelect(node.index);
          const target = this.getBands()[node.index];
          this.drag = {
            kind: 'node',
            index: node.index,
            startFreq: target.freq,
            startLevel: target.level,
            startX: point.x,
            startY: point.y,
            pointerId: event.pointerId,
            lock: event.metaKey || event.ctrlKey ? this.axisLock(point) : null,
          };
          canvas.style.cursor = 'grabbing';
        } else if (band) {
          if (selected !== band.index) this.onSelect(band.index);
          const target = this.getBands()[band.index];
          this.drag = {
            kind: 'gain',
            index: band.index,
            startLevel: target.level,
            startY: point.y,
            pointerId: event.pointerId,
          };
          canvas.style.cursor = 'ns-resize';
        } else {
          this.drag = null;
          if (selected !== -1) this.onSelect(-1);
        }
        event.preventDefault();
      });

      canvas.addEventListener('pointermove', (event) => {
        const point = this.localPoint(event);
        if (this.drag) {
          this.applyDrag(point, event);
          event.preventDefault();
          return;
        }
        const edge = this.edgeAt(point.x, point.y);
        const node = edge ? null : this.nodeAt(point.x, point.y);
        const band = node || edge ? null : this.bandAt(point.x, point.y);
        const hover = node ? node.index : band ? band.index : -1;
        if (hover !== this.hovered) {
          this.hovered = hover;
          this.onHover(hover);
          this.invalidate();
        }
        canvas.style.cursor = edge
          ? 'ew-resize'
          : node
            ? 'grab'
            : band
              ? 'ns-resize'
              : 'crosshair';
      });

      const endDrag = (event) => {
        if (!this.drag) return;
        this.drag = null;
        canvas.style.cursor = 'crosshair';
        this.onChange(false);
        if (event && canvas.hasPointerCapture(event.pointerId)) {
          canvas.releasePointerCapture(event.pointerId);
        }
      };
      canvas.addEventListener('pointerup', endDrag);
      canvas.addEventListener('pointercancel', endDrag);

      canvas.addEventListener('pointerleave', () => {
        if (this.drag) return;
        if (this.hovered !== -1) {
          this.hovered = -1;
          this.onHover(-1);
          this.invalidate();
        }
      });

      canvas.addEventListener(
        'wheel',
        (event) => {
          const point = this.localPoint(event);
          const band = this.bandAt(point.x, point.y);
          const target = band ? band.index : this.getSelected();
          if (target < 0) return;
          if (target !== this.getSelected()) this.onSelect(target);
          const targetBand = this.getBands()[target];
          const factor = Math.exp(-event.deltaY * 0.0015);
          targetBand.q = Math.max(0.3, Math.min(10, targetBand.q * factor));
          this.onChange(true);
          this.invalidate();
          event.preventDefault();
        },
        { passive: false }
      );

      canvas.addEventListener('keydown', (event) => {
        const selected = this.getSelected();
        if (selected < 0) return;
        const band = this.getBands()[selected];
        let handled = true;
        switch (event.key) {
          case 'ArrowUp':
            band.level = Math.min(
              EQ.LEVEL_MAX,
              band.level + (event.shiftKey ? 5 : 1)
            );
            break;
          case 'ArrowDown':
            band.level = Math.max(
              0,
              band.level - (event.shiftKey ? 5 : 1)
            );
            break;
          case 'ArrowLeft':
            band.freq = Math.max(
              this.getRange().min,
              band.freq * 0.97
            );
            break;
          case 'ArrowRight':
            band.freq = Math.min(
              this.getRange().max,
              band.freq / 0.97
            );
            break;
          case 'Escape':
            this.onSelect(-1);
            break;
          default:
            handled = false;
        }
        if (handled) {
          event.preventDefault();
          this.onChange(true);
          this.invalidate();
        }
      });

      canvas.tabIndex = 0;
    }

    axisLock(point) {
      const drag = this.drag;
      if (!drag) return null;
      const dx = Math.abs(point.x - drag.startX);
      const dy = Math.abs(point.y - drag.startY);
      return dx > dy ? 'x' : 'y';
    }

    applyDrag(point, event) {
      const drag = this.drag;
      const band = this.getBands()[drag.index];
      if (!band) return;
      const g = this.geom;

      if (drag.kind === 'node') {
        let lock = event.metaKey || event.ctrlKey ? drag.lock : null;
        if (event.metaKey || event.ctrlKey) {
          drag.lock = drag.lock || this.axisLock(point);
          lock = drag.lock;
        }
        if (lock !== 'x') {
          band.level = Math.round(this.levelOf(point.y) * 10) / 10;
        }
        if (lock !== 'y') {
          const range = this.getRange();
          const freq = this.freqOf(point.x);
          band.freq = Math.max(range.min, Math.min(range.max, freq));
        }
      } else if (drag.kind === 'q') {
        const freq = this.freqOf(point.x);
        const octaves = Math.abs(Math.log2(freq / band.freq));
        const q = octaves < 0.0001 ? 10 : 1 / (2 * octaves);
        band.q = Math.max(0.3, Math.min(10, Math.round(q * 100) / 100));
      } else if (drag.kind === 'gain') {
        const level =
          drag.startLevel +
          this.levelOf(drag.startY) -
          this.levelOf(point.y);
        band.level = Math.max(0, Math.min(EQ.LEVEL_MAX, Math.round(level * 10) / 10));
      }

      this.onChange(true);
      this.invalidate();
    }

    localPoint(event) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }
  }

  global.CurveEditor = CurveEditor;
})(window);
