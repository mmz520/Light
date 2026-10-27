from PIL import Image
import os

ASSETS = '/workspace/assets'
OUT = '/workspace'

files = [
    ('player_walk_1.jpg', 'player_walk.png'),
    ('player_action_1.jpg', 'player_action.png'),
    ('enemy1_hound_1.jpg', 'enemy1.png'),
    ('enemy2_beast_1.jpg', 'enemy2.png'),
]

# 去白底 + 去除敌人图中的淡网格线
# 网格线颜色接近浅灰 (200-230)，我们把它也视为背景

def is_bg(r, g, b):
    # 纯白/浅灰背景
    return r > 210 and g > 210 and b > 210 and abs(int(r)-int(g)) < 15 and abs(int(g)-int(b)) < 15

for src, dst in files:
    path = os.path.join(ASSETS, src)
    img = Image.open(path).convert('RGBA')
    pixels = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if is_bg(r, g, b):
                pixels[x, y] = (255, 255, 255, 0)
    out_path = os.path.join(OUT, dst)
    img.save(out_path)
    print(f'{src} -> {out_path} ({w}x{h})')

print('Done')
