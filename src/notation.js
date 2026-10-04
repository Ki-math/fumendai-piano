/* =====================================================================
 *  ScoreView — 大譜表（ト音記号＋ヘ音記号）の組版とSVG描画
 *
 *  使い方:
 *    const view = new ScoreView(scrollEl, svgEl);
 *    view.setScore(score);            // 組版して描画
 *    view.setCursorTime(t);           // カーソル移動（段が変わると自動でスクロール）
 *    view.setNoteState(id, "ok");     // 音符の色（cur / ok / miss / null）
 *    view.setLoop({from, to});        // 部分リピートの範囲表示
 *    view.onMeasureTap = (i) => …;    // 小節タップ
 * ===================================================================== */
class ScoreView {
  static EPS = 1e-4;
  static BOTTOM_STEP = { R: 30 /* E4 */, L: 18 /* G2 */ };
  static KEYSIG_STEPS = {
    sharp: { R: ["F5","C5","G5","D5","A4","E5","B4"], L: ["F3","C3","G3","D3","A2","E3","B2"] },
    flat:  { R: ["B4","E5","A4","D5","G4","C5","F4"], L: ["B2","E3","A2","D3","G2","C3","F2"] },
  };
  static DUR_GLYPHS = [[4,"w",0],[3,"h",1],[2,"h",0],[1.5,"q",1],[1,"q",0],[0.75,"e",1],[0.5,"e",0],[0.375,"s",1],[0.25,"s",0],[0.125,"t",0]];
  static REST_VALUES = [4, 2, 1, 0.5, 0.25, 0.125];
  static REST_GLYPH = { q: "\u{1D13D}", e: "\u{1D13E}", s: "\u{1D13F}", t: "\u{1D140}" };

  constructor(scrollEl, svgEl) {
    this.scrollEl = scrollEl;
    this.svg = svgEl;
    this.opts = { zoom: 1, names: "none", colorize: false, fingering: true };
    this.score = null;
    this.layout = null;
    this.loop = null;
    this.pendingLoopStart = null;
    this.noteEls = new Map();
    this.noteStates = new Map();
    this.cursorTime = null;
    this.currentSystem = -1;
    this.onMeasureTap = null;
    this.svg.addEventListener("click", (e) => {
      const hit = e.target.closest("[data-measure]");
      if (hit && this.onMeasureTap) this.onMeasureTap(Number(hit.dataset.measure));
    });
  }

  get LS() { return 8 * this.opts.zoom; }           // 五線の線と線の間隔（px）

  /* ---------- 公開メソッド ---------- */
  setScore(score) {
    this.score = score;
    this.loop = null;
    this.pendingLoopStart = null;
    this.noteStates.clear();
    this.cursorTime = null;
    this.refresh();
  }

  setOptions(options) {
    Object.assign(this.opts, options);
    if (this.score) this.refresh();
  }

  /** 画面幅が変わったときなどに組み直す（音符の状態とカーソルは保つ） */
  refresh() {
    if (!this.score) return;
    this.layout = this.computeLayout();
    this.render();
    this.currentSystem = -1;
    this.noteStates.forEach((state, id) => this.applyNoteState(id, state));
    if (this.cursorTime != null) this.setCursorTime(this.cursorTime, false);
  }

  setNoteState(id, state) {
    if (state) this.noteStates.set(id, state); else this.noteStates.delete(id);
    this.applyNoteState(id, state);
  }

  clearNoteStates() {
    this.noteStates.forEach((_, id) => this.applyNoteState(id, null));
    this.noteStates.clear();
  }

  /** 練習しない手の音符をうすく表示 */
  setDimHand(hand) {
    this.svg.classList.toggle("dim-R", hand === "R");
    this.svg.classList.toggle("dim-L", hand === "L");
  }

  setLoop(loop, pendingStart = null) {
    this.loop = loop;
    this.pendingLoopStart = pendingStart;
    this.renderLoopLayer();
  }

  setCursorTime(t, smooth = true) {
    this.cursorTime = t;
    const cursor = this.svg.querySelector("#sv-cursor");
    const pos = t == null ? null : this.positionOf(t);
    if (!cursor) return;
    if (!pos) { cursor.setAttribute("visibility", "hidden"); return; }
    const L = this.LS, s = pos.sys;
    cursor.setAttribute("visibility", "visible");
    cursor.setAttribute("x", pos.x - L * 1.1);
    cursor.setAttribute("y", s.trebleTop - L * 3);
    cursor.setAttribute("width", L * 2.2);
    cursor.setAttribute("height", s.bassTop + L * 7 - s.trebleTop);
    if (s.index !== this.currentSystem) {
      this.currentSystem = s.index;
      this.scrollEl.scrollTo({ top: Math.max(0, s.y - L), behavior: smooth ? "smooth" : "auto" });
    }
  }

