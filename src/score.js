/* =====================================================================
 *  ScoreModel — 楽譜データの形と、テキスト譜からの生成
 *
 *  楽譜 (score) の形:
 *    { id, title, composer, source, bpm, timeSig:{beats,beatType}, keyFifths,
 *      measures:[{start,len}], notes:[{id,start,dur,midi,step,alter,octave,hand,finger,measure}],
 *      totalBeats }
 *  時間の単位はすべて「4分音符＝1」。hand は "R"（右手）か "L"（左手）。
 *
 *  テキスト譜の書き方（1手ぶん）:
 *    C4  C#4  Bb3      音名（既定は4分音符）
 *    C4/h  C4/q.  r/e  音価 w h q e s、付点は「.」、r は休符
 *    [C3 E3 G3]/h      和音
 *    C4@1              運指（指番号）
 *    |                 小節線（読みやすさのため。検証にも使う）
 * ===================================================================== */
const ScoreModel = (() => {
  const EPS = 1e-4;
  const DUR = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 };
  const TOKEN_RE = /\[[^\]]*\](?:\/[whqes]\.?)?|\S+/g;

  function parseDuration(code) {
    if (!code) return 1;
    const m = /^([whqes])(\.?)$/.exec(code);
    if (!m) throw new Error(`音価の形式が不正です: ${code}`);
    return DUR[m[1]] * (m[2] ? 1.5 : 1);
  }

  function parsePitchToken(token) {
    const [name, finger] = token.split("@");
    return { ...MusicTheory.parseName(name), finger: finger ? Number(finger) : null };
  }

  /** 1手ぶんのテキスト譜 → {notes, bars(小節線の位置), length} */
  function parseHand(text, hand) {
    const notes = [], bars = [];
    let t = 0;
    for (const token of (text || "").match(TOKEN_RE) || []) {
      if (token === "|") { bars.push(t); continue; }
      const slash = token.lastIndexOf("/");
      const body = slash >= 0 ? token.slice(0, slash) : token;
      const dur = parseDuration(slash >= 0 ? token.slice(slash + 1) : null);
      if (body !== "r") {
        const pitches = body.startsWith("[") ? body.slice(1, -1).trim().split(/\s+/) : [body];
        pitches.forEach((p) => notes.push({ ...parsePitchToken(p), start: t, dur, hand }));
      }
      t += dur;
    }
    return { notes, bars, length: t };
  }

  /** テキスト定義 {id,title,time:"4/4",key,bpm,R,L,…} → score */
  function fromText(def) {
    const [beats, beatType] = (def.time || "4/4").split("/").map(Number);
    const right = parseHand(def.R, "R"), left = parseHand(def.L, "L");
    return build({
      id: def.id, title: def.title, composer: def.composer || "", description: def.description || "",
      source: def.source || "builtin", bpm: def.bpm || 90, timeSig: { beats, beatType }, keyFifths: def.key || 0,
      notes: [...right.notes, ...left.notes],
    });
  }

  /** 音符をならべ、小節を決め、IDを振って楽譜を完成させる */
  function build(raw) {
    const notes = raw.notes.map((n) => ({ ...n })).sort((a, b) => a.start - b.start || a.midi - b.midi);
    notes.forEach((n, i) => {
      n.id = i;
      if (!n.step) Object.assign(n, MusicTheory.spell(n.midi, raw.keyFifths || 0));
      if (n.finger === undefined) n.finger = null;
    });
    const measureLen = (raw.timeSig.beats * 4) / raw.timeSig.beatType;
    const end = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
    let measures = raw.measures;
    if (!measures || measures.length === 0) {
      const count = Math.max(1, Math.ceil(end / measureLen - EPS));
      measures = Array.from({ length: count }, (_, i) => ({ start: i * measureLen, len: measureLen }));
    }
    notes.forEach((n) => (n.measure = measureIndexAt(measures, n.start)));
    const last = measures[measures.length - 1];
    return { ...raw, notes, measures, totalBeats: last.start + last.len };
  }

  function measureIndexAt(measures, t) {
    let lo = 0, hi = measures.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (measures[mid].start <= t + EPS) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  /**
   * 指定した小節範囲の「同時に弾く音のまとまり（イベント）」を作る
   * @param {Set<string>} hands 練習する手 {"R","L"}
   * @returns {{events:{time,notes,required,accomp}[], t0:number, t1:number}}
   */
  function eventsInRange(score, fromMeasure, toMeasure, hands) {
    const t0 = score.measures[fromMeasure].start;
    const lastM = score.measures[toMeasure];
    const t1 = lastM.start + lastM.len;
    const events = [];
    for (const n of score.notes) {
      if (n.start < t0 - EPS || n.start >= t1 - EPS) continue;
      const prev = events[events.length - 1];
      if (prev && Math.abs(prev.time - n.start) < EPS) prev.notes.push(n);
      else events.push({ time: n.start, notes: [n] });
    }
    events.forEach((e) => {
      e.required = e.notes.filter((n) => hands.has(n.hand));
      e.accomp = e.notes.filter((n) => !hands.has(n.hand));
    });
    return { events, t0, t1 };
  }

  function handsPresent(score) {
    return new Set(score.notes.map((n) => n.hand));
  }

  function pitchRange(score) {
    let lo = 127, hi = 0;
    score.notes.forEach((n) => { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); });
    return lo > hi ? [60, 72] : [lo, hi];
  }

  return { EPS, parseHand, fromText, build, measureIndexAt, eventsInRange, handsPresent, pitchRange };
})();
