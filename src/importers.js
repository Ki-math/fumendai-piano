/* =====================================================================
 *  Importers — 好きな曲の読み込み（MIDIファイル / MusicXML / .mxl）
 * ===================================================================== */

/** 標準MIDIファイル（.mid）を楽譜にする */
const MidiFileImporter = (() => {
  const GRID = 12;                       // 1拍を12分割して量子化（16分音符と3連符に対応）
  const quantize = (x) => Math.round(x * GRID) / GRID;

  function decodeText(bytes) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { try { return new TextDecoder("shift_jis").decode(bytes); } catch { return ""; } }
  }

  /** @returns {{division, tempo, timeSig, keyFifths, tracks:{name, notes:{midi,startTick,endTick,ch}[]}[]}} */
  function readSmf(buffer) {
    const v = new DataView(buffer);
    let p = 0;
    const str = (n) => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(p + i)); p += n; return s; };
    const u32 = () => { const x = v.getUint32(p); p += 4; return x; };
    const u16 = () => { const x = v.getUint16(p); p += 2; return x; };
    const readVar = () => { let val = 0, b; do { b = v.getUint8(p++); val = (val << 7) | (b & 0x7f); } while (b & 0x80); return val; };

    if (str(4) !== "MThd") throw new Error("MIDIファイルではありません");
    const headerLen = u32();
    u16();                                  // format（0/1どちらも同じ扱い）
    const trackCount = u16(), division = u16();
    p += headerLen - 6;
    if (division & 0x8000) throw new Error("SMPTE形式のMIDIには対応していません");

    const out = { division, tempo: null, timeSig: null, keyFifths: null, tracks: [] };
    for (let t = 0; t < trackCount && p + 8 <= v.byteLength; t++) {
      const id = str(4), len = u32(), end = Math.min(p + len, v.byteLength);
      if (id !== "MTrk") { p = end; continue; }
      let tick = 0, running = 0, name = "";
      const open = new Map(), notes = [];
      while (p < end) {
        tick += readVar();
        let status = v.getUint8(p);
        if (status & 0x80) { p++; if (status < 0xf0) running = status; } else status = running;

        if (status === 0xff) {                        // メタイベント
          const type = v.getUint8(p++), l = readVar(), d = p;
          p += l;
          if (type === 0x51 && out.tempo == null) out.tempo = (v.getUint8(d) << 16) | (v.getUint8(d + 1) << 8) | v.getUint8(d + 2);
          else if (type === 0x58 && !out.timeSig) out.timeSig = { beats: v.getUint8(d), beatType: 2 ** v.getUint8(d + 1) };
          else if (type === 0x59 && out.keyFifths == null) out.keyFifths = v.getInt8(d);
          else if (type === 0x03 && !name) name = decodeText(new Uint8Array(buffer, d, l));
          continue;
        }
        if (status === 0xf0 || status === 0xf7) { p += readVar(); continue; }

        const type = status & 0xf0, ch = status & 0x0f;
        const d1 = v.getUint8(p++);
        const d2 = type === 0xc0 || type === 0xd0 ? 0 : v.getUint8(p++);
        if (ch === 9) continue;                       // ドラムは除外
        const key = ch * 128 + d1;
        if (type === 0x90 && d2 > 0) {
          if (!open.has(key)) open.set(key, []);
          open.get(key).push(tick);
        } else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
          const starts = open.get(key);
          if (starts && starts.length) notes.push({ midi: d1, startTick: starts.shift(), endTick: tick, ch });
        }
      }
      p = end;
      if (notes.length) out.tracks.push({ name, notes });
    }
    return out;
  }

  /** トラック（またはチャンネル）ごとに右手・左手を決める */
  function assignHands(tracks) {
    const avg = (ns) => ns.reduce((s, n) => s + n.midi, 0) / ns.length;
    let groups = tracks.map((t) => t.notes);
    if (groups.length === 1) {
      const byCh = new Map();
      groups[0].forEach((n) => { if (!byCh.has(n.ch)) byCh.set(n.ch, []); byCh.get(n.ch).push(n); });
      if (byCh.size >= 2) groups = [...byCh.values()];
    }
    if (groups.length >= 2) {
      groups.sort((a, b) => avg(b) - avg(a));
      groups[0].forEach((n) => (n.hand = "R"));
      groups[1].forEach((n) => (n.hand = "L"));
      groups.slice(2).flat().forEach((n) => (n.hand = n.midi >= 60 ? "R" : "L"));
    } else {
      groups[0].forEach((n) => (n.hand = n.midi >= 60 ? "R" : "L"));   // 1声部だけなら中央のドで分ける
    }
    return groups.flat();
  }

  function parse(buffer, fileName) {
    const smf = readSmf(buffer);
    if (smf.tracks.length === 0) throw new Error("このMIDIファイルには音符がありません");
    const fifths = smf.keyFifths ?? 0;
    const notes = assignHands(smf.tracks).map((n) => {
      const start = quantize(n.startTick / smf.division);
      const dur = Math.max(1 / GRID, quantize((n.endTick - n.startTick) / smf.division));
      return { midi: n.midi, start, dur, hand: n.hand, ...MusicTheory.spell(n.midi, fifths) };
    });
    const trackTitle = smf.tracks.map((t) => t.name).find((s) => s && s.trim().length > 1);
    return ScoreModel.build({
      id: `import-${Date.now()}`, source: "import", kind: "piece",
      title: stripExt(fileName) || trackTitle || "読み込んだ曲", composer: "MIDI",
      bpm: smf.tempo ? Math.round(60e6 / smf.tempo) : 120,
      timeSig: smf.timeSig || { beats: 4, beatType: 4 }, keyFifths: fifths, notes,
    });
  }

  return { parse, readSmf };
})();

