#!/usr/bin/env python3
"""
Meyaar — refresh products.csv from Amazon Category Listings Reports.

Usage:
    python3 build_catalogue.py REPORT [REPORT ...] [--check] [--products products.csv]

REPORT is an .xlsm/.xlsx file, a folder of them, or the .zip Seller Central gives you.
--check   writes the audit files only; products.csv is not touched.

What it does
  * Reads every report by Amazon's field names (row 5 of the Template sheet), never by column position.
  * Updates ONLY ASINs that are already in products.csv. New ASINs go to catalogue_candidates.csv.
  * Amazon-owned columns are refreshed: group (parent SKU), amazon_status, variation_theme,
    dim1_value..dim3_value, title, price, mrp, bullets, description, images, swatch.
    A blank report value never erases data.
  * Meyaar-owned columns are never written: category, subcategory, hide, featured, sort, new,
    family_override, primary, primary_image, amazon_url, short_title.
  * An ASIN that appears on more than one report row is left untouched and listed for review.
  * Writes catalogue_exceptions.csv (problems to review) and catalogue_candidates.csv (ASINs not on the site).
"""
import sys, os, csv, re, zipfile, tempfile, glob, collections
import openpyxl

M = '[marketplace_id=A21TJRUUN4KGV]'
L = '[language_tag=en_IN]'
F = {
    'status':  '::listing_status',
    'sku':     'contribution_sku#1.value',
    'ptype':   'product_type#1.value',
    'parentage': 'parentage_level' + M + '#1.value',
    'parent':  'child_parent_sku_relationship' + M + '#1.parent_sku',
    'theme':   'variation_theme#1.name',
    'name':    'item_name' + M + L + '#1.value',
    'brand':   'brand' + M + L + '#1.value',
    'id_type': 'amzn1.volt.ca.product_id_type',
    'id':      'amzn1.volt.ca.product_id_value',
    'price':   'purchasable_offer' + M + '[audience=ALL]#1.our_price#1.schedule#1.value_with_tax',
    'mrp':     'purchasable_offer' + M + '[audience=ALL]#1.maximum_retail_price#1.schedule#1.value_with_tax',
    'img_main': 'main_product_image_locator' + M + '#1.media_location',
    'swatch':  'swatch_product_image_locator' + M + '#1.media_location',
    'description': 'product_description' + M + L + '#1.value',
}
BULLETS = ['bullet_point' + M + L + '#%d.value' % i for i in range(1, 6)]
IMG_OTHER = ['other_product_image_locator_%d' % i + M + '#1.media_location' for i in range(1, 9)]

# Amazon theme part -> field that holds the value
DIM_FIELD = {
    'COLOR':      'color' + M + L + '#1.value',
    'SIZE':       'size' + M + L + '#1.value',
    'BAND_COLOR': 'band' + M + '#1.color' + L + '#1.value',
    'METAL_TYPE': 'metal_type' + M + L + '#1.value',
    'MODEL':      'model_number' + M + '#1.value',
    'STYLE':      'style' + M + L + '#1.value',
    'PATTERN':    'pattern' + M + L + '#1.value',
}

NEW_COLS = ['amazon_status', 'variation_theme', 'dim1_value', 'dim2_value', 'dim3_value',
            'family_override', 'primary', 'primary_image']

INVISIBLE = re.compile('[​-‏‪-‮⁠-⁯﻿]')


def clean(v):
    if v is None: return ''
    s = INVISIBLE.sub('', str(v))
    s = re.sub(r'\s+', ' ', s).strip()
    return '' if s.lower() in ('none', 'nan') else s


def norm_theme(t):
    """'SIZE_NAME/COLOR_NAME (Deprecated: Do Not Use)' -> ['SIZE', 'COLOR'] (order kept)."""
    t = re.sub(r'\s*\(Deprecated.*$', '', clean(t), flags=re.I)
    return [p.strip().upper().replace('_NAME', '') for p in t.split('/') if p.strip()] if t else []


# ---------------------------------------------------------------- reading reports
def report_files(args):
    files = []
    for a in args:
        if a.lower().endswith('.zip'):
            tmp = tempfile.mkdtemp(); zipfile.ZipFile(a).extractall(tmp); a = tmp
        if os.path.isdir(a):
            files += sorted(glob.glob(os.path.join(a, '**', '*.xls[xm]'), recursive=True))
        else:
            files.append(a)
    return files


