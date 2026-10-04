/* =====================================================================
 *  PracticeSession — 練習の進行と判定
 *
 *  mode:
 *    "wait"   … 正しい鍵盤（和音はすべて）を押すまで待つ。タイミングは問わない
 *    "tempo"  … 一定のテンポで進み、各音のタイミングを判定する
 *    "listen" … お手本の自動演奏（判定なし）
 *
 *  config:
 *    hands      "both" | "R" | "L"   練習する手（もう片方はアプリが伴奏）
 *    tempoPct   元のテンポに対する割合（%）
 *    metronome  テンポモードでクリックを鳴らす
 *    accompany  練習しない手を鳴らす
 *    loop       {from, to} 小節番号（0始まり）または null
 *    speedUp    ループで90%以上とれたら 5% ずつ速くする
 *    latencyMs  マイク入力の遅れ補正
 * ===================================================================== */
class PracticeSession {
  static WINDOW_MS = { perfect: 90, good: 170, ok: 270 };

  constructor({ score, view, keyboard, input, onUpdate, onPassEnd, onFinish, onJudge }) {
    Object.assign(this, { score, view, keyboard, input, onUpdate, onPassEnd, onFinish, onJudge });
    this.config = { hands: "both", tempoPct: 100, metronome: true, accompany: true, loop: null, speedUp: false, latencyMs: 100 };
    this.running = false;
    this.mode = null;
    this.raf = 0;
    this.timers = [];
  }

  /* ---------- 設定と共通の計算 ---------- */
  get beatMs() { return 60000 / (this.score.bpm * (this.config.tempoPct / 100)); }

  handsSet() {
    const present = ScoreModel.handsPresent(this.score);
    if (this.config.hands === "both") return present;
    return new Set([this.config.hands].filter((h) => present.has(h)));
  }

  range() {
    const last = this.score.measures.length - 1;
    return this.config.loop ? [this.config.loop.from, this.config.loop.to] : [0, last];
  }

  get measureBeats() { const ts = this.score.timeSig; return (ts.beats * 4) / ts.beatType; }

  /* ---------- 開始・停止 ---------- */
  start(mode) {
    this.stop();
    this.mode = mode;
    this.running = true;
    this.pass = 1;
    this.startedAt = performance.now();
    this.totals = PracticeSession.emptyStats();
    this.beginPass(true);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.audioQueue = [];
    if (this.keyboard) this.keyboard.setTargets(new Map());
  }

  static emptyStats() {
    return { hits: 0, wrong: 0, perfect: 0, good: 0, ok: 0, miss: 0, required: 0, offsets: [] };
  }

  beginPass(countIn) {
    this.passEnding = false;
    const [from, to] = this.range();
    const listen = this.mode === "listen";
    const { events, t0, t1 } = ScoreModel.eventsInRange(this.score, from, to, listen ? new Set() : this.handsSet());
    Object.assign(this, { events, rangeStart: t0, rangeEnd: t1, stats: PracticeSession.emptyStats() });
    this.stats.required = events.reduce((s, e) => s + e.required.length, 0);
    this.view.clearNoteStates();
    this.view.scrollToMeasure(from);
    if (this.mode === "wait") this.enterEvent(0);
    else this.startTimedPass(countIn);
    this.emitUpdate();
  }

  /* ---------- 入力 ---------- */
  noteOn(midi, velocity, source) {
    if (!this.running) return;
    if (this.mode === "wait") this.waitNoteOn(midi, source);
    else if (this.mode === "tempo") this.timedNoteOn(midi, source);
  }

  matches(target, played, source) {
    return source === "mic" ? MusicTheory.pitchClass(target) === MusicTheory.pitchClass(played) : target === played;
  }