/** MusicXML（score-partwise）を楽譜にする */
const MusicXmlImporter = (() => {
  const txt = (el, sel, fallback = null) => {
    const e = el && el.querySelector(sel);
    return e ? e.textContent.trim() : fallback;
  };
  const childElements = (el, name) => [...el.children].filter((c) => c.nodeName === name);

  /** ピアノ譜（2段のパート）があればそれを、なければ先頭の2パートを使う */
  function choosePartPlan(parts) {
    const staves = (part) => Number(txt(part, "attributes staves", 1));
    const pitched = parts.filter((p) => txt(p, "attributes clef sign") !== "percussion");
    const piano = pitched.find((p) => staves(p) >= 2);
    if (piano) return [{ part: piano, handOf: (staff) => (staff >= 2 ? "L" : "R") }];
    return pitched.slice(0, 2).map((part, i) => ({ part, handOf: () => (i === 0 ? "R" : "L") }));
  }

  /** 1パートを読み、小節内の相対位置で音符を集める */
  function readPart(part, handOf, acc) {
    let divisions = 1;
    childElements(part, "measure").forEach((measure, mi) => {
      let cur = 0, maxPos = 0, lastStart = 0;
      for (const el of measure.children) {
        switch (el.nodeName) {
          case "attributes": {
            divisions = Number(txt(el, "divisions", divisions)) || divisions;
            if (acc.keyFifths == null && txt(el, "key fifths") != null) acc.keyFifths = Number(txt(el, "key fifths"));
            if (!acc.timeSig && txt(el, "time beats")) {
              acc.timeSig = { beats: Number(txt(el, "time beats")), beatType: Number(txt(el, "time beat-type")) };
            }
            break;
          }
          case "direction":
          case "sound": {
            const s = el.nodeName === "sound" ? el : el.querySelector("sound[tempo]");
            if (s && s.hasAttribute("tempo") && acc.bpm == null) acc.bpm = Math.round(Number(s.getAttribute("tempo")));
            break;
          }
          case "backup": cur -= Number(txt(el, "duration", 0)) / divisions; break;
          case "forward": cur += Number(txt(el, "duration", 0)) / divisions; maxPos = Math.max(maxPos, cur); break;
          case "note": {
            if (el.querySelector("grace")) break;             // 装飾音は判定しない
            const dur = Number(txt(el, "duration", 0)) / divisions;
            const isChord = !!el.querySelector("chord");
            const start = isChord ? lastStart : cur;
            if (!isChord) { lastStart = cur; cur += dur; }
            maxPos = Math.max(maxPos, cur);
            const pitch = el.querySelector("pitch");
            if (el.querySelector("rest") || !pitch) break;
            const step = txt(pitch, "step"), alter = Math.round(Number(txt(pitch, "alter", 0)) || 0), octave = Number(txt(pitch, "octave"));
            const ties = [...el.querySelectorAll("tie")].map((t) => t.getAttribute("type"));
            const finger = txt(el, "notations technical fingering");
            acc.notes.push({
              step, alter, octave, midi: MusicTheory.toMidi(step, alter, octave),
              measureIndex: mi, local: start, dur, hand: handOf(Number(txt(el, "staff", 1))),
              finger: finger && /^\d$/.test(finger) ? Number(finger) : null,
              tieStop: ties.includes("stop"),
            });
            break;
          }
        }
      }
      acc.measureLens[mi] = Math.max(acc.measureLens[mi] || 0, maxPos);
    });
  }

  /** タイでつながった音を1つの長い音にまとめる */
  function mergeTies(notes) {
    const out = [];
    for (const n of notes) {
      if (n.tieStop) {
        const prev = [...out].reverse().find((o) => o.midi === n.midi && o.hand === n.hand && Math.abs(o.start + o.dur - n.start) < 1e-3);
        if (prev) { prev.dur += n.dur; continue; }
      }
      out.push(n);
    }
    return out;
  }

  function parse(xmlText, fileName) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("MusicXMLを読めませんでした");
    const root = doc.documentElement;
    if (root.nodeName === "score-timewise") throw new Error("score-timewise形式には対応していません。楽譜ソフトから通常のMusicXMLで書き出してください");
    const parts = childElements(root, "part");
    if (parts.length === 0) throw new Error("MusicXMLにパートがありません");

    const acc = { notes: [], measureLens: [], keyFifths: null, timeSig: null, bpm: null };
    choosePartPlan(parts).forEach(({ part, handOf }) => readPart(part, handOf, acc));

    const timeSig = acc.timeSig || { beats: 4, beatType: 4 };
    const fullLen = (timeSig.beats * 4) / timeSig.beatType;
    const measures = [];
    let t = 0;
    acc.measureLens.forEach((len) => { const l = len > 1e-6 ? len : fullLen; measures.push({ start: t, len: l }); t += l; });

    const notes = mergeTies(
      acc.notes.map((n) => ({ ...n, start: measures[n.measureIndex].start + n.local }))
        .sort((a, b) => a.start - b.start || a.midi - b.midi)
    ).map(({ measureIndex, local, tieStop, ...n }) => n);
    if (notes.length === 0) throw new Error("この楽譜には弾く音がありません");

    const composer = root.querySelector('identification creator[type="composer"]');
    return ScoreModel.build({
      id: `import-${Date.now()}`, source: "import", kind: "piece",
      title: txt(root, "work work-title") || txt(root, "movement-title") || stripExt(fileName) || "読み込んだ曲",
      composer: composer ? composer.textContent.trim() : "",
      bpm: acc.bpm || 100, timeSig, keyFifths: acc.keyFifths ?? 0, measures, notes,
    });
  }

  return { parse };
})();