  scrollToMeasure(index) {
    const sys = this.layout && this.layout.measureSys[index];
    if (sys) { this.currentSystem = sys.index; this.scrollEl.scrollTo({ top: Math.max(0, sys.y - this.LS), behavior: "smooth" }); }
  }

  /* ---------- 組版 ---------- */
  computeLayout() {
    const L = this.LS, score = this.score;
    const width = Math.max(320, this.scrollEl.clientWidth - 2);
    const margin = L * 3.2;
    const keyW = Math.abs(score.keyFifths || 0) * L * 1.1;
    const headerW = L * 4.6 + keyW + L * 1.2;
    const timeW = L * 3.2;
    const beatW = L * 4.6, minGap = L * 3.3, accW = L * 1.5, pad = L * 1.8;
    this.handsInScore = ScoreModel.handsPresent(score);

    // 各小節の中身と、詰めずに並べたときの幅
    const contents = score.measures.map((_, i) => this.measureContent(i));
    contents.forEach((mc) => {
      let x = pad;
      mc.localXs = mc.times.map((t, k) => {
        if (k > 0) x += Math.max(minGap, (t - mc.times[k - 1]) * beatW);
        if (mc.accTimes.has(this.key(t))) x += accW;
        return x;
      });
      const lastT = mc.times.length ? mc.times[mc.times.length - 1] : mc.start;
      mc.natural = (mc.localXs.length ? x : pad) + Math.max(minGap, (mc.end - lastT) * beatW);
    });

    // 段に詰める
    const rows = [];
    let row = [], rowW = 0;
    contents.forEach((mc) => {
      const limit = width - margin * 2 - headerW - (rows.length === 0 ? timeW : 0);
      if (row.length && rowW + mc.natural > limit) { rows.push(row); row = []; rowW = 0; }
      row.push(mc);
      rowW += mc.natural;
    });
    if (row.length) rows.push(row);

    // 段ごとに幅をそろえ（両端揃え）、縦位置を決める
    const topPad = L * 7, staffGap = L * 7.5, bottomPad = L * 6.5;
    const sysH = topPad + L * 4 + staffGap + L * 4 + bottomPad;
    let y = L;
    const systems = rows.map((r, si) => {
      const x0 = margin + headerW + (si === 0 ? timeW : 0);
      const limit = width - margin - x0;
      const natural = r.reduce((s, m) => s + m.natural, 0);
      const isLast = si === rows.length - 1;
      const scale = !isLast || natural > limit * 0.7 ? limit / natural : 1;
      let x = x0;
      const measures = r.map((mc) => {
        const m = { ...mc, x, w: mc.natural * scale, xs: mc.localXs.map((v) => x + v * scale) };
        x += m.w;
        return m;
      });
      const sys = { index: si, y, trebleTop: y + topPad, bassTop: y + topPad + L * 4 + staffGap, height: sysH, x0, xEnd: x, measures };
      y += sysH;
      return sys;
    });
    const measureSys = [];
    systems.forEach((s) => s.measures.forEach((m) => (measureSys[m.index] = s)));
    return { width, height: y + L, margin, headerW, timeW, systems, measureSys };
  }

  key(t) { return Math.round(t * 1000); }

