"""Brand the generated Capacitor Android project: icon, splash, colours, 120 Hz activity, version.

Run after `npx cap add android` (GitHub Actions does this for you).
"""
import os
import re
import shutil
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "android/app/src/main/res"
DUSK = (17, 25, 44)
CREAM = (245, 238, 219)
ICON = Image.open(ROOT / "android-overrides/icon-1024.png").convert("RGB")
PADDED = Image.open(ROOT / "android-overrides/icon-padded-1024.png").convert("RGB")

# Launcher icons
legacy = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
fore = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
for d, s in legacy.items():
    folder = RES / f"mipmap-{d}"
    folder.mkdir(parents=True, exist_ok=True)
    sq = ICON.resize((s, s), Image.LANCZOS)
    sq.save(folder / "ic_launcher.png")
    mask = Image.new("L", (s * 4, s * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, s * 4 - 1, s * 4 - 1), fill=255)
    rnd = Image.new("RGBA", (s, s))
    rnd.paste(sq, (0, 0), mask.resize((s, s), Image.LANCZOS))
    rnd.save(folder / "ic_launcher_round.png")
    PADDED.resize((fore[d], fore[d]), Image.LANCZOS).save(folder / "ic_launcher_foreground.png")

bg = RES / "values/ic_launcher_background.xml"
bg.parent.mkdir(parents=True, exist_ok=True)
bg.write_text('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#11192C</color>\n</resources>\n')

# Splash screens: logo centred on the app background.
for f in RES.rglob("splash.png"):
    w, h = Image.open(f).size
    img = Image.new("RGB", (w, h), DUSK)
    s = int(min(w, h) * 0.34)
    img.paste(ICON.resize((s, s), Image.LANCZOS), ((w - s) // 2, (h - s) // 2))
    img.save(f)

# Activity that asks for the highest refresh rate.
dst = ROOT / "android/app/src/main/java/com/xedd/xenoreads/MainActivity.java"
dst.parent.mkdir(parents=True, exist_ok=True)
shutil.copy(ROOT / "android-overrides/MainActivity.java", dst)

# Version: every build installs over the last one.
gradle = ROOT / "android/app/build.gradle"
run = int(os.environ.get("GITHUB_RUN_NUMBER", "1"))
txt = gradle.read_text()
txt = re.sub(r"versionCode \d+", f"versionCode {run}", txt)
txt = re.sub(r'versionName "[^"]*"', f'versionName "1.0.{run}"', txt)
gradle.write_text(txt)
print(f"Android project branded (version 1.0.{run}).")
