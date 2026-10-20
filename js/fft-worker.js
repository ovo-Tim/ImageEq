/* ImageEQ — per-channel 2D FFT worker.
   Receives one colour channel, keeps its spectrum, and re-renders the
   channel whenever the radial gain table changes. */
'use strict';

importScripts('fft.js');

let size = 0;
let count = 0;
let fft = null;
let spectrumRe = null;
let spectrumIm = null;
let workRe = null;
let workIm = null;
let radiusIndex = null;
let gainSamples = 0;
let mean = 0;
let forwardMs = 0;

self.onmessage = function (event) {
  const data = event.data;
  if (data.type === 'load') {
    load(data);
  } else if (data.type === 'gain') {
    render(data);
  }
};

function load(data) {
  const nextSize = data.size;
  const started = performance.now();

  if (nextSize !== size) {
    size = nextSize;
    count = size * size;
    fft = FFT.create(size);
    spectrumRe = new Float32Array(count);
    spectrumIm = new Float32Array(count);
    workRe = new Float32Array(count);
    workIm = new Float32Array(count);
    radiusIndex = null;
    gainSamples = 0;
  }

  const pixels = data.channel;
  if (!pixels || pixels.length !== count) {
    throw new Error('Channel data does not match FFT size');
  }

  let sum = 0;
  for (let i = 0; i < count; i++) sum += pixels[i];
  mean = sum / count;

  for (let i = 0; i < count; i++) {
    spectrumRe[i] = pixels[i] - mean;
    spectrumIm[i] = 0;
  }

  buildRadius(data.gain.length);
  fft.forward2(spectrumRe, spectrumIm);

  // Keep the exact complex spectrum and apply the (real) radial gain on
  // every render instead of baking it in.
  forwardMs = performance.now() - started;
  render({
    gain: data.gain,
    version: data.version,
    kind: data.kind,
    forwardMs,
  });
}

function buildRadius(samples) {
  if (radiusIndex && gainSamples === samples) return;
  gainSamples = samples;
  radiusIndex = new Uint16Array(count);
  const limit = samples - 1;
  for (let y = 0; y < size; y++) {
    const dy = y < size / 2 ? y : y - size;
    for (let x = 0; x < size; x++) {
      const dx = x < size / 2 ? x : x - size;
      // Normalised spatial frequency: 0 at DC, 1 at the axis Nyquist.
      let r = (2 * Math.sqrt(dx * dx + dy * dy)) / size;
      if (r > 1) r = 1;
      radiusIndex[y * size + x] = Math.round(r * limit);
    }
  }
}

function render(data) {
  const started = performance.now();
  const gain = data.gain;

  if (!spectrumRe || gain.length !== gainSamples) return;

  workRe.set(spectrumRe);
  workIm.set(spectrumIm);

  for (let i = 0; i < count; i++) {
    const m = gain[radiusIndex[i]];
    workRe[i] *= m;
    workIm[i] *= m;
  }

  fft.inverse2(workRe, workIm);

  // Mean (DC) is kept out of the forward spectrum; scale it by the
  // lowest-frequency gain so 0% yields black instead of a flat average.
  const dcGain = gain[0];
  const out = new Uint8ClampedArray(count);
  for (let i = 0; i < count; i++) out[i] = workRe[i] + mean * dcGain;

  self.postMessage(
    {
      type: 'frame',
      version: data.version,
      kind: data.kind || 'preview',
      data: out.buffer,
      size,
      forwardMs: data.forwardMs || forwardMs,
      renderMs: performance.now() - started,
    },
    [out.buffer]
  );
}
