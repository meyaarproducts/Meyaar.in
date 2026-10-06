#!/usr/bin/env python3
"""
Meyaar — turn an Amazon Category Listings Report into data/products.csv
Usage:  python3 tools/build_catalogue.py  <report.zip or folder>  [--out data/products.csv]
Re-run this whenever you download a fresh report from Seller Central.
Your manual edits to category/subcategory/featured/sort/hide/new are preserved by SKU.
"""
import sys, os, csv, re, zipfile, tempfile, glob
import openpyxl

C = dict(status=0, title=1, sku=2, ptype=3, parentage=5, parent=6, theme=7,
         item_name=8, highlight=9, brand=10, asin=12, browse=13,
         model_no=20, model_name=21, img_main=39, img_other=range(40, 48), img_swatch=48,
         desc=49, bullets=range(50, 55), material=range(71, 74),
         color_map=81, color=82, size=174, price=748, mrp=749)

def cat_for(browse, ptype, title):
    b = (browse or '').lower(); p = (ptype or '').lower(); t = (title or '').lower()
    has = lambda *w: any(x in t for x in w)
    if 'backpack' in p or 'backpack' in b or 'luggage' in b or has('duffel') or p == 'bag':
        if has('trolley', 'wheel'): return 'Bags', 'Trolley & Wheeled'
        if has('duffel', 'gym'): return 'Bags', 'Gym & Duffel'
        if has('sling', 'crossbody', 'chest bag'): return 'Bags', 'Sling & Crossbody'
        if has('vacuum', 'travel', 'cabin'): return 'Bags', 'Travel Backpacks'
        if has('laptop', 'office'): return 'Bags', 'Laptop Backpacks'
        return 'Bags', 'Backpacks'
    if has('watch strap', 'watch band', 'strap for', 'band for') or ('watch' in t and has('strap', 'band')):
        return 'Wearables', 'Watch Straps & Bands'
    if 'watch' in p or has('smart watch', 'smartwatch'): return 'Wearables', 'Smart Watches'
    if has('headphone', 'earbud', 'earphone', 'neckband', 'speaker', 'tws'):
        return 'Audio', 'Headphones & Earbuds'
    if has('keyboard', 'gaming mouse', 'gamepad', 'controller', 'mousepad', 'mouse pad'):
        return 'Gaming', 'Keyboards & Mice'
    if has('car mount', 'car holder', 'car charger', 'car phone', 'dashboard'):
        return 'Phone Accessories', 'Car & Mounts'
    if has('phone holder', 'phone mount', 'stand for phone', 'tripod', 'selfie', 'ring light', 'grip', 'lanyard', 'wrist strap', 'card holder', 'popsocket'):
        return 'Phone Accessories', 'Holders & Grips'
    if 'cover' in p or 'case' in p or has('screen protector', 'tempered', 'back cover', 'phone case'):
        return 'Phone Accessories', 'Cases & Protection'
    if has('cable', 'charger', 'adapter', 'power bank', 'powerbank', 'otg', 'hub', 'converter'):
        return 'Tech Accessories', 'Cables & Charging'
    if has('laptop stand', 'laptop sleeve', 'laptop table', 'cooling pad', 'stylus', 'webcam'):
        return 'Tech Accessories', 'Laptop & Desk'
    if has('lamp', 'light', 'bottle', 'umbrella', 'kitchen', 'home'):
        return 'Home & Utility', 'Everyday'
    if 'cover' in t or 'case' in t: return 'Phone Accessories', 'Cases & Protection'
    return 'Accessories', 'Other'

def clean(v):
    if v is None: return ''
    s = str(v).strip()
    return '' if s.lower() in ('none', 'nan') else re.sub(r'\s+', ' ', s)

def load_existing(path):
    keep = {}
    if os.path.exists(path):
        with open(path, newline='', encoding='utf-8') as f:
            for r in csv.DictReader(f):
                keep[r.get('sku', '')] = {k: r.get(k, '') for k in
                                          ('category', 'subcategory', 'featured', 'sort', 'hide', 'new')}
    return keep

def rows_from(xlsm):
    wb = openpyxl.load_workbook(xlsm, read_only=True, data_only=True)
    ws = wb['Template']
    for i, r in enumerate(ws.iter_rows(min_row=1, values_only=True), 1):
        if i <= 5: continue
        yield list(r) + [''] * 20

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'report'
    out = 'data/products.csv'
    if '--out' in sys.argv: out = sys.argv[sys.argv.index('--out') + 1]
    tmp = None
    if src.lower().endswith('.zip'):
        tmp = tempfile.mkdtemp(); zipfile.ZipFile(src).extractall(tmp); src = tmp
    files = sorted(glob.glob(os.path.join(src, '*.xlsm')) + glob.glob(os.path.join(src, '*.xlsx')))
    if not files: sys.exit('No .xlsm/.xlsx found in ' + src)

    keep = load_existing(out)
    seen, items = set(), []
    for f in files:
        for r in rows_from(f):
            brand = clean(r[C['brand']])
            main = clean(r[C['img_main']])
            sku = clean(r[C['sku']])
            if not sku or sku in seen: continue
            if 'meyaar' not in brand.lower(): continue          # skips Amazon's example rows
            if clean(r[C['parentage']]).lower() == 'parent': continue
            if not main.startswith('http'): continue
            seen.add(sku)
            title = clean(r[C['item_name']]) or clean(r[C['title']])
            browse = clean(r[C['browse']])
            cat, sub = cat_for(browse, clean(r[C['ptype']]), title)
            prev = keep.get(sku, {})
            imgs = [clean(r[i]) for i in C['img_other']]
            imgs = [i for i in imgs if i.startswith('http')][:5]
            items.append(dict(
                sku=sku,
                asin=clean(r[C['asin']]),
                group=clean(r[C['parent']]) or sku,
                title=title,
                short_title=title.split(',')[0][:70],
                brand=brand,
                category=prev.get('category') or cat,
                subcategory=prev.get('subcategory') or sub,
                colour=clean(r[C['color_map']]) or clean(r[C['color']]),
                variant_label=clean(r[C['color']]) or clean(r[C['size']]),
                model=clean(r[C['model_no']]) or clean(r[C['model_name']]),
                price=clean(r[C['price']]), mrp=clean(r[C['mrp']]),
                rating='', reviews='',
                bullet1=clean(r[50]), bullet2=clean(r[51]), bullet3=clean(r[52]),
                bullet4=clean(r[53]), bullet5=clean(r[54]),
                description=clean(r[C['desc']]),
                material=' / '.join([x for x in (clean(r[i]) for i in C['material']) if x]),
                amazon_url='https://www.amazon.in/dp/' + clean(r[C['asin']]) if clean(r[C['asin']]).startswith('B0') else '',
                image_main=main,
                image_1=imgs[0] if len(imgs) > 0 else '', image_2=imgs[1] if len(imgs) > 1 else '',
                image_3=imgs[2] if len(imgs) > 2 else '', image_4=imgs[3] if len(imgs) > 3 else '',
                image_5=imgs[4] if len(imgs) > 4 else '',
                swatch=clean(r[C['img_swatch']]),
                featured=prev.get('featured', ''), sort=prev.get('sort', ''), hide=prev.get('hide', ''), new=prev.get('new', ''),
            ))
    cols = list(items[0].keys())
    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    with open(out, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(items)
    groups = len({i['group'] for i in items})
    print(f'{len(items)} listings  ->  {groups} products  ->  {out}')
    from collections import Counter
    for (c, s), n in sorted(Counter((i['category'], i['subcategory']) for i in items).items()):
        print(f'  {c:20} {s:24} {n}')

main()
