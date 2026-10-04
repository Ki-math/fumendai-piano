/* =====================================================================
 *  InputHub — 電子ピアノ（MIDI）・マイク・画面の鍵盤からの入力を1つにまとめる
 *
 *  購読側は { noteOn(midi, velocity, source), noteOff(midi, source) } を渡す。
 *  source は "midi" | "mic" | "tap"。
 * ===================================================================== */
class InputHub {
  constructor() {
    this.subscribers = new Set();
    this.held = new Map();                  // 押している鍵盤 midi → source
    this.lastActivity = 0;
    this.onStatus = () => {};
    this.midi = { supported: typeof navigator.requestMIDIAccess === "function", access: null, devices: [], error: null };
    this.mic = { detector: null, listener: null, on: false, error: null, sensitivity: "mid" };
  }

  subscribe(handler) {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  noteOn(midi, velocity, source) {
    this.held.set(midi, source);
    this.lastActivity = performance.now();
    this.subscribers.forEach((h) => h.noteOn && h.noteOn(midi, velocity, source));
  }

  noteOff(midi, source) {
    if (!this.held.has(midi)) return;
    this.held.delete(midi);
    this.subscribers.forEach((h) => h.noteOff && h.noteOff(midi, source));
  }

  /** いま主に使っている入力 */
  get activeSource() {
    if (this.midi.devices.length) return "midi";
    if (this.mic.on) return "mic";
    return "tap";
  }

  /* ---------- MIDI ---------- */
  async connectMidi() {
    if (!this.midi.supported) {
      this.midi.error = "unsupported";
      this.onStatus();
      return false;
    }
    try {
      this.midi.access = await navigator.requestMIDIAccess({ sysex: false });
      this.midi.access.onstatechange = () => this.bindMidiInputs();
      this.midi.error = null;
      this.bindMidiInputs();
      return true;
    } catch (err) {
      this.midi.error = "denied";
      this.onStatus();
      return false;
    }
  }

  bindMidiInputs() {
    const names = [];
    this.midi.access.inputs.forEach((input) => {
      if (input.state === "disconnected") return;
      input.onmidimessage = (e) => this.handleMidiMessage(e.data);
      names.push(input.name || "MIDI機器");
    });
    this.midi.devices = names;
    this.onStatus();
  }

  handleMidiMessage(data) {
    const [status, d1, d2] = data;
    const type = status & 0xf0;
    if (type === 0x90 && d2 > 0) this.noteOn(d1, d2 / 127, "midi");
    else if (type === 0x80 || (type === 0x90 && d2 === 0)) this.noteOff(d1, "midi");
  }

  /* ---------- マイク ---------- */
  async startMic() {
    if (!PitchDetector.isSupported()) { this.mic.error = "unsupported"; this.onStatus(); return false; }
    try {
      const detector = new PitchDetector(AudioEngine.context());
      await detector.start();
      const listener = new NoteListener(detector);
      listener.setSensitivity(this.mic.sensitivity);
      listener.onNote = (midi) => this.noteOn(midi, 0.7, "mic");
      listener.onRelease = (midi) => this.noteOff(midi, "mic");
      listener.start();
      Object.assign(this.mic, { detector, listener, on: true, error: null });
      this.onStatus();
      return true;
    } catch (err) {
      this.mic.error = err && err.name === "NotAllowedError" ? "denied" : "unsupported";
      this.onStatus();
      return false;
    }
  }

  stopMic() {
    if (this.mic.listener) this.mic.listener.stop();
    if (this.mic.detector) this.mic.detector.stop();
    Object.assign(this.mic, { detector: null, listener: null, on: false });
    this.onStatus();
  }

  setMicSensitivity(key) {
    this.mic.sensitivity = key;
    if (this.mic.listener) this.mic.listener.setSensitivity(key);
  }
}
