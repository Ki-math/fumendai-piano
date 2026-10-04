/* =====================================================================
 *  ZoomGuard — iPad / iPhone の Safari で、画面が勝手に拡大されるのを防ぐ
 *
 *  譜面台に置いて弾いている最中に、鍵盤や楽譜をすばやくタップしても
 *  ページ全体が拡大されないようにする。万一拡大されても自動で元に戻す。
 *   1. ピンチ（2本指）での拡大を止める
 *   2. ダブルタップでの拡大を止める（CSS の touch-action と二重に対策）
 *   3. 拡大された状態を見つけたら、表示倍率を 1 に戻す
 * ===================================================================== */
const ZoomGuard = (() => {
  const meta = document.querySelector('meta[name="viewport"]');
  const BASE = meta ? meta.content : "";

  const block = (e) => e.preventDefault();

  /** 表示倍率を 1 に戻す（viewport の指定を一度書き換えると Safari が倍率を戻す） */
  function resetZoom() {
    if (!meta) return;
    meta.content = BASE.replace("maximum-scale=1", "maximum-scale=1.01");
    requestAnimationFrame(() => (meta.content = BASE));
  }

  function isZoomed() {
    return !!(window.visualViewport && window.visualViewport.scale > 1.01);
  }

  function install() {
    // 1. ピンチ拡大（Safari 独自の gesture イベントと、2本指の touchmove）
    ["gesturestart", "gesturechange", "gestureend"].forEach((t) => document.addEventListener(t, block, { passive: false }));
    document.addEventListener("touchmove", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

    // 2. ダブルタップ拡大
    document.addEventListener("dblclick", block, { passive: false });

    // 3. 拡大されてしまったら戻す（画面の回転時にも確認する）
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => { if (isZoomed()) resetZoom(); });
    }
    window.addEventListener("orientationchange", () => setTimeout(resetZoom, 300));
  }

  install();
  return { resetZoom, isZoomed };
})();
