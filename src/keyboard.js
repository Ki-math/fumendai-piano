/* =====================================================================
 *  PianoKeyboard — 画面下の鍵盤
 *   ・次に弾く鍵盤を手の色で表示（右手・左手）
 *   ・いま押している鍵盤を表示（電子ピアノの打鍵も反映）
 *   ・タップで入力（マルチタッチ対応）
 * ===================================================================== */
class PianoKeyboard {
  constructor(el, wrap, { onPress, onRelease }) {
    this.el = el;
    this.wrap = wrap;
    this.onPress = onPress;
    this.onRelease = onRelease;
    this.keys = new Map();
    this.labelMode = "c";                 // "none" | "c"（ドだけ）| "ja" | "en"
    this.pointers = new Map();            // pointerId → midi
    this.bindPointer();
  }

  setRange(lo, hi) {
    this.lo = lo;
    this.hi = hi;
    this.el.innerHTML = "";
    this.keys.clear();
    const whites = [];
    for (let m = lo; m <= hi; m++) if (!MusicTheory.isBlack(m)) whites.push(m);
    whites.forEach((m) => this.el.appendChild(this.makeKey(m, "key-w")));
    const w = 100 / whites.length;
    for (let m = lo; m <= hi; m++) {
      if (!MusicTheory.isBlack(m)) continue;
      const leftIndex = whites.indexOf(m - 1);
      if (leftIndex < 0) continue;
      const key = this.makeKey(m, "key-b");
      key.style.left = `calc(${(leftIndex + 1) * w}% - ${w * 0.31}%)`;
      key.style.width = `${w * 0.62}%`;
      this.el.appendChild(key);
    }
    this.el.style.minWidth = `${whites.length * 26}px`;
    this.applyLabels();
  }

  /** 楽譜の音域に合わせて、最低3オクターブの鍵盤にする */
  fitTo(lo, hi) {
    let a = Math.floor(lo / 12) * 12, b = Math.ceil((hi + 1) / 12) * 12 - 1;
    let extendDown = true;                     // 上下交互に1オクターブずつ広げる
    while (b - a + 1 < 36) {
      if (extendDown && a - 12 >= 21) a -= 12;
      else if (b + 12 <= 108) b += 12;
      else a -= 12;
      extendDown = !extendDown;
    }
    this.setRange(Math.max(21, a), Math.min(108, b));
  }

  makeKey(midi, cls) {
    const key = document.createElement("div");
    key.className = cls;
    key.dataset.midi = midi;
    if (cls === "key-w") {
      const label = document.createElement("span");
      label.className = "key-label";
      key.appendChild(label);
    }
    this.keys.set(midi, key);
    return key;
  }

  bindPointer() {
    const midiAt = (e) => { const k = e.target.closest("[data-midi]"); return k ? Number(k.dataset.midi) : null; };
    this.el.addEventListener("pointerdown", (e) => {
      const midi = midiAt(e);
      if (midi == null) return;
      e.preventDefault();
      this.pointers.set(e.pointerId, midi);
      this.onPress(midi);
    });
    const release = (e) => {
      const midi = this.pointers.get(e.pointerId);
      if (midi == null) return;
      this.pointers.delete(e.pointerId);
      this.onRelease(midi);
    };
    ["pointerup", "pointercancel", "pointerleave"].forEach((t) => this.el.addEventListener(t, release));
  }

  setLabelMode(mode) { this.labelMode = mode; this.applyLabels(); }

  applyLabels() {
    this.keys.forEach((key, midi) => {
      const label = key.querySelector(".key-label");
      if (!label) return;
      const isC = MusicTheory.pitchClass(midi) === 0;
      label.textContent =
        this.labelMode === "ja" ? MusicTheory.nameJa(midi) :
        this.labelMode === "en" ? MusicTheory.nameEn(midi) :
        this.labelMode === "c" && isC ? MusicTheory.nameEn(midi) : "";
      key.classList.toggle("middle-c", midi === 60);
    });
  }

  /** @param {Map<number,string>} targets midi → "R" | "L" */
  setTargets(targets) {
    this.keys.forEach((key, midi) => {
      const hand = targets.get(midi);
      key.classList.toggle("t-R", hand === "R");
      key.classList.toggle("t-L", hand === "L");
    });
    const first = [...targets.keys()][0];
    if (first != null) this.scrollIntoView(first);
  }

  setPressed(midi, on) {
    const key = this.keys.get(midi);
    if (key) key.classList.toggle("pressed", on);
  }

  flash(midi, kind) {
    const key = this.keys.get(midi);
    if (!key) return;
    const cls = kind === "ok" ? "hit-ok" : "hit-ng";
    key.classList.add(cls);
    setTimeout(() => key.classList.remove(cls), 280);
  }

  scrollIntoView(midi) {
    const key = this.keys.get(midi);
    if (!key || this.wrap.scrollWidth <= this.wrap.clientWidth) return;
    const left = key.offsetLeft, right = left + key.offsetWidth;
    const view0 = this.wrap.scrollLeft, view1 = view0 + this.wrap.clientWidth;
    if (left < view0 + 40 || right > view1 - 40) {
      this.wrap.scrollTo({ left: left - this.wrap.clientWidth / 2, behavior: "smooth" });
    }
  }
}