  /* ---------- ウェイトモード ---------- */
  enterEvent(i) {
    this.index = i;
    const ev = this.events[i];
    if (!ev) { this.endPass(); return; }
    this.pressed = new Set();
    this.accompPlayed = false;
    ev.required.forEach((n) => this.view.setNoteState(n.id, "cur"));
    this.keyboard.setTargets(new Map(ev.required.map((n) => [n.midi, n.hand])));
    this.view.setCursorTime(ev.time);
    if (ev.required.length === 0) {
      // 練習している手が休みのところは、伴奏を鳴らして自動で進む
      this.playAccompaniment(ev);
      const next = this.events[i + 1];
      const gapBeats = (next ? next.time : this.rangeEnd) - ev.time;
      this.timers.push(setTimeout(() => { if (this.running && this.index === i) this.enterEvent(i + 1); }, gapBeats * this.beatMs));
    }
    this.emitUpdate();
  }

  waitNoteOn(midi, source) {
    const ev = this.events[this.index];
    if (!ev || ev.required.length === 0) return;
    const target = ev.required.find((n) => !this.pressed.has(n.id) && this.matches(n.midi, midi, source));
    if (!target) {
      const alreadyPressed = ev.required.some((n) => this.pressed.has(n.id) && this.matches(n.midi, midi, source));
      if (!alreadyPressed) {
        this.stats.wrong++;
        this.keyboard.flash(midi, "ng");
        this.onJudge && this.onJudge({ kind: "wrong", midi, expected: ev.required.map((n) => n.midi) });
      }
      this.emitUpdate();
      return;
    }
    // マイクは単音しか聞き分けられないので、和音は1音合えば進む
    const satisfied = source === "mic" ? ev.required : [target];
    satisfied.forEach((n) => {
      if (this.pressed.has(n.id)) return;
      this.pressed.add(n.id);
      this.stats.hits++;
      this.view.setNoteState(n.id, "ok");
    });
    if (!this.accompPlayed) this.playAccompaniment(ev);
    if (ev.required.every((n) => this.pressed.has(n.id))) this.enterEvent(this.index + 1);
    else this.emitUpdate();
  }

  playAccompaniment(ev) {
    this.accompPlayed = true;
    if (!this.config.accompany || this.input.activeSource === "mic") return;
    const now = AudioEngine.context().currentTime;
    ev.accomp.forEach((n) => AudioEngine.playNote(n.midi, now, (n.dur * this.beatMs) / 1000, 0.5));
  }