  /** 1小節ぶんの和音・休符・臨時記号を整理する */
  measureContent(index) {
    const score = this.score, m = score.measures[index];
    const start = m.start, end = m.start + m.len, EPS = ScoreView.EPS;
    // 和音ごとにまとめる。小節線をまたぐ長い音は、この小節に入る部分だけを描き、タイでつなぐ
    const chords = [];
    for (const hand of ["R", "L"]) {
      const groups = new Map();
      score.notes.forEach((n) => {
        if (n.hand !== hand) return;
        const nEnd = n.start + n.dur;
        let time, tieIn = false;
        if (n.measure === index) time = n.start;
        else if (n.start < start - EPS && nEnd > start + EPS) { time = start; tieIn = true; }
        else return;
        const dur = Math.min(nEnd, end) - time;
        const item = { n, dur, tieIn, tieOut: time + dur < nEnd - EPS, acc: null };
        const k = this.key(time);
        if (!groups.has(k)) groups.set(k, { hand, time, items: [] });
        groups.get(k).items.push(item);
      });
      chords.push(...[...groups.values()].sort((a, b) => a.time - b.time));
    }

    // 臨時記号：小節内で、調号や直前の音と違うときだけ表示（タイで続く音には付けない）
    const keyAlters = MusicTheory.keyAlters(score.keyFifths || 0);
    for (const hand of ["R", "L"]) {
      const state = {};
      chords.filter((c) => c.hand === hand).forEach((c) => c.items.forEach((it) => {
        const n = it.n, slot = n.step + n.octave;
        const current = slot in state ? state[slot] : keyAlters[n.step] || 0;
        it.acc = !it.tieIn && n.alter !== current ? n.alter : null;
        state[slot] = n.alter;
      }));
    }

    // 休符：手ごとに、音のない区間を埋める
    const rests = [];
    this.handsInScore.forEach((hand) => {
      const hs = chords.filter((c) => c.hand === hand);
      if (hs.length === 0) { rests.push({ hand, time: start, dur: m.len, whole: true }); return; }
      let cur = start;
      hs.forEach((c) => {
        if (c.time > cur + EPS) rests.push(...this.splitRest(cur, c.time - cur, hand));
        cur = Math.max(cur, c.time + Math.max(...c.items.map((it) => it.dur)));
      });
      if (cur < end - EPS) rests.push(...this.splitRest(cur, end - cur, hand));
    });

    const timeSet = new Map();
    chords.forEach((c) => timeSet.set(this.key(c.time), c.time));
    rests.forEach((r) => { if (!r.whole) timeSet.set(this.key(r.time), r.time); });
    if (timeSet.size === 0) timeSet.set(this.key(start), start);
    const times = [...timeSet.values()].sort((a, b) => a - b);
    const accTimes = new Set(chords.filter((c) => c.items.some((it) => it.acc != null)).map((c) => this.key(c.time)));
    return { index, start, end, len: m.len, chords, rests, times, accTimes };
  }

  splitRest(t, d, hand) {
    const out = [];
    while (d > ScoreView.EPS) {
      const v = ScoreView.REST_VALUES.find((r) => r <= d + ScoreView.EPS);
      if (!v) break;
      out.push({ hand, time: t, dur: v });
      t += v;
      d -= v;
    }
    return out;
  }

  static durGlyph(dur) {
    if (dur >= 4) return { kind: "w", dots: 0 };
    let best = ScoreView.DUR_GLYPHS[0], bestErr = Infinity;
    ScoreView.DUR_GLYPHS.forEach((g) => { const e = Math.abs(Math.log(dur / g[0])); if (e < bestErr) { bestErr = e; best = g; } });
    return { kind: best[1], dots: best[2] };
  }

  timeX(mc, t) {
    const T = [...mc.times, mc.end], X = [...mc.xs, mc.x + mc.w];
    if (t <= T[0]) return X[0];
    for (let k = 0; k < T.length - 1; k++) {
      if (t <= T[k + 1]) return X[k] + ((X[k + 1] - X[k]) * (t - T[k])) / (T[k + 1] - T[k] || 1);
    }
    return X[X.length - 1];
  }

  positionOf(t) {
    if (!this.layout) return null;
    const mi = ScoreModel.measureIndexAt(this.score.measures, t);
    const sys = this.layout.measureSys[mi];
    if (!sys) return null;
    const mc = sys.measures.find((m) => m.index === mi);
    return { sys, x: this.timeX(mc, t) };
  }

  /* ---------- 描画 ---------- */
  render() {
    const { width, height } = this.layout;
    const parts = ['<g id="sv-loop"></g>', '<g class="sv-systems">'];
    this.layout.systems.forEach((sys) => this.drawSystem(parts, sys));
    parts.push("</g>", '<rect id="sv-cursor" class="sv-cursor" visibility="hidden" rx="4"/>');
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.svg.style.height = `${height}px`;
    this.svg.classList.toggle("colorize", !!this.opts.colorize);
    this.svg.innerHTML = parts.join("");
    this.noteEls.clear();
    this.svg.querySelectorAll(".note").forEach((el) => {
      const id = Number(el.dataset.id);
      if (!this.noteEls.has(id)) this.noteEls.set(id, []);
      this.noteEls.get(id).push(el);
    });
    this.renderLoopLayer();
  }

  staffY(sys, hand) { return hand === "R" ? sys.trebleTop : sys.bassTop; }

