/* ImageEQ — minimal radix-2 complex FFT (1D + 2D).
   Loads as a classic script in the page and inside the worker. */
(function (global) {
  'use strict';

  function create(n) {
    if (n < 2 || (n & (n - 1)) !== 0) {
      throw new Error('FFT size must be a power of two');
    }

    const levels = Math.log2(n) | 0;
    const half = n >> 1;
    const cosTable = new Float64Array(half);
    const sinTable = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      const angle = (-2 * Math.PI * i) / n;
      cosTable[i] = Math.cos(angle);
      sinTable[i] = Math.sin(angle);
    }

    const reverse = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let value = i;
      let mirrored = 0;
      for (let bit = 0; bit < levels; bit++) {
        mirrored = (mirrored << 1) | (value & 1);
        value >>>= 1;
      }
      reverse[i] = mirrored;
    }

    // sign = 1 forward, -1 inverse (no scaling here)
    function transform(re, im, offset, stride, sign) {
      for (let i = 0; i < n; i++) {
        const j = reverse[i];
        if (j > i) {
          const a = offset + i * stride;
          const b = offset + j * stride;
          let t = re[a];
          re[a] = re[b];
          re[b] = t;
          t = im[a];
          im[a] = im[b];
          im[b] = t;
        }
      }

      for (let size = 2; size <= n; size <<= 1) {
        const sizeHalf = size >>> 1;
        const step = n / size;
        for (let start = 0; start < n; start += size) {
          for (let j = 0, k = 0; j < sizeHalf; j++, k += step) {
            const a = offset + (start + j) * stride;
            const b = a + sizeHalf * stride;
            const wr = cosTable[k];
            const wi = sign * sinTable[k];
            const br = re[b];
            const bi = im[b];
            const tr = br * wr - bi * wi;
            const ti = br * wi + bi * wr;
            re[b] = re[a] - tr;
            im[b] = im[a] - ti;
            re[a] += tr;
            im[a] += ti;
          }
        }
      }
    }

    return {
      n,
      forward1(re, im, offset, stride) {
        transform(re, im, offset, stride, 1);
      },
      inverse1(re, im, offset, stride) {
        transform(re, im, offset, stride, -1);
      },
      forward2(re, im) {
        for (let y = 0; y < n; y++) transform(re, im, y * n, 1, 1);
        for (let x = 0; x < n; x++) transform(re, im, x, n, 1);
      },
      inverse2(re, im) {
        for (let y = 0; y < n; y++) transform(re, im, y * n, 1, -1);
        for (let x = 0; x < n; x++) transform(re, im, x, n, -1);
        const scale = 1 / (n * n);
        for (let i = 0; i < re.length; i++) {
          re[i] *= scale;
          im[i] *= scale;
        }
      },
    };
  }

  global.FFT = { create };
})(typeof self !== 'undefined' ? self : this);