  /* ---------- テンポ・お手本モード ---------- */
  startTimedPass(countIn) {
    const beat = this.beatMs, now = performance.now();
    const countInBeats = countIn ? Math.round(this.measureBeats) : 0;
    this.t0 = now + 350 + countInBeats * beat;
    this.tEnd = this.t0 + (this.rangeEnd - this.rangeStart) * beat;
    const at = (scoreTime) => this.t0 + (scoreTime - this.rangeStart) * beat;

    this.timed = [];
    this.events.forEach((ev) => ev.required.forEach((n) => this.timed.push({ note: n, time: at(n.start), judged: null })));

    // 鳴らす音の予定表（少し先の分だけ順に AudioContext に渡す）
    const queue = [];
    for (let k = countInBeats; k >= 1; k--) queue.push({ time: this.t0 - k * beat, click: true, accent: k === countInBeats });
    const mic = this.input.activeSource === "mic";
    if (this.config.metronome && this.mode === "tempo") {
      for (let b = 0; b < this.rangeEnd - this.rangeStart - 1e-6; b++) {
        queue.push({ time: this.t0 + b * beat, click: true, accent: b % Math.round(this.measureBeats) === 0 });
      }
    }
    this.events.forEach((ev) => {
      const sounding = this.mode === "listen" ? ev.notes : (this.config.accompany && !mic ? ev.accomp : []);
      sounding.forEach((n) => queue.push({ time: at(n.start), midi: n.midi, dur: (n.dur * beat) / 1000 }));
    });
    this.audioQueue = queue.sort((a, b) => a.time - b.time);
    this.queueIndex = 0;
    this.eventCursor = 0;
    this.lastTargetsKey = "";
    this.view.setCursorTime(this.rangeStart);

    cancelAnimationFrame(this.raf);
    const loop = () => {
      if (!this.running || this.passEnding) return;
      this.tick(performance.now());
      if (this.running && !this.passEnding) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  tick(now) {
    if (this.passEnding) return;
    const beat = this.beatMs, W = PracticeSession.WINDOW_MS;

    while (this.queueIndex < this.audioQueue.length && this.audioQueue[this.queueIndex].time <= now + 120) {
      const item = this.audioQueue[this.queueIndex++];
      const when = AudioEngine.audioTimeOf(item.time);
      if (item.click) AudioEngine.click(when, item.accent);
      else AudioEngine.playNote(item.midi, when, item.dur, 0.55);
    }

    if (now >= this.t0 - beat * 0.25) {
      const scoreTime = this.rangeStart + (now - this.t0) / beat;
      this.view.setCursorTime(Math.min(Math.max(scoreTime, this.rangeStart), this.rangeEnd - 1e-3));
    }

    if (this.mode === "listen") {
      this.updateListenHighlights(now);
    } else {
      const lateLimit = W.ok + (this.input.activeSource === "mic" ? this.config.latencyMs : 0);
      this.timed.forEach((item) => {
        if (item.judged || now - item.time <= lateLimit) return;
        item.judged = "miss";
        this.stats.miss++;
        this.view.setNoteState(item.note.id, "miss");
        this.onJudge && this.onJudge({ kind: "miss" });
        this.emitUpdate();
      });
      const upcoming = this.timed.filter((it) => !it.judged && it.time - now < beat * 0.75 && now - it.time < W.ok);
      const key = upcoming.map((it) => it.note.id).join(",");
      if (key !== this.lastTargetsKey) {
        this.lastTargetsKey = key;
        this.keyboard.setTargets(new Map(upcoming.map((it) => [it.note.midi, it.note.hand])));
        upcoming.forEach((it) => this.view.setNoteState(it.note.id, "cur"));
      }
    }

    if (now > this.tEnd + 350) this.endPass();
  }

  updateListenHighlights(now) {
    const beat = this.beatMs;
    while (this.eventCursor < this.events.length && this.t0 + (this.events[this.eventCursor].time - this.rangeStart) * beat <= now) {
      const prev = this.events[this.eventCursor - 1];
      if (prev) prev.notes.forEach((n) => this.view.setNoteState(n.id, null));
      const ev = this.events[this.eventCursor++];
      ev.notes.forEach((n) => this.view.setNoteState(n.id, "cur"));
      this.keyboard.setTargets(new Map(ev.notes.map((n) => [n.midi, n.hand])));
    }
  }

  timedNoteOn(midi, source) {
    const W = PracticeSession.WINDOW_MS, now = performance.now();
    const t = now - (source === "mic" ? this.config.latencyMs : 0);
    const near = this.timed.filter((it) => !it.judged && Math.abs(t - it.time) <= W.ok);
    let best = null;
    near.forEach((it) => {
      if (!this.matches(it.note.midi, midi, source)) return;
      if (!best || Math.abs(t - it.time) < Math.abs(t - best.time)) best = it;
    });
    if (!best) {
      if (near.length) {
        this.stats.wrong++;
        this.keyboard.flash(midi, "ng");
        this.onJudge && this.onJudge({ kind: "wrong", midi, expected: near.map((it) => it.note.midi) });
        this.emitUpdate();
      }
      return;
    }
    const dt = t - best.time, abs = Math.abs(dt);
    const grade = abs <= W.perfect ? "perfect" : abs <= W.good ? "good" : "ok";
    best.judged = grade;
    this.stats[grade]++;
    this.stats.hits++;
    this.stats.offsets.push(dt);
    this.view.setNoteState(best.note.id, "ok");
    this.onJudge && this.onJudge({ kind: grade, dt });
    this.emitUpdate();
  }

  /* ---------- 成績 ---------- */
  static accuracyOf(stats, mode) {
    if (mode === "wait") return stats.hits + stats.wrong === 0 ? 0 : stats.hits / (stats.hits + stats.wrong);
    const total = stats.required;
    if (!total) return 0;
    const score = stats.perfect + 0.8 * stats.good + 0.5 * stats.ok;
    return Math.max(0, Math.min(1, score / (total + 0.5 * stats.wrong)));
  }

  static meanOffset(stats) {
    if (!stats.offsets.length) return null;
    return stats.offsets.reduce((s, x) => s + x, 0) / stats.offsets.length;
  }

  emitUpdate() {
    if (!this.onUpdate) return;
    const judged = this.mode === "wait" ? this.stats.hits : this.stats.perfect + this.stats.good + this.stats.ok + this.stats.miss;
    this.onUpdate({
      mode: this.mode, pass: this.pass, tempoPct: this.config.tempoPct,
      progress: this.stats.required ? judged / this.stats.required : 0,
      accuracy: PracticeSession.accuracyOf(this.stats, this.mode),
      stats: this.stats,
      measure: this.view.cursorTime != null ? ScoreModel.measureIndexAt(this.score.measures, this.view.cursorTime) : this.range()[0],
    });
  }

  endPass() {
    if (this.passEnding) return;          // 1回の通しにつき1度だけ集計する
    this.passEnding = true;
    const pass = {
      pass: this.pass, tempoPct: this.config.tempoPct,
      accuracy: PracticeSession.accuracyOf(this.stats, this.mode),
      meanOffset: PracticeSession.meanOffset(this.stats), stats: this.stats,
    };
    Object.keys(this.totals).forEach((k) => {
      if (k === "offsets") this.totals.offsets.push(...this.stats.offsets); else this.totals[k] += this.stats[k];
    });
    this.keyboard.setTargets(new Map());

    const looping = this.config.loop && this.mode !== "listen";
    if (looping) {
      let tempoChanged = false;
      if (this.mode === "tempo" && this.config.speedUp && pass.accuracy >= 0.9 && this.config.tempoPct < 150) {
        this.config.tempoPct = Math.min(150, this.config.tempoPct + 5);
        tempoChanged = true;
      }
      this.onPassEnd && this.onPassEnd({ ...pass, tempoChanged, nextTempoPct: this.config.tempoPct });
      this.pass++;
      cancelAnimationFrame(this.raf);
      this.timers.push(setTimeout(() => { if (this.running) this.beginPass(true); }, 900));
      return;
    }
    this.finish(pass);
  }

  finish(lastPass) {
    const summary = {
      mode: this.mode, hands: this.config.hands, tempoPct: lastPass.tempoPct,
      accuracy: this.pass > 1 ? PracticeSession.accuracyOf(this.totals, this.mode) : lastPass.accuracy,
      meanOffset: PracticeSession.meanOffset(this.pass > 1 ? this.totals : this.stats),
      stats: this.pass > 1 ? this.totals : this.stats,
      passes: this.pass, fullPiece: !this.config.loop,
      durationSec: (performance.now() - this.startedAt) / 1000,
    };
    this.stop();
    this.onFinish && this.onFinish(summary);
  }

  /** ループ練習を途中でやめたときの集計（1回以上終えていれば） */
  stopAndSummarize() {
    if (!this.running) return null;
    const hadPasses = this.pass > 1;
    this.stop();
    if (!hadPasses || this.mode === "listen") return null;
    return {
      mode: this.mode, hands: this.config.hands, tempoPct: this.config.tempoPct,
      accuracy: PracticeSession.accuracyOf(this.totals, this.mode), meanOffset: PracticeSession.meanOffset(this.totals),
      stats: this.totals, passes: this.pass - 1, fullPiece: false, durationSec: (performance.now() - this.startedAt) / 1000,
    };
  }
}
