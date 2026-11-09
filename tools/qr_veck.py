"""QR codes et étiquettes aux couleurs de Veck Construction (noir et doré du logo).

Le QR reste noir sur blanc (lecture fiable) ; le logo VECK est placé au centre,
en correction d'erreur maximale (H, jusqu'à 30 % du code récupérable), et des
équerres dorées l'encadrent hors de la zone de silence. Chaque QR produit est
relu (taille normale et taille réduite) avant d'être conservé.

Usage :
    pip install segno reportlab pillow opencv-python-headless
    python tools/qr_veck.py            # les deux QR du démonstrateur
Fichiers produits dans qr/ :
    Veck_<ref>.png                     QR seul, 2 000 px environ
    Etiquette_Veck_<ref>.pdf           étiquette 150 x 100 mm, vectorielle
"""
import os
import sys

import segno
from PIL import Image, ImageDraw
from reportlab.lib.colors import HexColor
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
IMG = os.path.join(ROOT, 'assets', 'img')
BLACK = '#0b0b0b'
GOLD = '#b89462'      # doré relevé sur le logo
GOLD_DARK = '#9c7a4a'
GREY = '#5b5b5b'
BASE = 'https://lucasdupuymontbrun-del.github.io/passeport-fontbelleau/'

QRS = [
    dict(ref='Projet-Fontbelleau', url=BASE, eyebrow='MAQUETTE NUMÉRIQUE DU PROJET',
         title='Fontbelleau', place='Tours A1 et A2, parking, fondations et abords',
         cta=('Scannez pour ouvrir', 'la maquette du projet'),
         sub=('Touchez un ouvrage pour voir sa fiche.', 'Aucune application à installer.')),
    dict(ref='A2-PM106', url=BASE + 'A2-PM106/', eyebrow='PASSEPORT NUMÉRIQUE D’OUVRAGE',
         title='A2 PM 106', place='Tour A2, étage R+1, noyau central',
         cta=('Scannez pour ouvrir', 'le passeport de l’ouvrage'),
         sub=('Identité, plans, planning et suivi.', 'Aucune application à installer.')),
]


def mark_image():
    """Logo « VECK » (avec la jambe dorée du K), sans « onstruction »."""
    im = Image.open(os.path.join(IMG, 'veck-construction.png')).convert('RGBA')
    im = im.crop((0, 0, 620, im.height))
    px = im.load()
    for y in range(im.height):
        for x in range(585, im.width):
            r, g, b, a = px[x, y]
            if a and r - b <= 35:   # garde seulement le doré à droite
                px[x, y] = (0, 0, 0, 0)
    return im.crop(im.getbbox())


def logo_on_black():
    """Logo complet en blanc et doré, pour la bande noire."""
    im = Image.open(os.path.join(IMG, 'veck-construction.png')).convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a and r - b <= 35:
                px[x, y] = (255, 255, 255, a)
    return im.crop(im.getbbox())


def hole(n, aspect):
    """Zone centrale (en modules) laissée blanche pour le logo, impaire et centrée."""
    w = int(n * 0.36) | 1
    h = max(5, int(round(w / aspect)) + 2) | 1
    c0, r0 = (n - w) // 2, (n - h) // 2
    return c0, r0, w, h


def qr_matrix(url):
    qr = segno.make(url, error='h', micro=False, boost_error=False)
    return qr, [list(r) for r in qr.matrix]


