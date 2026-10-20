/* ImageEQ — EQ model: eight logarithmic bands mapped onto 2D spatial
   frequencies. Levels are linear amplitude percentages: 100% is neutral,
   0% removes the band entirely, 150% is the maximum boost. */
'use strict';

(function (global) {
  const F_MIN = 20;
  const F_MAX = 20000;
  const LOG_SPAN = Math.log(F_MAX / F_MIN); // natural log
  const LEVEL_MAX = 150;
  const LEVEL_NEUTRAL = 100;
  const GAIN_SAMPLES = 512;

  const COLORS = [
    '#9aa7b4',
    '#e89a43',
    '#e3cf58',
    '#5ddc92',
    '#48c7d6',
    '#4f9ce8',
    '#a478ea',
    '#a8b1cc',
  ];

  const TICKS = [20, 30, 40, 50, 60, 80, 100, 200, 300, 400, 500, 800, 1000, 2000, 3000, 4000, 6000, 8000, 10000, 20000];

  const TYPES = [
    'lowshelf',
    'peaking',
    'peaking',
    'peaking',
    'peaking',
    'peaking',
    'peaking',
    'highshelf',
  ];

  const BASE_FREQS = [60, 150, 400, 1000, 2400, 5200, 10000, 16000];

  const PRESETS = [
    // Zero = base 0%: nothing reaches the output (black). Bands add up from zero.
    { name: 'Zero', base: 'zero', levels: [0, 0, 0, 0, 0, 0, 0, 0] },
    // Flat = base 100%: the original image. Bands are local deviations.
    { name: 'Flat', base: 'flat', levels: [100, 100, 100, 100, 100, 100, 100, 100] },
    {
      name: 'Clarity',
      levels: [105, 102, 96, 110, 108, 120, 140, 130],
      qs: [0.7, 0.9, 0.9, 0.9, 0.9, 0.9, 0.8, 0.7],
    },
    {
      name: 'Warm',
      levels: [130, 120, 110, 102, 98, 92, 85, 75],
      qs: [0.6, 0.7, 0.8, 0.9, 0.9, 0.8, 0.7, 0.6],
    },
    {
      name: 'Crisp',
      levels: [95, 98, 100, 105, 115, 130, 145, 135],
      qs: [0.7, 0.8, 0.9, 1, 1, 1, 0.9, 0.7],
    },
    {
      name: 'Punch',
      levels: [145, 130, 88, 85, 110, 135, 140, 120],
      qs: [0.6, 0.8, 1.2, 1.2, 1, 0.9, 0.8, 0.7],
    },
    {
      name: 'Dreamy',
      levels: [120, 130, 125, 110, 100, 85, 70, 55],
      qs: [0.5, 0.6, 0.6, 0.7, 0.8, 0.8, 0.7, 0.5],
    },
    {
      name: 'Faded',
      levels: [90, 100, 110, 110, 95, 80, 65, 55],
      qs: [0.6, 0.7, 0.8, 0.9, 0.9, 0.8, 0.7, 0.6],
    },
  ];

  function makeBands() {
    return presetBands(PRESETS[0]);
  }

  function freqToNorm(freq, range) {
    const min = range ? range.min : F_MIN;
    const max = range ? range.max : F_MAX;
    return (
      Math.log(Math.max(min, Math.min(max, freq)) / min) /
      Math.log(max / min)
    );
  }

  function normToFreq(norm, range) {
    const min = range ? range.min : F_MIN;
    const max = range ? range.max : F_MAX;
    return min * Math.pow(max / min, Math.max(0, Math.min(1, norm)));
  }

  // Tick marks that fall inside a custom display range, plus its edges.
  function ticksForRange(min, max) {
    const ticks = TICKS.filter((freq) => freq > min && freq < max);
    ticks.unshift(min);
    ticks.push(max);
    return ticks;
  }

  // Normalised band shape, 0…1. A peaking band's shape peaks at its centre.
  function bandShape(band, freq) {
    const x = Math.log2(freq / band.freq);
    if (band.type === 'lowshelf') {
      return 1 / (1 + Math.pow(2, x * 2 * band.q));
    }
    if (band.type === 'highshelf') {
      return 1 / (1 + Math.pow(2, -x * 2 * band.q));
    }
    const width = 1 / (2 * band.q);
    return 1 / (1 + Math.pow(x / width, 2));
  }

  // Base plane: 0% (Zero) or 100% (Flat). Bands are independent local
  // deviations from that plane, so a band sitting at the base is neutral and
  // cannot pull on its neighbours' bells.
  function baseFor(mode) {
    return mode === 'zero' ? 0 : LEVEL_NEUTRAL;
  }

  function curveLevel(bands, freq, mode) {
    const base = baseFor(mode);
    let level = base;
    for (let i = 0; i < bands.length; i++) {
      const band = bands[i];
      level += (band.level - base) * bandShape(band, freq);
    }
    return Math.max(0, Math.min(LEVEL_MAX, level));
  }

  function bandWeight(band, freq, mode) {
    const base = baseFor(mode);
    return Math.abs(band.level - base) * bandShape(band, freq);
  }

  function buildGainTable(bands, mode) {
    const table = new Float32Array(GAIN_SAMPLES);
    const full = { min: F_MIN, max: F_MAX };
    for (let i = 0; i < GAIN_SAMPLES; i++) {
      const norm = i / (GAIN_SAMPLES - 1);
      table[i] = curveLevel(bands, normToFreq(norm, full), mode) / 100;
    }
    return table;
  }

  function presetBands(preset) {
    return BASE_FREQS.map((freq, i) => ({
      freq,
      level: preset.levels[i],
      q: preset.qs ? preset.qs[i] : 0.8,
      type: TYPES[i],
      color: COLORS[i],
      icon: i,
    }));
  }

  function applyPreset(bands, preset) {
    for (let i = 0; i < bands.length; i++) {
      bands[i].level = preset.levels[i];
      if (preset.qs) bands[i].q = preset.qs[i];
    }
  }

  function formatHz(freq) {
    if (freq >= 1000) {
      const k = freq / 1000;
      const digits = k < 10 && !Number.isInteger(k) ? 1 : 0;
      return k.toFixed(digits) + 'k';
    }
    return Math.round(freq) + '';
  }

  function formatLevel(level) {
    return Math.round(level) + '%';
  }

  function formatQ(q) {
    return q >= 10 ? q.toFixed(0) : q.toFixed(2);
  }

  function iconPath(type) {
    if (type === 'lowshelf') {
      return 'M1.5 13h4.2c3 0 3.2-9.2 6.4-9.2h12.4';
    }
    if (type === 'highshelf') {
      return 'M1.5 3.8h12.4c3.2 0 3.4 9.2 6.4 9.2h4.2';
    }
    return 'M1.5 8h5.2c2 0 2.1-5.4 4.7-5.4S14 13.4 16.6 13.4 19 8 21.1 8h4.4';
  }

  global.EQ = {
    F_MIN,
    F_MAX,
    LEVEL_MAX,
    LEVEL_NEUTRAL,
    TICKS,
    ticksForRange,
    PRESETS,
    makeBands,
    freqToNorm,
    normToFreq,
    bandShape,
    bandWeight,
    curveLevel,
    buildGainTable,
    applyPreset,
    formatHz,
    formatLevel,
    formatQ,
    iconPath,
  };
})(window);