  stepY(sys, hand, step) {
    const L = this.LS;
    return this.staffY(sys, hand) + L * 4 - (step - ScoreView.BOTTOM_STEP[hand]) * (L / 2);
  }

  drawSystem(p, sys) {
    const L = this.LS, { margin, headerW } = this.layout, score = this.score;
    const top = sys.trebleTop, bottom = sys.bassTop + L * 4;

    // 五線
    for (const hand of ["R", "L"]) {
      const st = this.staffY(sys, hand);
      for (let i = 0; i < 5; i++) p.push(`<line class="staff-line" x1="${margin}" x2="${sys.xEnd}" y1="${st + i * L}" y2="${st + i * L}"/>`);
    }
    // 括弧と左端の縦線
    const bx = margin - L * 0.5, mid = (top + bottom) / 2, bw = L * 1.3;
    p.push(`<path class="brace" d="M${bx} ${top} Q${bx - bw} ${top + (mid - top) * 0.3} ${bx - bw * 0.45} ${(top + mid) / 2} Q${bx - bw * 0.05} ${mid - (mid - top) * 0.2} ${bx - bw} ${mid} Q${bx - bw * 0.05} ${mid + (bottom - mid) * 0.2} ${bx - bw * 0.45} ${(mid + bottom) / 2} Q${bx - bw} ${bottom - (bottom - mid) * 0.3} ${bx} ${bottom}"/>`);
    p.push(`<line class="bar" x1="${margin}" x2="${margin}" y1="${top}" y2="${bottom}"/>`);

    // 音部記号
    p.push(`<text class="clef" x="${margin + L * 0.5}" y="${sys.trebleTop + L * 4}" font-size="${L * 4.7}">\u{1D11E}</text>`);
    p.push(`<text class="clef" x="${margin + L * 0.5}" y="${sys.bassTop + L * 2.14}" font-size="${L * 4.14}">\u{1D122}</text>`);

    // 調号
    const fifths = score.keyFifths || 0;
    if (fifths !== 0) {
      const kind = fifths > 0 ? "sharp" : "flat";
      for (const hand of ["R", "L"]) {
        ScoreView.KEYSIG_STEPS[kind][hand].slice(0, Math.abs(fifths)).forEach((name, k) => {
          const { step, octave } = MusicTheory.parseName(name);
          const y = this.stepY(sys, hand, MusicTheory.diatonicIndex(step, octave));
          p.push(`<text class="acc" x="${margin + L * 4.6 + k * L * 1.1}" y="${y + L * (fifths > 0 ? 0.8 : 0.5)}" font-size="${L * 2.4}">${fifths > 0 ? "♯" : "♭"}</text>`);
        });
      }
    }

    // 拍子（最初の段だけ）
    if (sys.index === 0) {
      const tx = margin + headerW + L * 1.3;
      for (const hand of ["R", "L"]) {
        const st = this.staffY(sys, hand);
        p.push(`<text class="timesig" x="${tx}" y="${st + L * 1.95}" font-size="${L * 2.9}" text-anchor="middle">${score.timeSig.beats}</text>`);
        p.push(`<text class="timesig" x="${tx}" y="${st + L * 3.95}" font-size="${L * 2.9}" text-anchor="middle">${score.timeSig.beatType}</text>`);
      }
    }

    // 段の最初の小節番号
    p.push(`<text class="mnum" x="${margin}" y="${top - L * 2.2}" font-size="${L * 1.35}">${sys.measures[0].index + 1}</text>`);

    sys.measures.forEach((mc) => {
      mc.rests.forEach((r) => this.drawRest(p, sys, mc, r));
      mc.chords.forEach((c) => this.drawChord(p, sys, mc, c));
      const xEnd = mc.x + mc.w;
      if (mc.index === score.measures.length - 1) {
        p.push(`<line class="bar" x1="${xEnd - L * 0.75}" x2="${xEnd - L * 0.75}" y1="${top}" y2="${bottom}"/>`);
        p.push(`<rect class="bar-thick" x="${xEnd - L * 0.4}" y="${top}" width="${L * 0.4}" height="${bottom - top}"/>`);
      } else {
        p.push(`<line class="bar" x1="${xEnd}" x2="${xEnd}" y1="${top}" y2="${bottom}"/>`);
      }
      p.push(`<rect class="mhit" data-measure="${mc.index}" x="${mc.x}" y="${top - L * 3}" width="${mc.w}" height="${bottom - top + L * 6}"/>`);
    });
  }