def render_png(url, path, mark, module=40, quiet=4, frame=2):
    qr, m = qr_matrix(url)
    n = len(m)
    c0, r0, w, h = hole(n, mark.width / mark.height)
    pad = quiet + frame
    size = (n + 2 * pad) * module
    im = Image.new('RGB', (size, size), 'white')
    d = ImageDraw.Draw(im)
    for r in range(n):
        for c in range(n):
            if m[r][c] and not (c0 <= c < c0 + w and r0 <= r < r0 + h):
                x, y = (c + pad) * module, (r + pad) * module
                d.rectangle([x, y, x + module - 1, y + module - 1], fill=BLACK)
    # logo au centre
    bw, bh = (w - 1) * module, (h - 1) * module
    k = min(bw / mark.width, bh / mark.height)
    lg = mark.resize((int(mark.width * k), int(mark.height * k)), Image.LANCZOS)
    im.paste(lg, ((size - lg.width) // 2, (size - lg.height) // 2), lg)
    # équerres dorées, hors de la zone de silence
    t, L, e = int(module * 0.55), int(size * 0.16), int(module * 0.6)
    for sx in (0, 1):
        for sy in (0, 1):
            x = e if sx == 0 else size - e - 1
            y = e if sy == 0 else size - e - 1
            dx, dy = (1 if sx == 0 else -1), (1 if sy == 0 else -1)
            d.rectangle([min(x, x + dx * L), min(y, y + dy * t), max(x, x + dx * L), max(y, y + dy * t)], fill=GOLD)
            d.rectangle([min(x, x + dx * t), min(y, y + dy * L), max(x, x + dx * t), max(y, y + dy * L)], fill=GOLD)
    im.save(path, optimize=True)
    return qr, m, (c0, r0, w, h)


def check(path, url):
    import cv2
    img = cv2.imread(path)
    ok = True
    for px in (img.shape[0], 420, 260):   # pleine taille, puis réduite (impression petite, photo floue)
        small = cv2.resize(img, (px, px), interpolation=cv2.INTER_AREA)
        data, _, _ = cv2.QRCodeDetector().detectAndDecode(small)
        print(f'  relecture {px:>4} px :', 'OK' if data == url else f'ÉCHEC ({data!r})')
        ok &= data == url
    return ok


def fonts():
    f = os.path.join(HERE, 'fonts')
    pdfmetrics.registerFont(TTFont('Archivo', os.path.join(f, 'Archivo-Regular.ttf')))
    pdfmetrics.registerFont(TTFont('Archivo-Bold', os.path.join(f, 'Archivo-Bold.ttf')))
    pdfmetrics.registerFont(TTFont('Archivo-XB', os.path.join(f, 'Archivo-ExtraBold.ttf')))
    pdfmetrics.registerFont(TTFont('Archivo-Black', os.path.join(f, 'Archivo-Black.ttf')))


def spaced(c, x, y, text, font, size, track):
    c.setFont(font, size)
    for ch in text:
        c.drawString(x, y, ch)
        x += c.stringWidth(ch, font, size) + track
    return x


def label_pdf(spec, m, holebox, mark, logo_w):
    W, H = 150 * mm, 100 * mm
    path = os.path.join(ROOT, 'qr', f"Etiquette_Veck_{spec['ref']}.pdf")
    c = canvas.Canvas(path, pagesize=(W, H))
    c.setTitle(f"Étiquette QR {spec['title']} — Veck Construction")
    c.setAuthor('Veck Construction — démonstrateur ESCT')
    ins, rad = 3 * mm, 3 * mm
    p = c.beginPath(); p.roundRect(ins, ins, W - 2 * ins, H - 2 * ins, rad)
    c.saveState(); c.clipPath(p, stroke=0, fill=0)
    # bande haute noire + biseau doré (rappel de la jambe du K)
    band = 19 * mm
    c.setFillColor(HexColor(BLACK)); c.rect(0, H - ins - band, W, band + ins, stroke=0, fill=1)
    c.setFillColor(HexColor(GOLD))
    bx = W - 30 * mm
    q = c.beginPath(); q.moveTo(bx, H - ins - band); q.lineTo(bx + 9 * mm, H - ins - band); q.lineTo(bx + 9 * mm + band, H); q.lineTo(bx + band, H); q.close()
    c.drawPath(q, stroke=0, fill=1)
    # bande basse noire
    foot = 8.5 * mm
    c.setFillColor(HexColor(BLACK)); c.rect(0, 0, W, ins + foot, stroke=0, fill=1)
    c.restoreState()
    c.setStrokeColor(HexColor(BLACK)); c.setLineWidth(0.8)
    c.roundRect(ins, ins, W - 2 * ins, H - 2 * ins, rad, stroke=1, fill=0)

    # logo blanc et doré
    lh = 8.2 * mm
    c.drawImage(ImageReader(logo_w), 9 * mm, H - ins - band / 2 - lh / 2, width=lh * logo_w.width / logo_w.height, height=lh, mask='auto')
    c.setFillColor(HexColor(GOLD))
    c.setFont('Archivo-XB', 7.4)
    c.drawRightString(bx - 4 * mm, H - ins - 7.6 * mm, 'DOMAINE DE FONTBELLEAU')
    c.setFillColor(HexColor('#ffffff')); c.setFont('Archivo', 7.2)
    c.drawRightString(bx - 4 * mm, H - ins - 12.4 * mm, 'Démonstrateur numérique')

    # QR vectoriel
    size = 56 * mm
    x0, y0 = W - size - 11 * mm, ins + foot + 5.4 * mm
    n = len(m)
    border = 2
    cell = size / (n + 2 * border)
    c0, r0, w, h = holebox
    c.setFillColor(HexColor(BLACK))
    for r in range(n):
        for col in range(n):
            if m[r][col] and not (c0 <= col < c0 + w and r0 <= r < r0 + h):
                c.rect(x0 + (col + border) * cell, y0 + size - (r + border + 1) * cell, cell + 0.04, cell + 0.04, stroke=0, fill=1)
    bw, bh = (w - 1) * cell, (h - 1) * cell
    k = min(bw / mark.width, bh / mark.height)
    mw, mh = mark.width * k, mark.height * k
    c.drawImage(ImageReader(mark), x0 + size / 2 - mw / 2, y0 + size / 2 - mh / 2, width=mw, height=mh, mask='auto')
    # équerres dorées
    c.setStrokeColor(HexColor(GOLD)); c.setLineWidth(2.2); c.setLineCap(0); c.setLineJoin(0)
    e, L = 2.2 * mm, 9 * mm
    for sx, sy in ((0, 0), (1, 0), (0, 1), (1, 1)):
        x = x0 - e if sx == 0 else x0 + size + e
        y = y0 - e if sy == 0 else y0 + size + e
        dx = 1 if sx == 0 else -1
        dy = 1 if sy == 0 else -1
        c.lines([(x, y + dy * L, x, y), (x, y, x + dx * L, y)])

    # colonne de texte
    tx = 9 * mm
    maxw = x0 - e - 6 * mm - tx
    ty = H - ins - band - 9 * mm
    c.setFillColor(HexColor(GOLD_DARK))
    spaced(c, tx, ty, spec['eyebrow'], 'Archivo-XB', 7.4, 0.6)
    fs = 34
    while fs > 20 and c.stringWidth(spec['title'], 'Archivo-Black', fs) > maxw:
        fs -= 1
    c.setFillColor(HexColor(BLACK)); c.setFont('Archivo-Black', fs)
    c.drawString(tx - 0.6, ty - 12.5 * mm, spec['title'])
    c.setFillColor(HexColor(GOLD))
    c.rect(tx, ty - 16.6 * mm, 14 * mm, 1.3 * mm, stroke=0, fill=1)
    c.setFillColor(HexColor(GREY)); c.setFont('Archivo', 9.6)
    words, lines, cur = spec['place'].split(), [], ''
    for wd in words:
        t = (cur + ' ' + wd).strip()
        if c.stringWidth(t, 'Archivo', 9.6) > maxw and cur:
            lines.append(cur); cur = wd
        else:
            cur = t
    lines.append(cur)
    for i, ln in enumerate(lines[:2]):
        c.drawString(tx, ty - 22.5 * mm - i * 4.3 * mm, ln)
    yb = ins + foot + 17 * mm
    c.setFillColor(HexColor(BLACK)); c.setFont('Archivo-XB', 12.5)
    c.drawString(tx, yb + 5.6 * mm, spec['cta'][0])
    c.drawString(tx, yb, spec['cta'][1])
    c.setFillColor(HexColor(GREY)); c.setFont('Archivo', 8.2)
    c.drawString(tx, yb - 6.6 * mm, spec['sub'][0])
    c.drawString(tx, yb - 10.4 * mm, spec['sub'][1])

    # adresse dans la bande basse
    c.setFillColor(HexColor('#ffffff')); c.setFont('Archivo', 7)
    c.drawString(tx, ins + 3.1 * mm, spec['url'].replace('https://', ''))
    c.setFillColor(HexColor(GOLD))
    spaced(c, W - 10 * mm - c.stringWidth('VECK CONSTRUCTION', 'Archivo-XB', 7) - 16 * 0.5, ins + 3.1 * mm, 'VECK CONSTRUCTION', 'Archivo-XB', 7, 0.5)
    c.showPage(); c.save()
    return path


def main():
    fonts()
    mark, logo_w = mark_image(), logo_on_black()
    mark.save(os.path.join(IMG, 'veck-mark.png'))
    ok = True
    for spec in QRS:
        print(spec['ref'], '→', spec['url'])
        png = os.path.join(ROOT, 'qr', f"Veck_{spec['ref']}.png")
        _, m, hb = render_png(spec['url'], png, mark)
        good = check(png, spec['url'])
        ok &= good
        pdf = label_pdf(spec, m, hb, mark, logo_w)
        print('  ', os.path.relpath(png, ROOT), '|', os.path.relpath(pdf, ROOT))
    sys.exit(0 if ok else 2)


if __name__ == '__main__':
    main()
