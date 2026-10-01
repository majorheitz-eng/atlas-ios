from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pathlib import Path

root = Path(r"C:\Users\Major\Documents\atlas-ios\assets")
root.mkdir(parents=True, exist_ok=True)
size = 1024
im = Image.new("RGB", (size, size), "#03080D")

# Layered cyan reactor glow.
for radius, alpha in [(390, 18), (310, 28), (250, 44), (195, 70)]:
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    box = (size//2-radius, size//2-radius, size//2+radius, size//2+radius)
    d.ellipse(box, fill=(28, 230, 255, alpha))
    layer = layer.filter(ImageFilter.GaussianBlur(max(24, radius//4)))
    im = Image.alpha_composite(im.convert("RGBA"), layer)

draw = ImageDraw.Draw(im)
cx = cy = size // 2
for r, width, color in [
    (325, 10, (32, 223, 244, 150)),
    (270, 6, (132, 249, 255, 210)),
    (216, 14, (25, 191, 220, 255)),
    (156, 9, (221, 255, 255, 255)),
]:
    draw.ellipse((cx-r, cy-r, cx+r, cy+r), outline=color, width=width)

for i in range(12):
    import math
    angle = math.radians(i * 30 - 90)
    r1, r2 = 290, 322
    p1 = (cx + math.cos(angle)*r1, cy + math.sin(angle)*r1)
    p2 = (cx + math.cos(angle)*r2, cy + math.sin(angle)*r2)
    draw.line((p1, p2), fill=(68, 238, 255, 255), width=10)

draw.ellipse((cx-133, cy-133, cx+133, cy+133), fill=(4, 21, 28, 255), outline=(174, 252, 255, 255), width=5)
try:
    font = ImageFont.truetype("C:/Windows/Fonts/segoeuil.ttf", 210)
except OSError:
    font = ImageFont.load_default()
text = "A"
bbox = draw.textbbox((0, 0), text, font=font)
draw.text((cx-(bbox[2]-bbox[0])/2, cy-(bbox[3]-bbox[1])/2-22), text, font=font, fill=(223, 255, 255, 255))

im.convert("RGB").save(root / "icon.png", quality=96)
# Splash icon has transparent breathing room around the same mark.
splash = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
small = im.resize((720, 720), Image.Resampling.LANCZOS)
splash.alpha_composite(small, ((1024-720)//2, (1024-720)//2))
splash.save(root / "splash-icon.png")
print(root / "icon.png")
