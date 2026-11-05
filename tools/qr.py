"""Génère le QR code d'un ouvrage (PNG, SVG) et son étiquette de chantier à imprimer (PDF),
puis relit le QR produit pour vérifier qu'il contient bien l'adresse attendue.

Usage :
    pip install segno reportlab opencv-python-headless
    python tools/qr.py https://<compte>.github.io/<depot>/A2-PM106/ A2-PM106 "A2 PM 106" "Tour A2, étage R+1, noyau central" [logo.png]
"""
import os
import sys

import segno
from reportlab.lib.colors import HexColor
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
INK = '#1e2428'
PINK = '#d1126f'


def make_qr(url, ref):
    out = os.path.join(ROOT, 'qr')
    os.makedirs(out, exist_ok=True)
    qr = segno.make(url, error='q', micro=False)
    svg = os.path.join(out, f'{ref}.svg')
    png = os.path.join(out, f'{ref}.png')
    qr.save(svg, scale=10, border=4, dark=INK, light='#ffffff', xmldecl=False, svgns=True, title=f'Passeport {ref}')
    qr.save(png, scale=24, border=4, dark=INK, light='#ffffff')
    return qr, svg, png


def check(png, url):
    try:
        import cv2
    except ImportError:
        print('Vérification ignorée : installez opencv-python-headless pour relire le QR.')
        return None
    img = cv2.imread(png)
    data, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
    ok = data == url
    print(('QR vérifié : ' if ok else 'ÉCHEC de la relecture du QR : ') + repr(data))
    return ok


def label_pdf(qr, url, ref, title, place, logo=None):
    fonts = os.path.join(HERE, 'fonts')
    pdfmetrics.registerFont(TTFont('Stencil', os.path.join(fonts, 'BigShouldersStencilDisplay-ExtraBold.ttf')))
    pdfmetrics.registerFont(TTFont('Archivo', os.path.join(fonts, 'Archivo-Regular.ttf')))
    pdfmetrics.registerFont(TTFont('Archivo-Bold', os.path.join(fonts, 'Archivo-Bold.ttf')))
    W, H = 150 * mm, 100 * mm  # étiquette 150 x 100 mm (A6 paysage)
    path = os.path.join(ROOT, 'qr', f'Etiquette_{ref}.pdf')
    c = canvas.Canvas(path, pagesize=(W, H))
    c.setTitle(f'Étiquette QR {title}')
    # cadre et bande de marquage
    c.setStrokeColor(HexColor(INK)); c.setLineWidth(1.2)
    c.roundRect(3 * mm, 3 * mm, W - 6 * mm, H - 6 * mm, 3 * mm)
    c.setFillColor(HexColor(PINK)); c.rect(3 * mm, H - 13 * mm, W - 6 * mm, 10 * mm, stroke=0, fill=1)
    c.setFillColor(HexColor('#ffffff')); c.setFont('Archivo-Bold', 10)
    c.drawString(8 * mm, H - 9.6 * mm, 'Passeport numérique d\'ouvrage — Domaine de Fontbelleau')
    # QR (dessiné en vecteurs, sans perte)
    size = 62 * mm
    x0, y0 = W - size - 9 * mm, 14 * mm
    m = qr.matrix
    n = len(m)
    border = 2
    cell = size / (n + 2 * border)
    c.setFillColor(HexColor('#ffffff')); c.rect(x0, y0, size, size, stroke=0, fill=1)
    c.setFillColor(HexColor(INK))
    for r, row in enumerate(m):
        for col, v in enumerate(row):
            if v:
                c.rect(x0 + (col + border) * cell, y0 + size - (r + border + 1) * cell, cell + 0.05, cell + 0.05, stroke=0, fill=1)
    # référence au pochoir
    c.setFillColor(HexColor(INK)); c.setFont('Stencil', 46)
    c.drawString(9 * mm, H - 33 * mm, title)
    c.setStrokeColor(HexColor(PINK)); c.setLineWidth(3.2); c.setLineCap(1)
    tw = c.stringWidth(title, 'Stencil', 46)
    c.line(9 * mm, H - 36.5 * mm, 9 * mm + tw, H - 35.5 * mm)
    c.setFont('Archivo', 10.5); c.setFillColor(HexColor('#56616a'))
    c.drawString(9 * mm, H - 44 * mm, place)
    c.setFont('Archivo-Bold', 13); c.setFillColor(HexColor(INK))
    c.drawString(9 * mm, 38 * mm, 'Scannez pour ouvrir')
    c.drawString(9 * mm, 32 * mm, 'le passeport de l\'ouvrage')
    c.setFont('Archivo', 8.5); c.setFillColor(HexColor('#56616a'))
    c.drawString(9 * mm, 24 * mm, 'Identité, plans, planning et suivi.')
    c.drawString(9 * mm, 20 * mm, 'Aucune application à installer.')
    short = url.replace('https://', '')
    c.setFont('Archivo', 6.5)
    if c.stringWidth(short, 'Archivo', 6.5) <= size:
        c.drawCentredString(x0 + size / 2, 9 * mm, short)
    else:
        host, _, path = short.partition('/')
        c.drawCentredString(x0 + size / 2, 10.6 * mm, host)
        c.drawCentredString(x0 + size / 2, 7.6 * mm, '/' + path)
    if logo and os.path.exists(logo):
        from reportlab.lib.utils import ImageReader
        img = ImageReader(logo)
        iw, ih = img.getSize()
        h = 7 * mm
        c.drawImage(img, 9 * mm, 7.5 * mm, width=h * iw / ih, height=h, mask='auto')
    c.showPage(); c.save()
    return path


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    url, ref = sys.argv[1], sys.argv[2]
    title = sys.argv[3] if len(sys.argv) > 3 else ref
    place = sys.argv[4] if len(sys.argv) > 4 else ''
    logo = sys.argv[5] if len(sys.argv) > 5 else os.path.join(ROOT, 'assets', 'img', 'veck-construction.png')
    qr, svg, png = make_qr(url, ref)
    ok = check(png, url)
    pdf = label_pdf(qr, url, ref, title, place, logo)
    print('Fichiers :', svg, png, pdf, sep='\n  ')
    sys.exit(0 if ok in (True, None) else 2)
