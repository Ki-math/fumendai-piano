/* =====================================================================
 *  Store / PracticeLog — この端末のブラウザに保存するデータ
 *   ・練習時間（日ごと）と練習の履歴
 *   ・曲とレッスンのベスト記録（★）
 *   ・読み込んだ曲、表示や入力の設定
 * ===================================================================== */
const Store = {
  load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  /** @returns {boolean} 保存できたか */
  save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
};

const PracticeLog = (() => {
  const KEY = { daily: "fp-daily", sessions: "fp-sessions", best: "fp-best", imported: "fp-imported", settings: "fp-settings" };
  const MAX_SESSIONS = 300;
  let daily = Store.load(KEY.daily, {});
  let sessions = Store.load(KEY.sessions, []);
  let best = Store.load(KEY.best, {});
  let imported = Store.load(KEY.imported, []);

  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  /* ---------- 練習時間 ---------- */
  function addSeconds(sec) {
    const k = dayKey();
    daily[k] = (daily[k] || 0) + sec;
    Store.save(KEY.daily, daily);
  }

  function secondsOn(date) { return daily[dayKey(date)] || 0; }

  /** 直近 n 日の [{date, sec}]（古い順） */
  function lastDays(n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push({ date: d, sec: secondsOn(d) });
    }
    return out;
  }

  /** 今日（まだ弾いていなければ昨日）からさかのぼって、続けて練習した日数 */
  function streak() {
    const d = new Date();
    if (secondsOn(d) < 60) d.setDate(d.getDate() - 1);
    let n = 0;
    while (secondsOn(d) >= 60) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  const totalSeconds = () => Object.values(daily).reduce((s, x) => s + x, 0);

  /* ---------- 履歴とベスト ---------- */
  function recordSession(entry) {
    sessions.unshift({ ...entry, at: Date.now() });
    sessions = sessions.slice(0, MAX_SESSIONS);
    Store.save(KEY.sessions, sessions);
  }

  /** 星の条件：ウェイトで通す★1 / テンポ75%以上で85%以上★2 / 100%以上で95%以上★3（両手・曲全体） */
  function starsFor(summary, coversAllHands) {
    if (!summary.fullPiece || !coversAllHands) return 0;
    if (summary.mode === "tempo" && summary.tempoPct >= 100 && summary.accuracy >= 0.95) return 3;
    if (summary.mode === "tempo" && summary.tempoPct >= 75 && summary.accuracy >= 0.85) return 2;
    return summary.mode === "wait" || summary.mode === "tempo" ? 1 : 0;
  }

  function updateBest(pieceId, stars, summary) {
    const prev = best[pieceId] || { stars: 0, accuracy: 0, tempoPct: 0 };
    const next = {
      stars: Math.max(prev.stars, stars),
      accuracy: summary.mode === "tempo" ? Math.max(prev.accuracy, summary.accuracy) : prev.accuracy,
      tempoPct: summary.mode === "tempo" && summary.accuracy >= 0.85 ? Math.max(prev.tempoPct, summary.tempoPct) : prev.tempoPct,
      lastAt: Date.now(),
    };
    best[pieceId] = next;
    Store.save(KEY.best, best);
    return { improved: next.stars > prev.stars, best: next };
  }

  /* ---------- 読み込んだ曲 ---------- */
  function addImported(score) {
    imported = [score, ...imported.filter((s) => s.id !== score.id)];
    return Store.save(KEY.imported, imported);
  }
  function removeImported(id) {
    imported = imported.filter((s) => s.id !== id);
    Store.save(KEY.imported, imported);
  }

  return {
    dayKey, addSeconds, secondsOn, lastDays, streak, totalSeconds,
    recordSession, sessions: () => sessions, starsFor, updateBest, best: (id) => best[id] || null,
    addImported, removeImported, imported: () => imported,
    loadSettings: (defaults) => ({ ...defaults, ...Store.load(KEY.settings, {}) }),
    saveSettings: (s) => Store.save(KEY.settings, s),
  };
})();