  drawChord(p, sys, mc, chord) {
    const L = this.LS, hand = chord.hand, bottomStep = ScoreView.BOTTOM_STEP[hand];
    const x = this.timeX(mc, chord.time);
    const items = [...chord.items].sort((a, b) => this.stepOf(a.n) - this.stepOf(b.n));
    const notes = items.map((it) => it.n);
    const steps = notes.map((n) => this.stepOf(n));
    const glyph = ScoreView.durGlyph(Math.max(...items.map((it) => it.dur)));
    const up = (steps[0] + steps[steps.length - 1]) / 2 < bottomStep + 4;
    const rx = glyph.kind === "w" ? L * 0.75 : L * 0.62, ry = L * 0.46;
    const y = (s) => this.stepY(sys, hand, s);

    // 2度の音は符頭を左右にずらす
    const offsets = steps.map(() => 0);
    if (up) {
      for (let i = 1; i < steps.length; i++) if (steps[i] - steps[i - 1] === 1 && offsets[i - 1] === 0) offsets[i] = rx * 1.9;
    } else {
      for (let i = steps.length - 2; i >= 0; i--) if (steps[i + 1] - steps[i] === 1 && offsets[i + 1] === 0) offsets[i] = -rx * 1.9;
    }

    // 加線
    const ledgers = new Set();
    steps.forEach((s, i) => {
      for (let k = bottomStep - 2; k >= s; k -= 2) ledgers.add(`${k}|${offsets[i]}`);
      for (let k = bottomStep + 10; k <= s; k += 2) ledgers.add(`${k}|${offsets[i]}`);
    });
    ledgers.forEach((v) => {
      const [k, off] = v.split("|").map(Number);
      p.push(`<line class="ledger" x1="${x + off - rx * 1.6}" x2="${x + off + rx * 1.6}" y1="${y(k)}" y2="${y(k)}"/>`);
    });

    // 符頭・臨時記号・付点・音名
    let accCol = 0, lastAccStep = null;
    for (let i = notes.length - 1; i >= 0; i--) {
      const it = items[i], n = it.n, s = steps[i], hx = x + offsets[i], hy = y(s);
      const color = MusicTheory.colorVar(n.midi) || "--muted";
      const parts = [];
      const hollow = glyph.kind === "w" || glyph.kind === "h";
      const rot = glyph.kind === "w" ? "" : ` transform="rotate(-20 ${hx} ${hy})"`;
      parts.push(`<ellipse class="head${hollow ? " hollow" : ""}" cx="${hx}" cy="${hy}" rx="${rx}" ry="${ry}"${rot}/>`);
      if (it.acc != null) {
        accCol = lastAccStep != null && lastAccStep - s < 6 ? accCol + 1 : 0;
        lastAccStep = s;
        const ax = Math.min(x, hx) - rx - L * 1.25 - accCol * L * 1.2;
        const text = it.acc === 0 ? "♮" : MusicTheory.accText(it.acc);
        parts.push(`<text class="acc" x="${ax}" y="${hy + L * 0.75}" font-size="${L * 2.3}" text-anchor="middle">${text}</text>`);
      }
      const onLine = (s - bottomStep) % 2 === 0;
      for (let d = 0; d < glyph.dots; d++) {
        parts.push(`<circle class="dot" cx="${x + Math.max(0, offsets[i]) + rx + L * 0.55 + d * L * 0.5}" cy="${onLine ? hy - L / 2 : hy}" r="${L * 0.19}"/>`);
      }
      // タイ（符幹と反対側に弧を描く）
      const tieDir = up ? 1 : -1, ty = hy + tieDir * L * 0.55;
      if (it.tieOut) parts.push(`<path class="tie" d="M${hx + rx * 0.6} ${ty} Q${hx + L * 2.2} ${ty + tieDir * L * 0.9} ${hx + L * 3.6} ${ty}"/>`);
      if (it.tieIn) parts.push(`<path class="tie" d="M${hx - L * 3.2} ${ty} Q${hx - L * 1.8} ${ty + tieDir * L * 0.9} ${hx - rx * 0.6} ${ty}"/>`);
      if (this.opts.names !== "none" && !it.tieIn) {
        const label = MusicTheory.spelledName(n.step, n.alter, this.opts.names);
        parts.push(`<text class="nm" x="${hx + rx + L * (glyph.dots ? 1.1 : 0.35)}" y="${hy + L * 0.45}" font-size="${L * 1.3}">${label}</text>`);
      }
      p.push(`<g class="note h${hand}" data-id="${n.id}" style="--nc:var(${color})">${parts.join("")}</g>`);
    }

    // 符幹と旗
    let stemEndY = up ? y(steps[steps.length - 1]) : y(steps[0]);
    if (glyph.kind !== "w") {
      const xs = up ? x + rx * 0.94 : x - rx * 0.94;
      const y1 = up ? y(steps[0]) : y(steps[steps.length - 1]);
      stemEndY = up ? y(steps[steps.length - 1]) - L * 3.5 : y(steps[0]) + L * 3.5;
      p.push(`<line class="stem" x1="${xs}" x2="${xs}" y1="${y1}" y2="${stemEndY}"/>`);
      const flags = { e: 1, s: 2, t: 3 }[glyph.kind] || 0;
      for (let k = 0; k < flags; k++) {
        const fy = stemEndY + (up ? 1 : -1) * k * L * 0.95, dir = up ? 1 : -1;
        p.push(`<path class="flag" d="M${xs} ${fy} c${L * 0.15} ${dir * L * 1.2} ${L * 1.5} ${dir * L * 1.4} ${L * 1.05} ${dir * L * 3}"/>`);
      }
    }

    // 運指（右手は上、左手は下）
    if (this.opts.fingering) {
      const fingers = items.filter((it) => !it.tieIn && it.n.finger).map((it) => it.n);
      if (fingers.length) {
        const fs = L * 1.45;
        if (hand === "R") {
          let fy = Math.min(y(steps[steps.length - 1]), up ? stemEndY : Infinity, sys.trebleTop) - L * 1.1;
          [...fingers].reverse().forEach((n) => { p.push(`<text class="finger" x="${x}" y="${fy}" font-size="${fs}" text-anchor="middle">${n.finger}</text>`); fy -= fs * 0.95; });
        } else {
          let fy = Math.max(y(steps[0]), up ? -Infinity : stemEndY, sys.bassTop + L * 4) + L * 2.2;
          fingers.forEach((n) => { p.push(`<text class="finger" x="${x}" y="${fy}" font-size="${fs}" text-anchor="middle">${n.finger}</text>`); fy += fs * 0.95; });
        }
      }
    }
  }

