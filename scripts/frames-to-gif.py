#!/usr/bin/env python
"""把 --record 抓下来的 PNG 序列合成一张 GIF 动图。

环境里没有 ffmpeg，GIF 是唯一"双击就能播"的格式。
用一份全局调色板（取若干帧拼图量化），避免逐帧换调色板造成的闪烁。

用法：python scripts/frames-to-gif.py <帧目录> <输出 gif> [颜色数]
"""
import json
import os
import sys

from PIL import Image

try:
    from PIL.Image import Dither  # Pillow 10+

    DITHER = Dither.FLOYDSTEINBERG
except Exception:  # pragma: no cover - 老版本 Pillow
    DITHER = getattr(Image, "FLOYDSTEINBERG", 0)


def main() -> int:
    frame_dir = sys.argv[1]
    out = sys.argv[2]
    colors = int(sys.argv[3]) if len(sys.argv) > 3 else 128

    meta_path = os.path.join(frame_dir, "frames.json")
    with open(meta_path, encoding="utf-8") as fh:
        meta = json.load(fh)
    items = meta["frames"]
    if not items:
        print("no frames")
        return 1

    imgs = [Image.open(it["file"]).convert("RGB") for it in items]
    w, h = imgs[0].size

    # 全局调色板：抽样几帧缩小后拼成一张图，一起量化
    step = max(1, len(imgs) // 6)
    picks = list(range(0, len(imgs), step))[:6]
    sw, sh = max(32, w // 4), max(32, h // 4)
    mosaic = Image.new("RGB", (sw * len(picks), sh))
    for k, idx in enumerate(picks):
        mosaic.paste(imgs[idx].resize((sw, sh), Image.LANCZOS), (k * sw, 0))
    pal = mosaic.quantize(colors=colors, method=Image.MEDIANCUT)

    frames = [im.quantize(palette=pal, dither=DITHER) for im in imgs]
    durations = [max(30, int(it["delay"])) for it in items]

    frames[0].save(
        out,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
        format="GIF",
    )
    size = os.path.getsize(out) / 1024.0
    total = sum(durations) / 1000.0
    print(f"[gif] {out} · {len(frames)} 帧 · {w}x{h} · {total:.1f}s · {size:.0f}KB")

    # 同时给一份动图 WebP：体积只有 GIF 的零头（有损，浏览器可直接预览）
    webp_out = os.path.splitext(out)[0] + ".webp"
    imgs[0].save(
        webp_out,
        save_all=True,
        append_images=imgs[1:],
        duration=durations,
        loop=0,
        quality=62,
        method=4,
        format="WEBP",
    )
    print(f"[webp] {webp_out} · {os.path.getsize(webp_out) / 1024.0:.0f}KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