def read_report(path):
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True)['Template']
    rows = ws.iter_rows(values_only=True)
    keys, n = None, 0
    for r in rows:
        n += 1
        if r and F['status'] in r:              # the field-name row (row 5 in current templates)
            keys = [k if k else None for k in r]; break
    if not keys: sys.exit('No Amazon field-name row found in ' + path)
    out = []
    for r in rows:
        n += 1
        if not r or not any(r): continue
        d = {}
        for k, v in zip(keys, r):
            if k and v not in (None, ''): d[k] = clean(v)
        if d.get(F['sku']) == 'ABC123': continue     # Amazon's own example row
        if not d: continue
        d['_src'] = '%s:%d' % (os.path.basename(path), n)
        out.append(d)
    return out


def get(r, f): return r.get(F[f], '')
def asin_of(r): return get(r, 'id') if get(r, 'id_type') == 'ASIN' and get(r, 'id').startswith('B0') else ''


# ---------------------------------------------------------------- main
def main(argv):
    check = '--check' in argv
    prod = 'products.csv'
    if '--products' in argv: prod = argv[argv.index('--products') + 1]
    srcs = [a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or argv[i - 1] != '--products')]
    files = report_files(srcs)
    if not files: sys.exit(__doc__)
    R = []
    for f in files: R += read_report(f)
    print('Read %d report rows from %d file(s)' % (len(R), len(files)))

    with open(prod, newline='', encoding='utf-8-sig') as fh:
        rd = csv.DictReader(fh); cols = list(rd.fieldnames); P = list(rd)
    for c in NEW_COLS:
        if c not in cols: cols.append(c)
    for p in P:
        for c in NEW_COLS: p.setdefault(c, '')

    # --- index the report
    by_asin = collections.defaultdict(list)
    for r in R:
        if asin_of(r): by_asin[asin_of(r)].append(r)
    parents = {get(r, 'sku'): r for r in R if get(r, 'parentage') == 'Parent'}
    children = collections.defaultdict(list)
    for r in R:
        if get(r, 'parentage') == 'Child' and get(r, 'parent'): children[get(r, 'parent')].append(r)
    dup_asins = {a for a, v in by_asin.items() if len(v) > 1}

    # --- resolve each Amazon family's theme (parent's theme order wins; conflicts flagged)
    fam_theme, theme_conflict = {}, {}
    for fam, ch in children.items():
        themes = []
        if fam in parents and norm_theme(get(parents[fam], 'theme')): themes.append(norm_theme(get(parents[fam], 'theme')))
        themes += [norm_theme(get(c, 'theme')) for c in ch if norm_theme(get(c, 'theme'))]
        sets = {tuple(sorted(t)) for t in themes}
        fam_theme[fam] = themes[0] if themes else []
        if len(sets) > 1: theme_conflict[fam] = sorted('/'.join(s) for s in sets)

    def dims_for(r, theme):
        return [r.get(DIM_FIELD[d], '') if d in DIM_FIELD else '' for d in theme][:3]

    # --- refresh products.csv rows (by ASIN only)
    in_site = {p['asin'] for p in P if p['asin']}
    updated = 0
    for p in P:
        a = p['asin']
        if not a or a not in by_asin or a in dup_asins: continue
        r = by_asin[a][0]
        fam = get(r, 'parent') if get(r, 'parentage') == 'Child' else ''
        theme = (fam_theme.get(fam) if fam and fam not in theme_conflict else norm_theme(get(r, 'theme'))) or []
        if not fam: theme = []                         # standalone listing: no selectors
        dims = dims_for(r, theme) + ['', '', '']
        p['group'] = fam or p['group']
        p['amazon_status'] = get(r, 'status')
        p['variation_theme'] = '/'.join(theme)
        p['dim1_value'], p['dim2_value'], p['dim3_value'] = dims[:3]
        for col, f in (('title', 'name'), ('price', 'price'), ('mrp', 'mrp'),
                       ('image_main', 'img_main'), ('swatch', 'swatch')):
            if get(r, f): p[col] = get(r, f)
        if any(r.get(k) for k in BULLETS):
            for i, k in enumerate(BULLETS): p['bullet%d' % (i + 1)] = r.get(k, '')
        if get(r, 'description'): p['description'] = get(r, 'description')
        others = [r[k] for k in IMG_OTHER if r.get(k)]
        if others:
            for i in range(5): p['image_%d' % (i + 1)] = others[i] if i < len(others) else ''
        updated += 1

    # --- image columns must hold image links. Older positional builds put bullet text in some of them;
    #     that text is not an image, so it is cleared (real links are never touched).
    IMG_COLS = ['image_main', 'image_1', 'image_2', 'image_3', 'image_4', 'image_5', 'swatch', 'primary_image']
    cleared = 0
    for p in P:
        for c in IMG_COLS:
            if p.get(c) and not re.match(r'https?://', p[c]): p[c] = ''; cleared += 1

    # --- exceptions ---------------------------------------------------------
    EX = []
    fam_of = lambda p: p['family_override'] or p['group'] or p['sku']
    visible = lambda p: (p.get('hide') or '').lower() != 'yes'
    site_fams = {fam_of(p) for p in P if visible(p)}
    on_site = lambda fam: 'yes' if fam in site_fams else 'no'
    def ex(typ, fam, a='', sku='', detail=''):
        EX.append(dict(type=typ, family=fam, on_site=on_site(fam) if fam else '', asin=a, sku=sku, detail=detail))

    for a in sorted(dup_asins):
        for r in by_asin[a]:
            ex('duplicate_asin', get(r, 'parent') or '(standalone)', a, get(r, 'sku'),
               'parentage=%s | theme=%s | colour=%s | size=%s | band=%s | status=%s | %s' % (
                   get(r, 'parentage') or '-', get(r, 'theme') or '-', r.get(DIM_FIELD['COLOR'], '-'),
                   r.get(DIM_FIELD['SIZE'], '-'), r.get(DIM_FIELD['BAND_COLOR'], '-'), get(r, 'status'), r['_src']))

    simple = collections.defaultdict(set)
    for fam, ch in sorted(children.items()):
        live = [c for c in ch if get(c, 'status') == 'Active']
        theme = fam_theme.get(fam, [])
        if fam in theme_conflict:
            ex('theme_conflict', fam, detail='themes: ' + ' vs '.join(theme_conflict[fam])); simple[fam].add('theme_conflict')
        for d in theme:
            if d not in DIM_FIELD:
                ex('unsupported_theme_part', fam, detail=d); simple[fam].add('unsupported_theme_part')
        if fam not in theme_conflict and theme:
            combos = collections.defaultdict(list)
            for c in live:
                v = dims_for(c, theme)
                if any(not x for x in v):
                    ex('missing_value', fam, asin_of(c), get(c, 'sku'),
                       'theme=%s values=%s' % ('/'.join(theme), ' | '.join(x or '(blank)' for x in v)))
                    simple[fam].add('missing_value')
                combos[tuple(v)].append(c)
            for v, cs in combos.items():
                if len(cs) > 1:
                    ex('duplicate_combination', fam, ' '.join(asin_of(c) or '(no ASIN)' for c in cs),
                       ' '.join(get(c, 'sku') for c in cs), 'values=' + ' | '.join(v))
                    simple[fam].add('duplicate_combination')
            seen = collections.Counter(asin_of(c) for c in live if asin_of(c))
            for a, n in seen.items():
                if n > 1:
                    ex('asin_repeated_in_family', fam, a, detail='%d child rows share this ASIN' % n)
                    simple[fam].add('asin_repeated_in_family')
            for d in ('SIZE', 'COLOR'):
                if d not in theme and len({c.get(DIM_FIELD[d], '') for c in live if c.get(DIM_FIELD[d])}) > 1:
                    ex('undeclared_dimension', fam, detail='theme %s, but %s also varies: %s' % (
                        '/'.join(theme), d, ' | '.join(sorted({c.get(DIM_FIELD[d]) for c in live if c.get(DIM_FIELD[d])})[:6])))
            # hint only — values that read like packs/configurations under a COLOR dimension
            if 'COLOR' in theme:
                vals = sorted({c.get(DIM_FIELD['COLOR'], '') for c in live})
                hits = [v for v in vals if re.search(r'\bpack\b|\bpiece|\bpcs\b|\bkit\b|\bwith\b|\bonly\b', v, re.I)]
                if hits: ex('label_review_hint', fam, detail='COLOR values that may not be colours: ' + ' | '.join(hits[:6]))
        if fam not in parents:
            ex('orphan_parent', fam, detail='%d child rows point to a parent SKU with no parent row' % len(ch))
        for c in ch:
            if get(c, 'status') == 'Active' and not asin_of(c):
                ex('child_without_asin', fam, '', get(c, 'sku'), 'id type=%s' % (get(c, 'id_type') or '(blank)'))
    for fam, why in sorted(simple.items()):
        ex('simple_mode_family', fam, detail='temporary single-selector fallback; reasons: ' + ', '.join(sorted(why)))

    for p in P:
        a = p['asin']
        if not a:
            ex('no_asin_in_products_csv', fam_of(p), '', p['sku'], 'hide=%s' % (p['hide'] or 'no'))
        elif a not in by_asin:
            ex('not_in_report', fam_of(p), a, p['sku'], 'hide=%s | kept unchanged' % (p['hide'] or 'no'))
        elif a in dup_asins:
            ex('duplicate_asin_not_refreshed', fam_of(p), a, p['sku'], 'products.csv row left exactly as it was')
        elif p['amazon_status'] == 'Removed':
            ex('removed_on_amazon', fam_of(p), a, p['sku'], 'hide=%s' % (p['hide'] or 'no'))

    # hidden siblings: hide=yes rows whose family already shows at least one row on the site
    for p in P:
        if not visible(p) and fam_of(p) in site_fams:
            ex('hidden_sibling_pending_review', fam_of(p), p['asin'], p['sku'],
               'status=%s | %s' % (p['amazon_status'] or '-', p['title'][:90]))

    # --- candidates: Active Meyaar listings with an ASIN that are not in products.csv
    CAND = []
    for a, rs in sorted(by_asin.items()):
        if a in in_site: continue
        r = rs[0]
        if get(r, 'status') != 'Active' or get(r, 'parentage') == 'Parent': continue
        if get(r, 'brand').lower() != 'meyaar': continue
        fam = get(r, 'parent') if get(r, 'parentage') == 'Child' else ''
        theme = fam_theme.get(fam, []) if fam else []
        dims = dims_for(r, theme) + ['', '', '']
        CAND.append(dict(asin=a, sku=get(r, 'sku'), parent_sku=fam, family_on_site=on_site(fam) if fam else 'no',
                         variation_theme='/'.join(theme), dim1_value=dims[0], dim2_value=dims[1], dim3_value=dims[2],
                         has_image='yes' if get(r, 'img_main') else 'no', duplicate_asin='yes' if a in dup_asins else '',
                         amazon_product_type=get(r, 'ptype'), title=get(r, 'name'), image_main=get(r, 'img_main'),
                         category='', subcategory=''))

    with open('catalogue_exceptions.csv', 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=['type', 'family', 'on_site', 'asin', 'sku', 'detail'])
        w.writeheader(); w.writerows(EX)
    with open('catalogue_candidates.csv', 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=list(CAND[0].keys()) if CAND else ['asin'])
        w.writeheader(); w.writerows(CAND)

    if not check:
        with open(prod, 'w', newline='', encoding='utf-8') as fh:
            w = csv.DictWriter(fh, fieldnames=cols); w.writeheader(); w.writerows(P)

    print('%s products.csv: %d rows refreshed from the report%s' % (
        'Checked' if check else 'Updated', updated, ' (not written: --check)' if check else ''))
    if cleared: print('  cleared %d image cells that held text instead of an image link' % cleared)
    for t, n in collections.Counter(e['type'] for e in EX).most_common():
        print('  %-32s %d' % (t, n))
    print('catalogue_candidates.csv: %d ASINs not on the site (%d with an image)' % (
        len(CAND), sum(c['has_image'] == 'yes' for c in CAND)))


if __name__ == '__main__':
    main(sys.argv[1:])