  drawRest(p, sys, mc, rest) {
    const L = this.LS, top = this.staffY(sys, rest.hand);
    if (rest.whole || rest.dur >= 4) {
      const x = rest.whole ? mc.x + mc.w / 2 : this.timeX(mc, rest.time) + L * 0.4;
      p.push(`<rect class="rest-block" x="${x - L * 0.65}" y="${top + L}" width="${L * 1.3}" height="${L * 0.55}"/>`);
      return;
    }
    const x = this.timeX(mc, rest.time);
    if (rest.dur >= 2) {
      p.push(`<rect class="rest-block" x="${x - L * 0.65}" y="${top + L * 1.45}" width="${L * 1.3}" height="${L * 0.55}"/>`);
      return;
    }
    const kind = ScoreView.durGlyph(rest.dur).kind;
    p.push(`<text class="rest" x="${x}" y="${top + L * 3.85}" font-size="${L * 4.8}" text-anchor="middle">${ScoreView.REST_GLYPH[kind] || ScoreView.REST_GLYPH.q}</text>`);
  }

  stepOf(n) { return MusicTheory.diatonicIndex(n.step, n.octave); }

  applyNoteState(id, state) {
    (this.noteEls.get(id) || []).forEach((el) => {
      el.classList.remove("cur", "ok", "miss");
      if (state) el.classList.add(state);
    });
  }

  renderLoopLayer() {
    const layer = this.svg.querySelector("#sv-loop");
    if (!layer || !this.layout) return;
    const L = this.LS, rects = [];
    const mark = (from, to, cls) => {
      for (let i = from; i <= to; i++) {
        const sys = this.layout.measureSys[i];
        const mc = sys && sys.measures.find((m) => m.index === i);
        if (!mc) continue;
        rects.push(`<rect class="${cls}" x="${mc.x}" y="${sys.trebleTop - L * 3}" width="${mc.w}" height="${sys.bassTop - sys.trebleTop + L * 10}"/>`);
      }
    };
    if (this.loop) mark(this.loop.from, this.loop.to, "loop-range");
    if (this.pendingLoopStart != null) mark(this.pendingLoopStart, this.pendingLoopStart, "loop-pending");
    layer.innerHTML = rects.join("");
  }
}
