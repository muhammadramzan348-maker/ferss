from PIL import Image, ImageDraw, ImageFont
import pathlib
out = pathlib.Path(__file__).resolve().parent.parent / 'icons'
def icon(size, pad=0.0, name='icon'):
    im = Image.new('RGB', (size, size), '#12263f'); d = ImageDraw.Draw(im)
    p = int(size * pad); s = size - 2 * p
    d.rounded_rectangle([p + s * .08, p + s * .08, p + s * .92, p + s * .92], radius=s * .18, fill='#1b7f4c')
    bolt = [(.56, .12), (.28, .55), (.47, .55), (.40, .90), (.74, .42), (.53, .42), (.62, .12)]
    d.polygon([(p + x * s, p + y * s) for x, y in bolt], fill='#ffffff')
    im.save(out / f'{name}.png')
icon(192, 0, 'icon-192'); icon(512, 0, 'icon-512'); icon(512, 0.12, 'maskable-512'); icon(180, 0, 'apple-touch-icon')