/** ファイルの種類を見て、適切な読み込み方法に振り分ける */
const ImportService = (() => {
  async function readMxl(buffer) {
    if (typeof JSZip === "undefined") {
      throw new Error("圧縮MusicXML（.mxl）を開くにはインターネット接続が必要です。.musicxml で書き出したファイルなら接続なしで開けます");
    }
    const zip = await JSZip.loadAsync(buffer);
    let path = null;
    const container = zip.file("META-INF/container.xml");
    if (container) {
      const x = new DOMParser().parseFromString(await container.async("string"), "application/xml");
      path = x.querySelector("rootfile")?.getAttribute("full-path");
    }
    if (!path) path = Object.keys(zip.files).find((f) => /\.(xml|musicxml)$/i.test(f) && !f.startsWith("META-INF"));
    if (!path) throw new Error(".mxlの中に楽譜が見つかりませんでした");
    return zip.file(path).async("string");
  }

  async function fromFile(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (ext === "mid" || ext === "midi") return MidiFileImporter.parse(await file.arrayBuffer(), file.name);
    if (ext === "mxl") return MusicXmlImporter.parse(await readMxl(await file.arrayBuffer()), file.name);
    if (ext === "xml" || ext === "musicxml") return MusicXmlImporter.parse(await file.text(), file.name);
    throw new Error("MIDI（.mid）か MusicXML（.musicxml / .xml / .mxl）のファイルを選んでください");
  }

  return { fromFile };
})();

function stripExt(name) { return (name || "").replace(/\.[^.]+$/, ""); }
