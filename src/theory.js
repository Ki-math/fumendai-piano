/* =====================================================================
 *  MusicTheory — 音名・MIDI番号・調号・五線上の位置
 * ===================================================================== */
const MusicTheory = (() => {
  const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const LETTER_JA = { C: "ド", D: "レ", E: "ミ", F: "ファ", G: "ソ", A: "ラ", B: "シ" };
  const SHARP_SPELL = [["C",0],["C",1],["D",0],["D",1],["E",0],["F",0],["F",1],["G",0],["G",1],["A",0],["A",1],["B",0]];
  const FLAT_SPELL  = [["C",0],["D",-1],["D",0],["E",-1],["E",0],["F",0],["G",-1],["G",0],["A",-1],["A",0],["B",-1],["B",0]];
  const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
  const FLAT_ORDER  = ["B", "E", "A", "D", "G", "C", "F"];
  const KEY_NAME = {
    "-7": "変ハ長調", "-6": "変ト長調", "-5": "変ニ長調", "-4": "変イ長調", "-3": "変ホ長調", "-2": "変ロ長調", "-1": "ヘ長調",
    "0": "ハ長調", "1": "ト長調", "2": "ニ長調", "3": "イ長調", "4": "ホ長調", "5": "ロ長調", "6": "嬰ヘ長調", "7": "嬰ハ長調",
  };
  const ACC_TEXT = { "-2": "𝄫", "-1": "♭", "0": "♮", "1": "♯", "2": "𝄪" };
  const PC_COLOR = ["--do", null, "--re", null, "--mi", "--fa", null, "--so", null, "--ra", null, "--si"];

  const pitchClass = (m) => ((m % 12) + 12) % 12;
  const octaveOf = (m) => Math.floor(m / 12) - 1;
  const isBlack = (m) => [1, 3, 6, 8, 10].includes(pitchClass(m));
  const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);
  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const toMidi = (step, alter, octave) => (octave + 1) * 12 + LETTER_PC[step] + alter;

  /** "C#4" / "Bb3" → {step, alter, octave, midi} */
  function parseName(name) {
    const m = /^([A-G])(#{1,2}|b{1,2})?(-?\d)$/.exec(name);
    if (!m) throw new Error(`音名の形式が不正です: ${name}`);
    const alter = m[2] ? (m[2][0] === "#" ? m[2].length : -m[2].length) : 0;
    const octave = Number(m[3]);
    return { step: m[1], alter, octave, midi: toMidi(m[1], alter, octave) };
  }

  /** 調号に合わせてMIDI番号を音名表記にする（♯系の調は♯、♭系の調は♭） */
  function spell(midi, fifths = 0) {
    const [step, alter] = (fifths < 0 ? FLAT_SPELL : SHARP_SPELL)[pitchClass(midi)];
    return { step, alter, octave: Math.floor((midi - alter) / 12) - 1 };
  }

  /** 五線上の段数（ド=0, レ=1 … をオクターブ込みで連番化） */
  const diatonicIndex = (step, octave) => octave * 7 + LETTERS.indexOf(step);

  /** 調号で変化する音 {F:1, C:1, …} */
  function keyAlters(fifths) {
    const alters = {};
    keySignatureLetters(fifths).forEach((s) => (alters[s] = fifths > 0 ? 1 : -1));
    return alters;
  }
  const keySignatureLetters = (fifths) => (fifths > 0 ? SHARP_ORDER.slice(0, fifths) : FLAT_ORDER.slice(0, -fifths));

  const accText = (alter) => ACC_TEXT[String(alter)] || "";
  const accSuffix = (alter) => (alter > 0 ? "♯".repeat(alter) : "♭".repeat(-alter));

  /** 表記済みの音（step/alter）を名前にする。style: "ja" | "en" */
  function spelledName(step, alter, style = "ja") {
    return (style === "ja" ? LETTER_JA[step] : step) + accSuffix(alter);
  }
  const nameJa = (midi, fifths = 0) => { const s = spell(midi, fifths); return spelledName(s.step, s.alter, "ja"); };
  const nameEn = (midi, fifths = 0) => { const s = spell(midi, fifths); return spelledName(s.step, s.alter, "en") + s.octave; };
  const keyName = (fifths) => KEY_NAME[String(fifths)] || "";
  const colorVar = (midi) => PC_COLOR[pitchClass(midi)];

  return {
    LETTERS, toMidi, parseName, spell, diatonicIndex, keyAlters, keySignatureLetters,
    accText, spelledName, nameJa, nameEn, keyName, colorVar,
    pitchClass, octaveOf, isBlack, freqToMidi, midiToFreq,
  };
})();
