/* =====================================================================
 *  App — 画面の組み立てと操作
 * ===================================================================== */
const App = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const settings = PracticeLog.loadSettings({
    names: "none", colorize: false, fingering: true, keyLabels: "c", zoom: 1, micSensitivity: "mid", latencyMs: 100,
    micBannerDismissed: false,
  });
  const saveSettings = () => PracticeLog.saveSettings(settings);

  const input = new InputHub();
  input.mic.sensitivity = settings.micSensitivity;
  const view = new ScoreView($("scoreScroll"), $("scoreSvg"));
  const keyboard = new PianoKeyboard($("kb"), $("kbWrap"), {
    onPress: (midi) => {
      if (!input.mic.on) AudioEngine.playNote(midi, AudioEngine.context().currentTime, 0.6, 0.6);
      input.noteOn(midi, 0.6, "tap");
    },
    onRelease: (midi) => input.noteOff(midi, "tap"),
  });

  const state = {
    view: "library", returnTo: "library", score: null, session: null,
    hands: "both", mode: "wait", tempoPct: 100, metronome: true, accompany: true, speedUp: false,
    loop: null, loopPick: null,            // loopPick: null | "start" | 最初に選んだ小節番号
    pieceIndex: new Map(), lessonIndex: new Map(),
  };

  /* =================================================================
   *  小さな共通処理
   * ================================================================= */
  let toastTimer = 0, msgTimer = 0;
  function toast(text, ms = 2800) {
    const t = $("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  function setMessage(text, kind = "", ms = 0) {
    const el = $("stMsg");
    el.textContent = text;
    el.className = `msg ${kind}`;
    clearTimeout(msgTimer);
    if (ms) msgTimer = setTimeout(() => (el.textContent = ""), ms);
  }

  const starsHTML = (n) => [1, 2, 3].map((i) => `<span class="${i <= n ? "" : "off"}">★</span>`).join("");
  const pct = (x) => Math.round(x * 100);
  const handsLabel = (h) => ({ R: "右手", L: "左手", both: "両手" }[h] || "");
  const modeLabel = (m) => ({ wait: "ウェイト", tempo: "テンポ", listen: "お手本" }[m] || "");
  function handsBadge(score) {
    const hs = ScoreModel.handsPresent(score);
    return hs.size === 2 ? "両手" : hs.has("R") ? "右手" : "左手";
  }
  function scoreMeta(score) {
    return `${MusicTheory.keyName(score.keyFifths || 0)} · ${score.timeSig.beats}/${score.timeSig.beatType}拍子 · ${score.measures.length}小節 · ♩=${score.bpm}`;
  }
  function fmtDuration(sec) {
    const m = Math.floor(sec / 60), h = Math.floor(m / 60);
    return h ? `${h}時間${m % 60}分` : `${m}分`;
  }

  /* =================================================================
   *  画面の切り替え
   * ================================================================= */
  function showView(name) {
    state.view = name;
    ["library", "lessons", "log"].forEach((v) => ($(`view-${v}`).hidden = v !== name));
    $("view-practice").hidden = name !== "practice";
    $("topBar").hidden = name === "practice";
    document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === name)));
    if (name === "library") renderLibrary();
    if (name === "lessons") renderLessons();
    if (name === "log") renderLog();
    updateMicBanner();
  }

  /* ---------- 曲の一覧 ---------- */
  function renderLibrary() {
    const pieces = [...PracticeLog.imported(), ...Library.pieces()];
    state.pieceIndex = new Map(pieces.map((p) => [p.id, p]));
    $("pieceGrid").innerHTML = pieces.map((s) => {
      const best = PracticeLog.best(s.id), imported = s.source === "import";
      return `<div class="card${imported ? " imp" : ""}">
        <button type="button" class="card-open" data-open="${esc(s.id)}">
          <span class="card-top"><span class="badge${imported ? " imp" : ""}">${imported ? "読み込み" : handsBadge(s)}</span><span class="stars">${starsHTML(best ? best.stars : 0)}</span></span>
          <span class="title">${esc(s.title)}</span>
          <span class="who">${esc(s.composer)}</span>
          <span class="meta">${esc(scoreMeta(s))}</span>
        </button>
        ${imported ? `<button type="button" class="card-del" data-del="${esc(s.id)}">削除</button>` : ""}
      </div>`;
    }).join("");
  }

  function onLibraryClick(e) {
    const open = e.target.closest("[data-open]");
    const del = e.target.closest("[data-del]");
    if (del) {
      if (del.classList.contains("confirm")) {
        PracticeLog.removeImported(del.dataset.del);
        renderLibrary();
        toast("曲を削除しました");
      } else {
        del.classList.add("confirm");
        del.textContent = "もう一度押すと削除";
        setTimeout(() => { if (del.isConnected) { del.classList.remove("confirm"); del.textContent = "削除"; } }, 3000);
      }
      return;
    }
    if (open) openPractice(state.pieceIndex.get(open.dataset.open), "library");
  }

  async function onFileChosen(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const score = await ImportService.fromFile(file);
      const saved = PracticeLog.addImported(score);
      renderLibrary();
      toast(saved ? `「${score.title}」を読み込みました（${score.measures.length}小節）` : "読み込みましたが、容量が足りず保存できませんでした。この画面を閉じると消えます", 4000);
      openPractice(score, "library");
    } catch (err) {
      toast(err.message || "ファイルを読み込めませんでした", 5000);
    }
  }

  /* ---------- レッスン ---------- */
  function renderLessons() {
    const lessons = Library.lessons();
    state.lessonIndex = new Map(lessons.map((l) => [l.id, l]));
    const next = lessons.find((l) => !((PracticeLog.best(l.id) || {}).stars >= 1));
    $("lessonList").innerHTML = lessons.map((l, i) => {
      const best = PracticeLog.best(l.id), isNext = next && next.id === l.id;
      return `<button type="button" class="lesson${isNext ? " next" : ""}" data-lesson="${l.id}">
        <span class="num">${i + 1}</span>
        <span><span class="lt">${esc(l.title)}${isNext ? '<span class="next-tag">つぎはこれ</span>' : ""}</span><span class="ld">${esc(l.description)}</span></span>
        <span class="stars">${starsHTML(best ? best.stars : 0)}</span>
      </button>`;
    }).join("");
  }

  function onLessonClick(e) {
    const b = e.target.closest("[data-lesson]");
    if (b) openPractice(Library.lessonById(b.dataset.lesson), "lessons");   // 読譜ドリルは毎回作り直す
  }

  /* ---------- 練習記録 ---------- */
  function renderLog() {
    const week = PracticeLog.lastDays(7).reduce((s, d) => s + d.sec, 0);
    const tiles = [
      ["今日", Math.round(PracticeLog.secondsOn(new Date()) / 60), "分"],
      ["続けて練習", PracticeLog.streak(), "日"],
      ["この7日", Math.round(week / 60), "分"],
      ["これまでの合計", fmtDuration(PracticeLog.totalSeconds()), ""],
    ];
    $("logTiles").innerHTML = tiles.map(([label, v, unit]) =>
      `<div class="tile"><div class="label">${label}</div><div class="value">${v}<small>${unit}</small></div></div>`).join("");
    $("logChart").innerHTML = practiceChartSVG(PracticeLog.lastDays(14));

    const rows = PracticeLog.sessions().slice(0, 15);
    $("logTable").innerHTML = rows.length === 0
      ? '<p class="hint-text">まだ記録がありません。曲かレッスンを選んで弾いてみましょう。</p>'
      : `<table class="log"><thead><tr><th>日時</th><th>曲</th><th>モード</th><th>手</th><th>テンポ</th><th>正確さ</th><th>★</th></tr></thead><tbody>${rows.map((r) => {
          const d = new Date(r.at);
          return `<tr><td>${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}</td>
            <td>${esc(r.title)}${r.fullPiece ? "" : '<span class="muted">（部分）</span>'}</td><td>${modeLabel(r.mode)}</td><td>${handsLabel(r.hands)}</td>
            <td>${r.tempoPct}%</td><td>${pct(r.accuracy)}%</td><td class="stars">${r.stars ? "★".repeat(r.stars) : ""}</td></tr>`;
        }).join("")}</tbody></table>`;
  }

  function practiceChartSVG(days) {
    const mins = days.map((d) => d.sec / 60);
    const top = Math.max(10, Math.ceil(Math.max(...mins) / 10) * 10);
    const step = 44, left = 34, chartH = 130, padTop = 14, W = left + days.length * step + 8, H = padTop + chartH + 24;
    const y = (v) => padTop + chartH - (v / top) * chartH;
    const parts = [];
    [0, top / 2, top].forEach((v) => {
      parts.push(`<line class="grid" x1="${left}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}"/>`);
      parts.push(`<text x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
    });
    days.forEach((d, i) => {
      const x = left + i * step + 10, h = (mins[i] / top) * chartH, isToday = i === days.length - 1;
      if (h > 0) parts.push(`<rect class="bar-rect${isToday ? " today" : ""}" x="${x}" y="${y(mins[i])}" width="24" height="${h}" rx="3"/>`);
      if (mins[i] >= 1) parts.push(`<text x="${x + 12}" y="${y(mins[i]) - 4}" text-anchor="middle">${Math.round(mins[i])}</text>`);
      parts.push(`<text x="${x + 12}" y="${H - 6}" text-anchor="middle">${d.date.getMonth() + 1}/${d.date.getDate()}</text>`);
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="最近14日の練習時間">${parts.join("")}</svg>`;
  }

  /* =================================================================
   *  練習画面
   * ================================================================= */
  function openPractice(score, from) {
    if (!score) return;
    stopSession(false);
    state.returnTo = from || "library";
    state.score = score;
    const present = ScoreModel.handsPresent(score);
    Object.assign(state, {
      hands: present.size === 2 ? "both" : [...present][0], mode: "wait", tempoPct: 100,
      loop: null, loopPick: null, speedUp: false,
    });
    document.body.classList.remove("picking");
    $("pTitle").textContent = score.title;
    $("pSub").textContent = [score.composer, scoreMeta(score)].filter(Boolean).join(" · ");
    showView("practice");

    Object.assign(view.opts, { zoom: settings.zoom, names: settings.names, colorize: settings.colorize, fingering: settings.fingering });
    view.setScore(score);
    view.setCursorTime(score.measures[0].start, false);
    const [lo, hi] = ScoreModel.pitchRange(score);
    keyboard.fitTo(lo, hi);
    keyboard.setLabelMode(settings.keyLabels);
    keyboard.scrollIntoView(Math.round((lo + hi) / 2));

    state.session = new PracticeSession({ score, view, keyboard, input, onUpdate, onPassEnd, onFinish: handleFinish, onJudge });
    syncToolbar();
    updateStatus(null);
    setMessage(score.description ? score.description : "スタートを押すか、そのまま弾き始めてください");
  }

  function applyConfig() {
    if (!state.session) return;
    Object.assign(state.session.config, {
      hands: state.hands, tempoPct: state.tempoPct, metronome: state.metronome, accompany: state.accompany,
      loop: state.loop, speedUp: state.speedUp, latencyMs: settings.latencyMs,
    });
  }

  function syncToolbar() {
    const score = state.score;
    if (!score) return;
    const present = ScoreModel.handsPresent(score);
    const running = state.session && state.session.running;
    document.querySelectorAll("#handSeg [data-hands]").forEach((b) => {
      const h = b.dataset.hands;
      b.disabled = h === "both" ? present.size < 2 : !present.has(h);
      b.setAttribute("aria-pressed", String(state.hands === h));
    });
    document.querySelectorAll("#modeSeg [data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(state.mode === b.dataset.mode)));
    $("tempo").value = state.tempoPct;
    $("tempoOut").textContent = `${state.tempoPct}%　♩=${Math.round((score.bpm * state.tempoPct) / 100)}`;
    $("metroBtn").setAttribute("aria-pressed", String(state.metronome));
    $("accompBtn").setAttribute("aria-pressed", String(state.accompany));
    $("accompBtn").disabled = present.size < 2;
    $("speedBtn").setAttribute("aria-pressed", String(state.speedUp));
    const picking = state.loopPick != null;
    $("loopBtn").setAttribute("aria-pressed", String(!!state.loop || picking));
    $("loopBtn").textContent = state.loop ? `A–B ${state.loop.from + 1}〜${state.loop.to + 1}小節 ✕` : picking ? "小節をタップ…（取消）" : "A–B リピート";
    const mode = running ? state.session.mode : null;
    $("startBtn").textContent = running && mode !== "listen" ? "やめる" : "スタート";
    $("listenBtn").textContent = mode === "listen" ? "■ 止める" : "▶ お手本";
    view.setDimHand(state.hands === "R" ? "L" : state.hands === "L" ? "R" : null);
    applyConfig();
  }

  function startSession(mode) {
    if (!state.session) return;
    AudioEngine.context();
    state.loopPick = null;
    document.body.classList.remove("picking");
    view.setLoop(state.loop);
    applyConfig();
    state.session.start(mode);
    syncToolbar();
    setMessage(mode === "wait" ? "色のついた鍵盤を弾いてください（青＝右手、オレンジ＝左手）" : mode === "tempo" ? "1小節のカウントのあとに始まります" : "お手本を再生しています");
    requestWakeLock();
  }

  function stopSession(summarize = true) {
    const s = state.session;
    if (!s || !s.running) return;
    const summary = s.stopAndSummarize();
    if (summary && summarize) handleFinish(summary);
    syncToolbar();
  }

  function updateStatus(u) {
    const score = state.score;
    const measure = u ? u.measure : 0;
    $("stMeasure").innerHTML = `小節 <b>${measure + 1}</b> / ${score.measures.length}`;
    $("stProgress").style.width = `${u ? Math.round(u.progress * 100) : 0}%`;
    const judged = u && (u.stats.hits + u.stats.wrong + u.stats.miss > 0);
    $("stAccuracy").innerHTML = judged && u.mode !== "listen" ? `正確さ <b>${pct(u.accuracy)}%</b>` : "";
    $("stPass").innerHTML = u && state.loop && u.mode !== "listen" ? `<b>${u.pass}</b>回目` : "";
  }

  function onUpdate(u) {
    updateStatus(u);
    if (u.tempoPct !== state.tempoPct) { state.tempoPct = u.tempoPct; syncToolbar(); }
  }

  function onJudge(j) {
    const names = (list) => [...new Set(list)].map((m) => MusicTheory.nameJa(m, state.score.keyFifths || 0)).join("・");
    if (j.kind === "wrong") setMessage(`ちがう鍵盤（${names([j.midi])}）→ ${names(j.expected)}`, "ng", 1600);
    else if (j.kind === "miss") setMessage("ミス", "ng", 900);
    else if (j.kind === "perfect") setMessage("ピッタリ", "ok", 700);
    else setMessage(`${j.dt < 0 ? "少し早い" : "少し遅い"}（${Math.abs(Math.round(j.dt))}ms）`, "ok", 900);
  }

  function onPassEnd(p) {
    toast(`${p.pass}回目　正確さ ${pct(p.accuracy)}%${p.tempoChanged ? `　→ テンポを ${p.nextTempoPct}% に上げます` : ""}`);
    state.tempoPct = p.nextTempoPct;
    syncToolbar();
  }

  /* ---------- 結果 ---------- */
  function handleFinish(summary) {
    syncToolbar();
    if (summary.mode === "listen") { setMessage("お手本が終わりました。弾いてみましょう"); return; }
    const score = state.score, present = ScoreModel.handsPresent(score);
    const coversAll = summary.hands === "both" || (present.size === 1 && present.has(summary.hands));
    const stars = PracticeLog.starsFor(summary, coversAll);
    const { improved } = PracticeLog.updateBest(score.id, stars, summary);
    PracticeLog.recordSession({
      pieceId: score.id, title: score.title, mode: summary.mode, hands: summary.hands, tempoPct: summary.tempoPct,
      accuracy: summary.accuracy, passes: summary.passes, fullPiece: summary.fullPiece, stars,
    });
    showResult(summary, stars, improved, coversAll);
  }

  function showResult(summary, stars, improved, coversAll) {
    const s = summary.stats, acc = summary.accuracy;
    $("resultTitle").textContent = stars >= 3 ? "完ぺきです" : acc >= 0.9 ? "よくできました" : "おつかれさまでした";
    $("resultStars").innerHTML = starsHTML(stars);
    $("resultPct").innerHTML = `${pct(acc)}<small>%</small>`;
    const stats = summary.mode === "wait"
      ? [["正しく弾いた音", s.hits], ["まちがえた鍵盤", s.wrong]]
      : [["ピッタリ", s.perfect], ["少しずれ", s.good + s.ok], ["ミス", s.miss], ["ちがう鍵盤", s.wrong]];
    stats.push(["テンポ", `${summary.tempoPct}%`], ["手", handsLabel(summary.hands)]);
    if (summary.passes > 1) stats.push(["くり返し", `${summary.passes}回`]);
    $("resultStats").innerHTML = stats.map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join("");

    const notes = [];
    if (summary.mode === "tempo" && summary.meanOffset != null) {
      const m = Math.round(summary.meanOffset);
      notes.push(Math.abs(m) < 25 ? `タイミングはほぼ正確です（平均 ${m >= 0 ? "+" : ""}${m}ms）` : m < 0 ? `全体に少し早めです（平均 ${-m}ms 早い）` : `全体に少し遅れぎみです（平均 ${m}ms 遅い）`);
    }
    if (improved) notes.push("ベスト記録の★が増えました。");
    if (!summary.fullPiece) notes.push("部分リピートの結果です。★は曲全体を通したときにつきます。");
    else if (!coversAll) notes.push("片手練習の結果です。★は両手で通したときにつきます。");
    else if (summary.mode === "wait") notes.push("次はテンポモードで、まずは75%くらいから挑戦してみましょう。");
    else if (acc >= 0.95 && summary.tempoPct < 100) notes.push("正確に弾けています。テンポを上げてみましょう。");
    $("resultNote").textContent = notes.join(" ");
    $("resultSheet").hidden = false;
    $("resultAgain").onclick = () => { $("resultSheet").hidden = true; startSession(summary.mode); };
    $("resultAgain").focus();
  }

  /* ---------- 部分リピートの範囲選び ---------- */
  function onLoopButton() {
    if (state.loop || state.loopPick != null) {
      state.loop = null;
      state.loopPick = null;
      document.body.classList.remove("picking");
      view.setLoop(null);
      setMessage("リピートを解除しました", "", 1500);
    } else {
      stopSession();
      state.loopPick = "start";
      document.body.classList.add("picking");
      setMessage("くり返す最初の小節をタップしてください");
    }
    syncToolbar();
  }

  function onMeasureTap(index) {
    if (state.loopPick === "start") {
      state.loopPick = index;
      view.setLoop(null, index);
      setMessage("最後の小節をタップしてください（同じ小節をタップすると1小節だけ）");
    } else if (typeof state.loopPick === "number") {
      const from = Math.min(state.loopPick, index), to = Math.max(state.loopPick, index);
      state.loop = { from, to };
      state.loopPick = null;
      document.body.classList.remove("picking");
      view.setLoop(state.loop);
      view.setCursorTime(state.score.measures[from].start);
      setMessage(`${from + 1}〜${to + 1}小節をくり返します。スタートを押してください`);
    }
    syncToolbar();
  }

  /* =================================================================
   *  設定
   * ================================================================= */
  function openSettings() {
    syncSettings();
    $("settingsSheet").hidden = false;
  }

  function syncSettings() {
    const m = input.midi;
    $("midiState").textContent = m.devices.length ? `接続中：${m.devices.join("、")}` :
      m.error === "unsupported" ? "このブラウザでは使えません" : m.error === "denied" ? "許可されませんでした" : "未接続";
    $("midiBtn").hidden = m.error === "unsupported";
    $("midiHint").textContent = m.error === "unsupported"
      ? "iPad・iPhone の Safari（および iPad 上のすべてのブラウザ）は Web MIDI に対応していません。電子ピアノをつなぐときは、パソコンの Chrome / Edge、Android タブレットの Chrome、または Web MIDI に対応した iPad 用ブラウザアプリで開いてください。それまではマイクか画面の鍵盤で練習できます。"
      : "電子ピアノを USB ケーブル（または Bluetooth MIDI）でつなぎ、「接続する」を押してください。つなぎ直しても自動で認識します。";
    $("micBtn").setAttribute("aria-pressed", String(input.mic.on));
    $("micBtn").textContent = input.mic.on ? "マイクで聴き取り中（押すと止める）" : "マイクで聴き取る";
    document.querySelectorAll("#sensSeg [data-sens]").forEach((b) => b.setAttribute("aria-pressed", String(settings.micSensitivity === b.dataset.sens)));
    $("latency").value = settings.latencyMs;
    $("latencyOut").textContent = `${settings.latencyMs}ms`;
    document.querySelectorAll("#namesSeg [data-names]").forEach((b) => b.setAttribute("aria-pressed", String(settings.names === b.dataset.names)));
    $("colorBtn").setAttribute("aria-pressed", String(settings.colorize));
    $("fingerBtn").setAttribute("aria-pressed", String(settings.fingering));
    document.querySelectorAll("#keyLabelSeg [data-kl]").forEach((b) => b.setAttribute("aria-pressed", String(settings.keyLabels === b.dataset.kl)));
  }

  function changeSetting(patch) {
    Object.assign(settings, patch);
    saveSettings();
    if ("names" in patch || "colorize" in patch || "fingering" in patch || "zoom" in patch) {
      view.setOptions({ names: settings.names, colorize: settings.colorize, fingering: settings.fingering, zoom: settings.zoom });
    }
    if ("keyLabels" in patch) keyboard.setLabelMode(settings.keyLabels);
    if ("micSensitivity" in patch) input.setMicSensitivity(settings.micSensitivity);
    applyConfig();
    syncSettings();
  }

  /** 電子ピアノもマイクも使っていないとき（iPadなど）に、マイクを案内する */
  function updateMicBanner() {
    const show = state.view === "practice" && input.activeSource === "tap" && !settings.micBannerDismissed && PitchDetector.isSupported();
    $("micBanner").hidden = !show;
  }

  async function startMicWithFeedback() {
    const ok = await input.startMic();
    if (ok) toast("マイクで聴き取っています。ピアノを弾いてみてください");
    else toast(input.mic.error === "denied" ? "マイクの使用が許可されませんでした。設定アプリ → Safari → マイク で許可できます" : "このページではマイクを使えません（httpsのページで開いてください）", 5000);
    return ok;
  }

  function updateInputChip() {
    const src = input.activeSource;
    $("inputChip").dataset.src = src;
    $("inputText").textContent = src === "midi" ? `電子ピアノ：${input.midi.devices[0]}` : src === "mic" ? "マイク" : "画面の鍵盤";
    if (!$("settingsSheet").hidden) syncSettings();
    updateMicBanner();
  }

  /* =================================================================
   *  その他（画面の常時点灯・全画面・練習時間）
   * ================================================================= */
  let wakeLock = null;
  async function requestWakeLock() {
    try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => (wakeLock = null)); } } catch { /* 使えなくても練習には影響しない */ }
  }

  function toggleBig() {
    const on = !document.body.classList.contains("focus");
    document.body.classList.toggle("focus", on);
    $("bigBtn").textContent = on ? "⛶ もとに戻す" : "⛶ 大きく";
    const el = document.documentElement;
    try {
      if (on) { const req = el.requestFullscreen || el.webkitRequestFullscreen; if (req) { const r = req.call(el); if (r && r.catch) r.catch(() => {}); } }
      else if (document.fullscreenElement || document.webkitFullscreenElement) { const ex = document.exitFullscreen || document.webkitExitFullscreen; const r = ex.call(document); if (r && r.catch) r.catch(() => {}); }
    } catch { /* 全画面にできない環境ではページ内の拡大だけ */ }
  }

  function trackPracticeTime() {
    setInterval(() => {
      const active = state.view === "practice" && document.visibilityState === "visible" && performance.now() - input.lastActivity < 30000;
      if (active) PracticeLog.addSeconds(5);
    }, 5000);
  }

  function watchResize() {
    let lastW = 0, timer = 0;
    new ResizeObserver(() => {
      const w = $("scoreScroll").clientWidth;
      if (!state.score || Math.abs(w - lastW) < 4) return;
      lastW = w;
      clearTimeout(timer);
      timer = setTimeout(() => view.refresh(), 150);
    }).observe($("scoreScroll"));
  }

  /* =================================================================
   *  イベントの登録
   * ================================================================= */
  function bindEvents() {
    document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
    $("pieceGrid").addEventListener("click", onLibraryClick);
    $("fileInput").addEventListener("change", onFileChosen);
    $("lessonList").addEventListener("click", onLessonClick);

    $("backBtn").addEventListener("click", () => { stopSession(); if (document.body.classList.contains("focus")) toggleBig(); showView(state.returnTo); });
    $("handSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-hands]"); if (!b || b.disabled) return; stopSession(); state.hands = b.dataset.hands; syncToolbar(); });
    $("modeSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-mode]"); if (!b) return; stopSession(); state.mode = b.dataset.mode; syncToolbar(); });
    $("tempo").addEventListener("input", () => {
      if (state.session && state.session.running && state.session.mode !== "wait") stopSession();
      state.tempoPct = Number($("tempo").value);
      syncToolbar();
    });
    $("metroBtn").addEventListener("click", () => { state.metronome = !state.metronome; syncToolbar(); });
    $("accompBtn").addEventListener("click", () => { state.accompany = !state.accompany; syncToolbar(); });
    $("speedBtn").addEventListener("click", () => {
      state.speedUp = !state.speedUp;
      syncToolbar();
      if (state.speedUp) setMessage("リピート中に正確さ90%以上で、テンポを5%ずつ上げます（テンポモード）", "", 3000);
    });
    $("loopBtn").addEventListener("click", onLoopButton);
    view.onMeasureTap = onMeasureTap;
    $("zoomIn").addEventListener("click", () => changeSetting({ zoom: Math.min(1.9, +(settings.zoom + 0.15).toFixed(2)) }));
    $("zoomOut").addEventListener("click", () => changeSetting({ zoom: Math.max(0.7, +(settings.zoom - 0.15).toFixed(2)) }));
    $("bigBtn").addEventListener("click", toggleBig);
    $("startBtn").addEventListener("click", () => {
      if (state.session && state.session.running && state.session.mode !== "listen") stopSession();
      else startSession(state.mode);
    });
    $("listenBtn").addEventListener("click", () => {
      if (state.session && state.session.running && state.session.mode === "listen") stopSession(false);
      else startSession("listen");
    });
    document.addEventListener("keydown", (e) => {
      if (state.view !== "practice" || e.code !== "Space" || e.target.closest("input, button")) return;
      e.preventDefault();
      $("startBtn").click();
    });

    // 設定
    $("settingsBtn").addEventListener("click", openSettings);
    $("inputChip").addEventListener("click", openSettings);
    $("settingsClose").addEventListener("click", () => ($("settingsSheet").hidden = true));
    $("settingsSheet").addEventListener("click", (e) => { if (e.target === $("settingsSheet")) $("settingsSheet").hidden = true; });
    $("midiBtn").addEventListener("click", async () => {
      const ok = await input.connectMidi();
      toast(ok ? (input.midi.devices.length ? "電子ピアノを認識しました" : "MIDIは使えます。電子ピアノをつないでください") : "電子ピアノに接続できませんでした");
    });
    $("micBtn").addEventListener("click", () => (input.mic.on ? input.stopMic() : startMicWithFeedback()));
    $("micBannerBtn").addEventListener("click", startMicWithFeedback);
    $("micBannerClose").addEventListener("click", () => { settings.micBannerDismissed = true; saveSettings(); updateMicBanner(); });
    $("sensSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-sens]"); if (b) changeSetting({ micSensitivity: b.dataset.sens }); });
    $("latency").addEventListener("input", () => changeSetting({ latencyMs: Number($("latency").value) }));
    $("namesSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-names]"); if (b) changeSetting({ names: b.dataset.names }); });
    $("colorBtn").addEventListener("click", () => changeSetting({ colorize: !settings.colorize }));
    $("fingerBtn").addEventListener("click", () => changeSetting({ fingering: !settings.fingering }));
    $("keyLabelSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-kl]"); if (b) changeSetting({ keyLabels: b.dataset.kl }); });
    $("resultClose").addEventListener("click", () => ($("resultSheet").hidden = true));

    // 入力（電子ピアノ・マイク・画面の鍵盤）
    input.onStatus = updateInputChip;
    input.subscribe({
      noteOn(midi, velocity, source) {
        keyboard.setPressed(midi, true);
        if (state.view !== "practice" || !state.session) return;
        if (!$("resultSheet").hidden || !$("settingsSheet").hidden || state.loopPick != null) return;
        if (!state.session.running && state.mode === "wait") startSession("wait");   // 弾き始めたら自動でスタート
        state.session.noteOn(midi, velocity, source);
      },
      noteOff(midi) { keyboard.setPressed(midi, false); },
    });
  }

  function init() {
    bindEvents();
    updateInputChip();
    showView("library");
    trackPracticeTime();
    watchResize();
    if (input.midi.supported) input.connectMidi();
    else { input.midi.error = "unsupported"; }
    window.__piano = { input, view, state, keyboard };       // 動作確認用
  }

  return { init };
})();

App.init();
