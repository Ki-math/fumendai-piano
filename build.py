"""譜面台ピアノのビルド

src/ の各モジュールを依存の順に並べて1つの index.html にまとめ、
static/（アイコン・manifest・Service Worker）と一緒に docs/ に書き出す。
docs/ はそのまま GitHub Pages で配信できる。

    python3 build.py
"""
import hashlib
import shutil
from pathlib import Path

ROOT = Path(__file__).parent
SRC, STATIC, OUT = ROOT / "src", ROOT / "static", ROOT / "docs"

# 読み込み順（後ろのモジュールは前のモジュールを使う）
MODULES = ["theory", "score", "library", "importers", "audio", "input",
           "keyboard", "notation", "practice", "log", "app"]


def bundle_html() -> str:
    scripts = "\n".join(
        f"<script>\n/* ---- {name}.js ---- */\n{(SRC / f'{name}.js').read_text(encoding='utf-8')}</script>"
        for name in MODULES
    )
    shell = (SRC / "shell.html").read_text(encoding="utf-8")
    return shell.replace("<!--SCRIPTS-->", '<script>"use strict";</script>\n' + scripts)


def build() -> None:
    html = bundle_html()
    build_hash = hashlib.sha256(html.encode("utf-8")).hexdigest()[:10]

    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(STATIC, OUT)
    (OUT / "index.html").write_text(html, encoding="utf-8")
    sw = OUT / "sw.js"
    sw.write_text(sw.read_text(encoding="utf-8").replace("__BUILD_HASH__", build_hash), encoding="utf-8")
    (OUT / ".nojekyll").write_text("")          # GitHub Pages にそのまま配信させる

    print(f"docs/index.html  {len(html) / 1024:.0f} KB  (build {build_hash})")


if __name__ == "__main__":
    build()
