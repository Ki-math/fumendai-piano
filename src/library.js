/* =====================================================================
 *  Library — 内蔵の曲とレッスン
 *  旋律はいずれもパブリックドメイン。左手の伴奏はこのアプリ用の編曲。
 * ===================================================================== */
const Library = (() => {
  // よく使う左手の和音（ハ長調）
  const I = "[C3 E3 G3]", IV = "[C3 F3 A3]", V = "[B2 D3 G3]";

  const KIRAKIRA_R =
    "C4 C4 G4 G4 | A4 A4 G4/h | F4 F4 E4 E4 | D4 D4 C4/h | G4 G4 F4 F4 | E4 E4 D4/h | " +
    "G4 G4 F4 F4 | E4 E4 D4/h | C4 C4 G4 G4 | A4 A4 G4/h | F4 F4 E4 E4 | D4 D4 C4/h |";

  const PIECES = [
    { id: "kirakira-r", title: "きらきら星（右手）", composer: "フランス民謡", bpm: 90, time: "4/4",
      R: KIRAKIRA_R },
    { id: "kirakira", title: "きらきら星（両手）", composer: "フランス民謡", bpm: 90, time: "4/4",
      R: KIRAKIRA_R,
      L: `${I}/w | ${IV}/h ${I}/h | ${IV}/h ${I}/h | ${V}/h ${I}/h | ${I}/h ${IV}/h | ${I}/h ${V}/h | ` +
         `${I}/h ${IV}/h | ${I}/h ${V}/h | ${I}/w | ${IV}/h ${I}/h | ${IV}/h ${I}/h | ${V}/h ${I}/h |` },
    { id: "kaeru", title: "かえるのうた（輪唱）", composer: "ドイツ民謡", bpm: 100, time: "4/4",
      description: "右手が2小節進んだら、左手が同じメロディを追いかけます。",
      R: "C4 D4 E4 F4 | E4 D4 C4/h | E4 F4 G4 A4 | G4 F4 E4/h | C4 r C4 r | C4 r C4 r | " +
         "C4/e C4/e D4/e D4/e E4/e E4/e F4/e F4/e | E4 D4 C4/h | r/w | r/w |",
      L: "r/w | r/w | C3 D3 E3 F3 | E3 D3 C3/h | E3 F3 G3 A3 | G3 F3 E3/h | C3 r C3 r | C3 r C3 r | " +
         "C3/e C3/e D3/e D3/e E3/e E3/e F3/e F3/e | E3 D3 C3/h |" },
    { id: "mary", title: "メリーさんのひつじ（両手）", composer: "アメリカ民謡", bpm: 96, time: "4/4",
      R: "E4 D4 C4 D4 | E4 E4 E4/h | D4 D4 D4/h | E4 G4 G4/h | E4 D4 C4 D4 | E4 E4 E4 E4 | D4 D4 E4 D4 | C4/w |",
      L: `${I}/w | ${I}/w | ${V}/w | ${I}/w | ${I}/w | ${I}/w | ${V}/w | ${I}/w |` },
    { id: "moon", title: "月の光に（両手）", composer: "フランス民謡", bpm: 92, time: "4/4",
      R: "C4 C4 C4 D4 | E4/h D4/h | C4 E4 D4 D4 | C4/w | C4 C4 C4 D4 | E4/h D4/h | C4 E4 D4 D4 | C4/w | " +
         "D4 D4 D4 D4 | A3/h A3/h | D4 C4 B3 A3 | G3/w | C4 C4 C4 D4 | E4/h D4/h | C4 E4 D4 D4 | C4/w |",
      L: `${I}/w | ${I}/h ${V}/h | ${I}/h [B2 F3 G3]/h | ${I}/w | ${I}/w | ${I}/h ${V}/h | ${I}/h [B2 F3 G3]/h | ${I}/w | ` +
         `[D3 F3]/w | [D3 F3]/w | [G2 D3 F3]/w | [G2 B2 D3]/w | ${I}/w | ${I}/h ${V}/h | ${I}/h [B2 F3 G3]/h | ${I}/w |` },
    { id: "joy", title: "よろこびの歌（両手）", composer: "ベートーヴェン", bpm: 100, time: "4/4",
      R: "E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4/q. D4/e D4/h | E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4/q. C4/e C4/h | " +
         "D4 D4 E4 C4 | D4 E4/e F4/e E4 C4 | D4 E4/e F4/e E4 D4 | C4 D4 G3/h | E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4/q. C4/e C4/h |",
      L: `${I}/w | ${V}/w | ${I}/w | ${I}/h ${V}/h | ${I}/w | ${V}/w | ${I}/w | ${V}/h ${I}/h | ` +
         `${V}/h ${I}/h | ${V}/h ${I}/h | ${V}/w | ${I}/h [G2 B2 D3]/h | ${I}/w | ${V}/w | ${I}/w | ${V}/h ${I}/h |` },
  ];

  const LESSONS = [
    { id: "l01", title: "右手 ドレミファソ", bpm: 80, time: "4/4",
      description: "右手の親指をドに置き、5本の指で順番に弾きます。音符の上の数字は指番号です。",
      R: "C4@1 D4@2 E4@3 F4@4 | G4@5/h G4/h | G4@5 F4@4 E4@3 D4@2 | C4@1/w | C4@1 E4@3 D4@2 F4@4 | E4@3 G4@5 F4@4 D4@2 | C4@1 D4@2 E4@3 D4@2 | C4@1/w |" },
    { id: "l02", title: "左手 ドレミファソ", bpm: 80, time: "4/4",
      description: "左手の小指をドに置きます。左手は小指が5、親指が1です。",
      L: "C3@5 D3@4 E3@3 F3@2 | G3@1/h G3/h | G3@1 F3@2 E3@3 D3@4 | C3@5/w | C3@5 E3@3 D3@4 F3@2 | E3@3 G3@1 F3@2 D3@4 | C3@5 D3@4 E3@3 D3@4 | C3@5/w |" },
    { id: "l03", title: "両手でいっしょに", bpm: 72, time: "4/4",
      description: "右手と左手で同じ音を1オクターブはなして弾きます。",
      R: "C4@1 D4@2 E4@3 F4@4 | G4@5/h r/h | G4@5 F4@4 E4@3 D4@2 | C4@1/w | C4 E4 D4 F4 | E4 G4 F4 D4 | C4 D4 E4 D4 | C4/w |",
      L: "C3@5 D3@4 E3@3 F3@2 | G3@1/h r/h | G3@1 F3@2 E3@3 D3@4 | C3@5/w | C3 E3 D3 F3 | E3 G3 F3 D3 | C3 D3 E3 D3 | C3/w |" },
    { id: "l04", title: "ハ長調スケール（右手）", bpm: 72, time: "4/4",
      description: "上がるときは3の指のあとに親指をくぐらせ、下がるときは親指の上を3の指でこえます。",
      R: "C4@1 D4@2 E4@3 F4@1 | G4@2 A4@3 B4@4 C5@5 | C5@5 B4@4 A4@3 G4@2 | F4@1 E4@3 D4@2 C4@1 | C4@1/w |" },
    { id: "l05", title: "ハ長調スケール（左手）", bpm: 72, time: "4/4",
      description: "左手は上がるときに3の指で親指の上をこえ、下がるときに親指をくぐらせます。",
      L: "C3@5 D3@4 E3@3 F3@2 | G3@1 A3@3 B3@2 C4@1 | C4@1 B3@2 A3@3 G3@1 | F3@2 E3@3 D3@4 C3@5 | C3@5/w |" },
    { id: "l06", title: "ハ長調スケール（両手）", bpm: 66, time: "4/4",
      description: "両手で同時に。指くぐりのタイミングが左右でずれるところに注意します。",
      R: "C4@1 D4@2 E4@3 F4@1 | G4@2 A4@3 B4@4 C5@5 | C5@5 B4@4 A4@3 G4@2 | F4@1 E4@3 D4@2 C4@1 | C4/w |",
      L: "C3@5 D3@4 E3@3 F3@2 | G3@1 A3@3 B3@2 C4@1 | C4@1 B3@2 A3@3 G3@1 | F3@2 E3@3 D3@4 C3@5 | C3/w |" },
    { id: "l07", title: "主要三和音（左手）", bpm: 66, time: "4/4",
      description: "ドミソ（I）・ドファラ（IV）・シレソ（V）。指の形を保ったまま移ります。",
      L: "[C3@5 E3@3 G3@1]/h [C3@5 F3@2 A3@1]/h | [B2@5 D3@3 G3@1]/h [C3@5 E3@3 G3@1]/h | " +
         `${I}/h ${IV}/h | ${V}/h ${I}/h | ${IV}/w | ${I}/w | ${V}/w | ${I}/w |` },
    { id: "l08", title: "メロディと和音（両手）", bpm: 72, time: "4/4",
      description: "右手でメロディ、左手で和音。左手は右手より少しやわらかく弾きます。",
      R: "E4 E4 F4 F4 | D4 D4 E4/h | E4 E4 F4 F4 | D4 D4 C4/h | G4 G4 F4 F4 | E4 E4 D4/h | E4 E4 F4 D4 | C4/w |",
      L: `${I}/h ${IV}/h | ${V}/h ${I}/h | ${I}/h ${IV}/h | ${V}/h ${I}/h | ${I}/h ${IV}/h | ${I}/h ${V}/h | ${I}/h ${V}/h | ${I}/w |` },
    { id: "l09", title: "ト長調スケール（右手）", bpm: 72, time: "4/4", key: 1,
      description: "ファに♯がつきます（調号）。黒鍵のファ♯を4の指で弾きます。",
      R: "G4@1 A4@2 B4@3 C5@1 | D5@2 E5@3 F#5@4 G5@5 | G5@5 F#5@4 E5@3 D5@2 | C5@1 B4@3 A4@2 G4@1 | G4@1/w |" },
    { id: "l10", title: "ヘ長調スケール（右手）", bpm: 72, time: "4/4", key: -1,
      description: "シに♭がつきます。ヘ長調の右手は4の指のあとに親指をくぐらせます。",
      R: "F4@1 G4@2 A4@3 Bb4@4 | C5@1 D5@2 E5@3 F5@4 | F5@4 E5@3 D5@2 C5@1 | Bb4@4 A4@3 G4@2 F4@1 | F4@1/w |" },
    { id: "l11", title: "付点と8分音符のリズム", bpm: 72, time: "4/4",
      description: "付点4分音符は1拍半。テンポモードでメトロノームに合わせましょう。",
      R: "C4/q. D4/e E4/q. F4/e | G4/h G4/h | A4/e A4/e G4/e F4/e E4 D4 | C4/w | E4/e E4/e E4 D4/q. D4/e | C4/h r/h |" },
    { id: "l12", title: "アルペジオ（右手）", bpm: 66, time: "4/4",
      description: "和音をばらして弾きます。手首をやわらかく横に運びます。",
      R: "C4@1/e E4@2/e G4@3/e C5@5/e G4@3/e E4@2/e C4@1 | C4@1/e F4@2/e A4@3/e C5@5/e A4@3/e F4@2/e C4@1 | " +
         "B3@1/e D4@2/e G4@3/e B4@5/e G4@3/e D4@2/e B3@1 | C4@1/e E4@2/e G4@3/e C5@5/e C5/h |" },
    { id: "l13", title: "読譜ドリル（大譜表）", bpm: 60, time: "4/4", generated: "sightReading",
      description: "毎回ちがう音が出ます。ト音記号は右手、ヘ音記号は左手で弾きます。" },
  ];

  /** 読譜ドリル：右手 C4〜G5、左手 F2〜C4 の白鍵からランダムに16音 */
  function generateSightReading() {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const rh = ["C4","D4","E4","F4","G4","A4","B4","C5","D5","E5","F5","G5"];
    const lh = ["F2","G2","A2","B2","C3","D3","E3","F3","G3","A3","B3","C4"];
    const R = [], L = [];
    for (let m = 0; m < 4; m++) {
      for (let b = 0; b < 4; b++) {
        const right = Math.random() < 0.5;
        R.push(right ? pick(rh) : "r");
        L.push(right ? "r" : pick(lh));
      }
      R.push("|"); L.push("|");
    }
    return { R: R.join(" "), L: L.join(" ") };
  }

  function scoreFromDef(def, kind) {
    const text = def.generated === "sightReading" ? { ...def, ...generateSightReading() } : def;
    return { ...ScoreModel.fromText(text), kind };
  }

  return {
    pieces: () => PIECES.map((d) => scoreFromDef(d, "piece")),
    lessons: () => LESSONS.map((d) => scoreFromDef(d, "lesson")),
    lessonById: (id) => { const d = LESSONS.find((l) => l.id === id); return d ? scoreFromDef(d, "lesson") : null; },
    definitions: () => [...PIECES, ...LESSONS],
  };
})();
