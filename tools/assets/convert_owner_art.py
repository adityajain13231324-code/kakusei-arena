"""Convert the owner's 2D art (work/owner-assets) into web assets. Usage: python -I convert_owner_art.py <owner-assets> <public>"""
import sys, os
from PIL import Image
src, pub = sys.argv[1], sys.argv[2]
def save(im, path, q=82):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, 'WEBP', quality=q, method=6)
    print(path, os.path.getsize(path) // 1024, 'KB')
for n in ['rooftop', 'shrine', 'market']:
    im = Image.open(f'{src}/stages/skyboxes/stage_{n}_sky.png').convert('RGB')
    save(im.resize((2048, 1024), Image.LANCZOS), f'{pub}/stages/sky/{n}_2048.webp', 85)
    save(im.resize((1024, 512), Image.LANCZOS), f'{pub}/stages/sky/{n}_1024.webp', 85)
for n in ['rooftop_concrete', 'shrine_stone', 'market_wet_street', 'wooden_fence', 'neon_sign_glow']:
    im = Image.open(f'{src}/stages/textures/tex_{n}.png').convert('RGB')
    save(im.resize((1024, 1024), Image.LANCZOS), f'{pub}/stages/tex/{n}_1024.webp', 82)
    save(im.resize((512, 512), Image.LANCZOS), f'{pub}/stages/tex/{n}_512.webp', 82)
for n in ['fire_burst', 'lightning_crackle', 'dust_puff', 'slash_arc', 'energy_orb']:
    im = Image.open(f'{src}/vfx/vfx_{n}_8x8.png').convert('RGB')
    save(im, f'{pub}/vfx/{n}_8x8.webp', 80)
