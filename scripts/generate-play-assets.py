#!/usr/bin/env python3
"""Regenerate Ba launcher icons + Play Console listing graphics."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "android" / "app" / "src" / "main" / "res"
PLAY = ROOT / "android" / "play"

PAGE = (9, 11, 22, 255)  # #090b16
PAGE_DEEP = (6, 8, 20, 255)
PAPER = (20, 27, 46, 255)
ACCENT = (122, 166, 255, 255)  # #7aa6ff
ACCENT_DEEP = (74, 114, 240, 255)
INK = (238, 242, 255, 255)
INK_SOFT = (168, 180, 212, 255)
ROSE = (242, 163, 184, 255)
TEAL = (111, 212, 200, 255)
GOLD = (232, 196, 138, 255)
LINE = (170, 190, 255, 40)

DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def font(size, bold=True):
    paths = [
        "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in paths:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def center_text(draw, box, text, fill, fnt):
    x0, y0, x1, y1 = box
    bbox = draw.textbbox((0, 0), text, font=fnt)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = x0 + (x1 - x0 - tw) / 2 - bbox[0]
    y = y0 + (y1 - y0 - th) / 2 - bbox[1]
    draw.text((x, y), text, font=fnt, fill=fill)


def draw_mark(size, bg=None, pad_ratio=0.18, circle=True):
    img = Image.new("RGBA", (size, size), bg if bg is not None else (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pad = int(size * pad_ratio)
    if circle:
        draw.ellipse((pad, pad, size - pad, size - pad), fill=ACCENT_DEEP)
        inner = pad + max(2, size // 28)
        draw.ellipse((inner, inner, size - inner, size - inner), fill=ACCENT)
    f = font(int(size * 0.42))
    center_text(draw, (0, 0, size, size), "Ba", INK if circle else ACCENT, f)
    return img


def save_png(img, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")


def write_launcher_icons():
    for folder, size in DENSITIES.items():
        out = RES / folder
        full = draw_mark(size, bg=PAGE, pad_ratio=0.14)
        save_png(full, out / "ic_launcher.png")
        save_png(full, out / "ic_launcher_round.png")
        # Adaptive foreground: transparent + mark with safe padding
        fg = draw_mark(size, bg=(0, 0, 0, 0), pad_ratio=0.22)
        save_png(fg, out / "ic_launcher_foreground.png")


def write_play_icon():
    PLAY.mkdir(parents=True, exist_ok=True)
    save_png(draw_mark(512, bg=PAGE, pad_ratio=0.12), PLAY / "icon-512.png")


def write_feature_graphic():
    w, h = 1024, 500
    img = Image.new("RGBA", (w, h), PAGE)
    draw = ImageDraw.Draw(img)
    # Soft vertical wash
    for y in range(h):
        t = y / (h - 1)
        r = int(PAGE[0] + (14 - PAGE[0]) * t * 0.35)
        g = int(PAGE[1] + (24 - PAGE[1]) * t * 0.35)
        b = int(PAGE[2] + (48 - PAGE[2]) * t * 0.45)
        draw.line((0, y, w, y), fill=(r, g, b, 255))
    # Accent glow disc
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((620, -80, 1080, 380), fill=(74, 114, 240, 55))
    gd.ellipse((680, 180, 1120, 620), fill=(242, 163, 184, 28))
    img = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(img)

    mark = draw_mark(220, bg=(0, 0, 0, 0), pad_ratio=0.12)
    img.alpha_composite(mark, (72, (h - 220) // 2))

    title = font(92)
    sub = font(28, bold=False)
    draw.text((340, 160), "Ba", font=title, fill=INK)
    draw.text((340, 280), "A private room for two.", font=sub, fill=INK_SOFT)
    save_png(img.convert("RGB").convert("RGBA"), PLAY / "feature-graphic-1024x500.png")


def rounded_rect(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def phone_frame(content):
    """Pad a 1080x1920 content image — already phone-sized."""
    return content


def screenshot_home():
    w, h = 1080, 1920
    img = Image.new("RGBA", (w, h), PAGE)
    draw = ImageDraw.Draw(img)
    # status bar spacer
    draw.text((48, 56), "Together", font=font(28, bold=False), fill=INK_SOFT)
    draw.text((48, 100), "Ba", font=font(92), fill=INK)
    draw.text((48, 220), "864  days", font=font(36), fill=ACCENT)

    quote_box = (48, 300, w - 48, 430)
    rounded_rect(draw, quote_box, 28, PAPER)
    draw.text((80, 340), "“Small ordinary days still count.”", font=font(30, bold=False), fill=INK_SOFT)

    poke = (48, 470, w - 48, 600)
    rounded_rect(draw, poke, 28, (52, 36, 58, 255))
    draw.text((80, 510), "Poke", font=font(40), fill=ROSE)
    draw.text((80, 560), "—", font=font(28, bold=False), fill=INK_SOFT)

    tiles = [
        ("Chat", ACCENT),
        ("Routine", TEAL),
        ("Daily", GOLD),
        ("Where", (126, 200, 255, 255)),
        ("To Do", ROSE),
        ("Overview", ACCENT_DEEP),
        ("Memories", GOLD),
        ("Periods", ROSE),
        ("Family", TEAL),
    ]
    cols, gap, x0, y0 = 3, 20, 48, 640
    tw = (w - 2 * x0 - 2 * gap) // 3
    th = 170
    for i, (label, tint) in enumerate(tiles):
        c, r = i % cols, i // cols
        x = x0 + c * (tw + gap)
        y = y0 + r * (th + gap)
        rounded_rect(draw, (x, y, x + tw, y + th), 24, PAPER)
        draw.ellipse((x + 28, y + 36, x + 68, y + 76), fill=tint)
        draw.text((x + 28, y + 100), label, font=font(32), fill=INK)

    draw.text((48, h - 120), "Settings", font=font(28, bold=False), fill=INK_SOFT)
    return phone_frame(img)


def screenshot_chat():
    w, h = 1080, 1920
    img = Image.new("RGBA", (w, h), PAGE)
    draw = ImageDraw.Draw(img)
    draw.text((48, 70), "Chat", font=font(56), fill=INK)

    bubbles = [
        (False, "On my way home."),
        (True, "Tea’s ready when you get here."),
        (False, "Perfect."),
        (True, "Also left you a note in Memories."),
    ]
    y = 200
    for mine, text in bubbles:
        f = font(34, bold=False)
        bbox = draw.textbbox((0, 0), text, font=f)
        tw = bbox[2] - bbox[0] + 56
        th = bbox[3] - bbox[1] + 48
        if mine:
            x0 = w - 48 - tw
            fill = ACCENT_DEEP
            ink = INK
        else:
            x0 = 48
            fill = PAPER
            ink = INK
        rounded_rect(draw, (x0, y, x0 + tw, y + th), 22, fill)
        draw.text((x0 + 28, y + 18), text, font=f, fill=ink)
        y += th + 28

    bar = (48, h - 180, w - 48, h - 80)
    rounded_rect(draw, bar, 28, PAPER, outline=LINE, width=2)
    draw.text((80, h - 148), "Message…", font=font(32, bold=False), fill=INK_SOFT)
    return phone_frame(img)


def screenshot_memories():
    w, h = 1080, 1920
    img = Image.new("RGBA", (w, h), PAGE)
    draw = ImageDraw.Draw(img)
    draw.text((48, 70), "Memories", font=font(56), fill=INK)
    draw.text((48, 150), "Things worth keeping", font=font(30, bold=False), fill=INK_SOFT)

    cards = [
        ("12 Sep", "Rain walk after dinner"),
        ("3 Aug", "First train trip together"),
        ("18 Jun", "That ridiculous cake"),
    ]
    y = 240
    for date, title in cards:
        rounded_rect(draw, (48, y, w - 48, y + 220), 28, PAPER)
        draw.rounded_rectangle((80, y + 36, 280, y + 184), radius=18, fill=(14, 18, 34, 255))
        draw.text((120, y + 90), date, font=font(28), fill=GOLD)
        draw.text((320, y + 70), title, font=font(36), fill=INK)
        draw.text((320, y + 130), "Tap to open", font=font(28, bold=False), fill=INK_SOFT)
        y += 250

    rounded_rect(draw, (w - 220, h - 200, w - 48, h - 80), 28, ACCENT_DEEP)
    center_text(draw, (w - 220, h - 200, w - 48, h - 80), "Add", INK, font(36))
    return phone_frame(img)


def write_screenshots():
    shots = PLAY / "screenshots"
    shots.mkdir(parents=True, exist_ok=True)
    save_png(screenshot_home(), shots / "01-home.png")
    save_png(screenshot_chat(), shots / "02-chat.png")
    save_png(screenshot_memories(), shots / "03-memories.png")


def write_splash():
    # Simple dark splash with centered mark for Capacitor defaults
    for folder, size in {
        "drawable": 480,
        "drawable-port-mdpi": 320,
        "drawable-port-hdpi": 480,
        "drawable-port-xhdpi": 720,
        "drawable-port-xxhdpi": 1080,
        "drawable-port-xxxhdpi": 1440,
        "drawable-land-mdpi": 480,
        "drawable-land-hdpi": 720,
        "drawable-land-xhdpi": 960,
        "drawable-land-xxhdpi": 1440,
        "drawable-land-xxxhdpi": 1920,
    }.items():
        is_land = "land" in folder
        if is_land:
            w, h = size, int(size * 0.56)
        else:
            w, h = int(size * 0.56) if folder != "drawable" else size, size
            if folder == "drawable":
                w = h = size
            else:
                # portrait phone-ish
                h = size
                w = int(size * 9 / 16)
        img = Image.new("RGBA", (w, h), PAGE)
        mark_size = min(w, h) // 3
        mark = draw_mark(mark_size, bg=(0, 0, 0, 0), pad_ratio=0.12)
        img.alpha_composite(mark, ((w - mark_size) // 2, (h - mark_size) // 2))
        save_png(img, RES / folder / "splash.png")


def main():
    write_launcher_icons()
    write_play_icon()
    write_feature_graphic()
    write_screenshots()
    write_splash()
    print("Wrote launcher icons, splash, and Play assets under android/play/")


if __name__ == "__main__":
    main()
