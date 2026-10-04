/* =====================================================================
 *  Audio — 音を鳴らす（お手本・伴奏・メトロノーム）と、マイクの音程検出
 * ===================================================================== */
const AudioEngine = (() => {
  let ctx = null, master = null;

  function context() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  /** performance.now() の時刻を AudioContext の時刻に変換 */
  const audioTimeOf = (perfMs) => context().currentTime + Math.max(0, (perfMs - performance.now()) / 1000);

  /** ピアノ風の音（倍音つき三角波＋減衰） */
  function playNote(midi, when, duration, velocity = 0.7) {
    const c = context(), f = MusicTheory.midiToFreq(midi);
    const peak = 0.12 + 0.28 * velocity;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, when);
    out.gain.exponentialRampToValueAtTime(peak, when + 0.008);
    out.gain.exponentialRampToValueAtTime(peak * 0.35, when + 0.3);
    out.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.2, duration) + 0.45);
    out.connect(master);
    [[1, "triangle", 1], [2, "sine", 0.3], [3, "sine", 0.1]].forEach(([mult, type, g]) => {
      const osc = c.createOscillator(), gain = c.createGain();
      osc.type = type;
      osc.frequency.value = f * mult;
      gain.gain.value = g;
      osc.connect(gain).connect(out);
      osc.start(when);
      osc.stop(when + Math.max(0.2, duration) + 0.5);
    });
  }

  function click(when, accent = false) {
    const c = context(), osc = c.createOscillator(), gain = c.createGain();
    osc.type = "square";
    osc.frequency.value = accent ? 1760 : 1320;
    gain.gain.setValueAtTime(accent ? 0.14 : 0.09, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    osc.connect(gain).connect(master);
    osc.start(when);
    osc.stop(when + 0.06);
  }

  return { context, audioTimeOf, playNote, click };
})();

/* ---------- マイクの音程検出（NSDF / McLeod法） ---------- */
class PitchDetector {
  constructor(audioContext) {
    this.ctx = audioContext;
    this.analyser = null;
    this.buffer = null;
    this.stream = null;
  }

  static isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext !== false;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    source.connect(this.analyser);
    this.buffer = new Float32Array(this.analyser.fftSize);
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.analyser = null;
  }

  read() {
    if (!this.analyser) return { rms: 0, freq: null, clarity: 0 };
    this.analyser.getFloatTimeDomainData(this.buffer);
    let s = 0;
    for (let i = 0; i < this.buffer.length; i++) s += this.buffer[i] * this.buffer[i];
    const rms = Math.sqrt(s / this.buffer.length);
    if (rms < 0.003) return { rms, freq: null, clarity: 0 };
    const est = PitchDetector.nsdfPitch(this.buffer, this.ctx.sampleRate);
    return { rms, freq: est ? est.freq : null, clarity: est ? est.clarity : 0 };
  }

  static nsdfPitch(buf, sampleRate, fMin = 95, fMax = 1400) {
    const n = buf.length;
    const minLag = Math.floor(sampleRate / fMax);
    const maxLag = Math.min(Math.floor(sampleRate / fMin), (n >> 1) - 1);
    const win = n - maxLag;
    const nsdf = new Float32Array(maxLag + 2);
    for (let tau = minLag; tau <= maxLag + 1; tau++) {
      let acf = 0, energy = 0;
      for (let i = 0; i < win; i++) {
        const a = buf[i], b = buf[i + tau];
        acf += a * b;
        energy += a * a + b * b;
      }
      nsdf[tau] = energy > 0 ? (2 * acf) / energy : 0;
    }
    const peaks = [];
    let started = false, inPositive = false, bestVal = -1, bestIdx = -1;
    for (let tau = minLag; tau <= maxLag; tau++) {
      const v = nsdf[tau];
      if (!started) { if (v <= 0) started = true; continue; }
      if (v > 0) {
        if (!inPositive) { inPositive = true; bestVal = -1; }
        if (v > bestVal) { bestVal = v; bestIdx = tau; }
      } else if (inPositive) { inPositive = false; peaks.push(bestIdx); }
    }
    if (inPositive) peaks.push(bestIdx);
    if (peaks.length === 0) return null;
    const globalMax = Math.max(...peaks.map((t) => nsdf[t]));
    const tau = peaks.find((t) => nsdf[t] >= 0.88 * globalMax);
    const a = nsdf[tau - 1], b = nsdf[tau], c = nsdf[tau + 1];
    const denom = a - 2 * b + c;
    const shift = denom !== 0 ? (a - c) / (2 * denom) : 0;
    return { freq: sampleRate / (tau + shift), clarity: b };
  }
}

/** 推定ピッチを「打鍵」「離鍵」のイベントに変換する */
class NoteListener {
  static SENSITIVITY = { low: 0.03, mid: 0.012, high: 0.005 };

  constructor(detector) {
    this.detector = detector;
    this.threshold = NoteListener.SENSITIVITY.mid;
    this.onNote = () => {};
    this.onRelease = () => {};
    this.onFrame = () => {};
    this.running = false;
    this.reset();
  }

  reset() {
    this.candidate = null;
    this.count = 0;
    this.lastEmitted = null;
    this.armed = true;
    this.floorRms = Infinity;
    this.quietFrames = 0;
  }

  setSensitivity(key) { this.threshold = NoteListener.SENSITIVITY[key] ?? NoteListener.SENSITIVITY.mid; }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => { if (!this.running) return; this.tick(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }

  tick() {
    const r = this.detector.read();
    this.onFrame(r);
    const loud = r.rms >= this.threshold && r.freq && r.clarity > 0.75;
    if (!loud) {
      this.quietFrames++;
      this.candidate = null;
      this.count = 0;
      if (this.quietFrames === 3 && this.lastEmitted != null) { this.onRelease(this.lastEmitted); }
      if (this.quietFrames >= 3) this.armed = true;
      this.floorRms = Math.min(this.floorRms, r.rms);
      return;
    }
    this.quietFrames = 0;
    if (!this.armed && r.rms > this.floorRms * 1.8 && r.rms - this.floorRms > this.threshold * 0.5) {
      this.armed = true;
      this.count = 0;
    }
    this.floorRms = Math.min(this.floorRms, r.rms);
    const midiFloat = MusicTheory.freqToMidi(r.freq);
    const midi = Math.round(midiFloat);
    if (Math.abs(midiFloat - midi) > 0.4) return;
    if (midi === this.candidate) this.count++;
    else { this.candidate = midi; this.count = 1; }
    const needed = this.armed ? 3 : midi !== this.lastEmitted ? 7 : Infinity;
    if (this.count >= needed) {
      if (this.lastEmitted != null && this.lastEmitted !== midi) this.onRelease(this.lastEmitted);
      this.lastEmitted = midi;
      this.armed = false;
      this.floorRms = r.rms;
      this.count = -Infinity;
      this.onNote(midi);
    }
  }
}
