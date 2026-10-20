/* ImageEQ — preview pipeline. Three FFT workers (R, G, B) run in parallel;
   the main thread only recombines their output into one RGBA buffer. */
'use strict';

(function (global) {
  const WORKER_URL = new URL('js/fft-worker.js', document.baseURI);

  function splitChannels(rgba, count) {
    const r = new Uint8ClampedArray(count);
    const g = new Uint8ClampedArray(count);
    const b = new Uint8ClampedArray(count);
    for (let i = 0, p = 0; i < count; i++, p += 4) {
      r[i] = rgba[p];
      g[i] = rgba[p + 1];
      b[i] = rgba[p + 2];
    }
    return [r, g, b];
  }

  function extractAlpha(rgba, count) {
    const alpha = new Uint8ClampedArray(count);
    for (let i = 0, p = 3; i < count; i++, p += 4) alpha[i] = rgba[p];
    return alpha;
  }

  function compose(parts, alpha, target) {
    const count = alpha.length;
    const out = target || new Uint8ClampedArray(count * 4);
    const r = parts[0];
    const g = parts[1];
    const b = parts[2];
    for (let i = 0, p = 0; i < count; i++, p += 4) {
      out[p] = r[i];
      out[p + 1] = g[i];
      out[p + 2] = b[i];
      out[p + 3] = alpha[i];
    }
    return out;
  }

  class Pipeline {
    constructor({ size = 512, onFrame, onBusy, onError } = {}) {
      this.size = size;
      this.onFrame = onFrame || function () {};
      this.onBusy = onBusy || function () {};
      this.onError = onError || function () {};
      this.workers = [0, 1, 2].map(
        () =>
          new Worker(WORKER_URL, {
            name: 'imageeq-fft-' + Math.random().toString(36).slice(2, 6),
          })
      );
      this.workers.forEach((worker, index) => {
        worker.onmessage = (event) => this.handleMessage(index, event.data);
        worker.onerror = (event) => {
          this.busy = 0;
          this.onBusy(false);
          this.onError(event.message || 'FFT worker failed');
        };
      });
      this.alpha = null;
      this.parts = new Array(3).fill(null);
      this.rgba = null;
      this.version = 0;
      this.busy = 0;
      this.pendingGain = null;
      this.loaded = false;
      this.maxForward = 0;
      this.maxRender = 0;
      this.loadedSize = 0;
      this.currentGain = null;
    }

    get isBusy() {
      return this.busy > 0;
    }

    load(rgba, gain) {
      const count = this.size * this.size;
      if (rgba.length !== count * 4) {
        throw new Error('Image buffer does not match pipeline size');
      }
      this.alpha = extractAlpha(rgba, count);
      const channels = splitChannels(rgba, count);
      this.rgba = new Uint8ClampedArray(count * 4);
      this.parts.fill(null);
      this.pendingGain = null;
      this.loaded = true;
      this.loadedSize = this.size;
      this.currentGain = gain;
      const version = ++this.version;
      this.busy = 3;
      this.onBusy(true);

      this.workers.forEach((worker, index) => {
        worker.postMessage(
          {
            type: 'load',
            size: this.size,
            channel: channels[index],
            gain,
            version,
            kind: 'preview',
          },
          [channels[index].buffer]
        );
      });
    }

    setGain(gain) {
      if (!this.loaded) return;
      this.currentGain = gain;
      this.pendingGain = gain;
      if (this.busy > 0) return;
      this.dispatchGain();
    }

    dispatchGain() {
      const gain = this.pendingGain;
      if (!gain) return;
      this.pendingGain = null;
      const version = ++this.version;
      this.parts.fill(null);
      this.busy = 3;
      this.onBusy(true);
      this.workers.forEach((worker) => {
        worker.postMessage({ type: 'gain', gain, version, kind: 'preview' });
      });
    }

    handleMessage(index, message) {
      if (!message || message.type !== 'frame') return;
      if (message.version !== this.version) return;
      if (message.size !== this.loadedSize) return;

      this.parts[index] = new Uint8ClampedArray(message.data);
      this.maxForward = Math.max(this.maxForward, message.forwardMs || 0);
      this.maxRender = Math.max(this.maxRender, message.renderMs || 0);
      this.busy -= 1;
      if (this.busy > 0) return;

      compose(this.parts, this.alpha, this.rgba);
      this.parts.fill(null);
      this.onFrame(this.rgba, {
        size: this.loadedSize,
        forwardMs: this.maxForward,
        renderMs: this.maxRender,
      });
      this.maxForward = 0;
      this.maxRender = 0;

      if (this.pendingGain) {
        this.dispatchGain();
      } else {
        this.onBusy(false);
      }
    }

    dispose() {
      this.workers.forEach((worker) => worker.terminate());
      this.workers = [];
      this.loaded = false;
    }
  }

  // One-shot high-resolution render used by the PNG export. Temporary workers
  // keep the live preview's cached spectra untouched.
  function renderStill({ rgba, size, gain, onProgress }) {
    return new Promise((resolve, reject) => {
      const count = size * size;
      const alpha = extractAlpha(rgba, count);
      const channels = splitChannels(rgba, count);
      const parts = new Array(3).fill(null);
      const workers = [];
      const started = performance.now();
      let remaining = 3;
      let completed = 0;
      let settled = false;

      function cleanup() {
        workers.forEach((worker) => worker.terminate());
        workers.length = 0;
      }

      function fail(message) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(message));
      }

      for (let index = 0; index < 3; index++) {
        const worker = new Worker(WORKER_URL);
        workers.push(worker);
        worker.onerror = (event) => fail(event.message || 'Export worker failed');
        worker.onmessage = (event) => {
          const message = event.data;
          if (!message || message.type !== 'frame' || settled) return;
          parts[index] = new Uint8ClampedArray(message.data);
          completed += 1;
          remaining -= 1;
          if (onProgress) onProgress(completed / 3);
          if (remaining > 0) return;

          settled = true;
          const output = compose(parts, alpha);
          cleanup();
          resolve({
            rgba: output,
            size,
            ms: performance.now() - started,
          });
        };
        worker.postMessage(
          {
            type: 'load',
            size,
            channel: channels[index],
            gain,
            version: 1,
            kind: 'export',
          },
          [channels[index].buffer]
        );
      }
    });
  }

  global.ImgPipeline = { Pipeline, renderStill };
})(window);
