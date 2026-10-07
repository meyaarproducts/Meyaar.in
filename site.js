/* ============================================================
   Meyaar — site engine
   Reads the CSV files in /data and renders every page.
   You never need to edit this file to change products or text.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- tiny helpers ---------- */
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var qs = function (k) { return new URLSearchParams(location.search).get(k) || ''; };
  var slug = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
  var money = function (v) {
    var n = parseFloat(v); if (!n || isNaN(n)) return '';
    return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  };
  /* Ask Amazon's image server for a smaller file — much faster pages */
  var img = function (url, px) {
    if (!url || !/^https?:\/\//.test(url)) return '';
    return url.replace(/\.(jpg|jpeg|png)(\?.*)?$/i, '._SL' + px + '_.$1');
  };

  /* ---------- CSV parser (handles quotes, commas, newlines) ---------- */
  function parseCSV(text) {
    var rows = [], row = [], val = '', q = false;
    text = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { val += '"'; i++; } else q = false; }
        else val += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(val); val = ''; }
      else if (c === '\n') { row.push(val); rows.push(row); row = []; val = ''; }
      else val += c;
    }
    if (val !== '' || row.length) { row.push(val); rows.push(row); }
    if (!rows.length) return [];
    var head = rows.shift().map(function (h) { return h.trim(); });
    return rows.filter(function (r) { return r.some(function (c) { return c !== ''; }); })
      .map(function (r) {
        var o = {}; head.forEach(function (h, j) { o[h] = (r[j] || '').trim(); }); return o;
      });
  }

  function load(path) {
    return fetch(path, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' — ' + r.status);
      return r.text();
    }).then(parseCSV);
  }

  /* ---------- data model ---------- */
  var DATA = { products: [], groups: [], cats: [], site: {}, families: {} };

  var sortOf = function (r) { var n = parseInt(r.sort, 10); return isNaN(n) ? 1e9 : n; };
  var yes = function (v) { return String(v || '').toLowerCase() === 'yes'; };
  var uniq = function (a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); };

  /* A row is on the site unless you hid it or Amazon removed it */
  var isLive = function (r) { return !yes(r.hide) && String(r.amazon_status || '').toLowerCase() !== 'removed'; };
  /* Family = your override, else Amazon's parent SKU, else the listing on its own. Nothing else. */
  var familyKey = function (r) { return r.family_override || r.group || r.sku; };
  var rowKey = function (r) { return r.asin || r.sku; };

  /* Amazon variation theme part -> default selector label (families.csv can override per family) */
  var DIM_LABEL = { COLOR: 'Colour', SIZE: 'Size', BAND_COLOR: 'Band Colour', METAL_TYPE: 'Material',
                    MODEL: 'Model', STYLE: 'Style', PATTERN: 'Pattern' };
  var SWATCH_DIMS = { COLOR: 1, BAND_COLOR: 1, PATTERN: 1 };
  /* Display order of selectors (Amazon lists themes as COLOR/SIZE or SIZE/COLOR; customers always see Colour first) */
  var DIM_ORDER = ['COLOR', 'BAND_COLOR', 'PATTERN', 'SIZE', 'METAL_TYPE', 'MODEL', 'STYLE'];
  var dimRank = function (d) { var i = DIM_ORDER.indexOf(d.key); return i < 0 ? 99 : i; };
  var plural = function (label, n) {
    var l = label.toLowerCase();
    return n + ' ' + (n === 1 || /s$/.test(l) ? l : l + 's');
  };

  function buildGroups(rows) {
    var map = {}, order = [];
    rows.forEach(function (r) {
      if (!isLive(r)) return;
      var k = familyKey(r);
      if (!map[k]) { map[k] = { id: k, variants: [], order: order.length }; order.push(k); }
      map[k].variants.push(r);
    });
    return order.map(function (k) { return describeFamily(map[k]); });
  }

  /* Work out the family's representative child and its variation selectors.
     matrix: one selector per Amazon dimension; every child is one exact combination.
     simple: the data can't be trusted as a grid (flagged) — one neutral selector listing each child.
     single: one child, no selector. */
  function describeFamily(p) {
    var v = p.variants, fam = DATA.families[p.id] || {};
    var rep = v.filter(function (x) { return yes(x.primary); })[0] ||
              v.slice().sort(function (a, b) { return sortOf(a) - sortOf(b); })[0];
    p.rep = rep;
    p.title = rep.short_title || rep.title;
    p.full_title = rep.title;
    p.category = rep.category; p.subcategory = rep.subcategory;
    p.price = rep.price; p.mrp = rep.mrp; p.model = rep.model;
    var prices = v.map(function (x) { return parseFloat(x.price); }).filter(function (n) { return n > 0; });
    p.priceMin = prices.length ? Math.min.apply(null, prices) : 0;
    p.priceVaries = prices.length > 1 && Math.max.apply(null, prices) !== p.priceMin;
    p.image = rep.primary_image || rep.image_main;
    p.sort = Math.min.apply(null, v.map(sortOf));
    p.featured = v.some(function (x) { return yes(x.featured); });
    p.isNew = v.some(function (x) { return yes(x['new']); });
    p.dims = []; p.issues = [];
    p.mode = v.length > 1 ? 'matrix' : 'single';

    if (p.mode === 'matrix') {
      var themes = uniq(v.map(function (x) { return x.variation_theme || ''; }));
      var parts = themes.length === 1 && themes[0] ? themes[0].split('/').slice(0, 3) : [];
      if (!parts.length) p.issues.push(themes.length > 1 ? 'mixed or missing variation theme' : 'no variation theme');
      var seenCombo = {}, seenAsin = {};
      v.forEach(function (x) {
        x._vals = parts.map(function (d, i) { return x['dim' + (i + 1) + '_value'] || ''; });
        if (parts.length && x._vals.some(function (y) { return !y; })) p.issues.push('missing value');
        var c = x._vals.join('\u0001');
        if (parts.length && seenCombo[c]) p.issues.push('duplicate combination');
        seenCombo[c] = 1;
        if (x.asin && seenAsin[x.asin]) p.issues.push('ASIN repeated');
        seenAsin[x.asin] = 1;
      });
      p.issues = uniq(p.issues);
      if (p.issues.length) p.mode = 'simple';
      else {
        parts.forEach(function (d, i) {
          var values = uniq(v.map(function (x) { return x._vals[i]; }));
          var dim = { key: d, idx: i, label: fam['dim' + (i + 1) + '_label'] || DIM_LABEL[d] || d,
                      swatch: !!SWATCH_DIMS[d], values: values };
          if (values.length > 1) p.dims.push(dim);
        });
        p.dims.sort(function (a, b) { return dimRank(a) - dimRank(b) || a.idx - b.idx; });
        /* keep only the dimensions that actually vary, in display order */
        v.forEach(function (x) { x._vals = p.dims.map(function (d) { return x._vals[d.idx]; }); });
      }
    }
    if (p.mode === 'simple') {
      var count = {};
      v.forEach(function (x) {
        var base = [x.dim1_value, x.dim2_value, x.dim3_value].filter(Boolean).join(' · ') ||
                   x.colour || x.variant_label || x.asin || x.sku;
        count[base] = (count[base] || 0) + 1;
        x._vals = [count[base] > 1 ? base + ' (' + count[base] + ')' : base];
      });
      p.dims = [{ key: 'OPTION', idx: 0, label: 'Option', swatch: true, values: v.map(function (x) { return x._vals[0]; }) }];
    }
    if (p.mode === 'single') v.forEach(function (x) { x._vals = []; });
    p.summary = p.mode === 'simple' ? plural('option', v.length)
      : p.dims.map(function (d) { return plural(d.label, d.values.length); }).join(' · ');
    return p;
  }

  /* The live child matching an exact combination of selected values, or null */
  function matchChild(grp, vals) {
    return grp.variants.filter(function (x) {
      return x._vals.every(function (y, i) { return y === vals[i]; });
    })[0] || null;
  }

  /* ---------- customer-facing category labels (product data values stay unchanged) ---------- */
  var trimAll = function (a) { return a.map(function (x) { return x.trim(); }); };
  function catOf(c) { return DATA.cats.filter(function (x) { return x.category === c; })[0] || { category: c, label: c }; }
  function catLabel(c) { return catOf(c).label || c; }
  function subLabel(c, sub) {
    var x = catOf(c), subs = trimAll((x.subcategories || '').split('|')), labs = trimAll((x.subcategory_labels || '').split('|'));
    var i = subs.indexOf(sub);
    return (i >= 0 && labs[i]) || sub;
  }
  /* product families in a category (and optional subcategory) */
  function famsIn(c, sub) {
    return DATA.groups.filter(function (g) { return g.category === c && (!sub || g.subcategory === sub); });
  }
  /* subcategories that hold at least one family, in categories.csv order */
  function subsIn(c) {
    var order = trimAll((catOf(c).subcategories || '').split('|')), have = [];
    famsIn(c).forEach(function (g) { if (g.subcategory && have.indexOf(g.subcategory) < 0) have.push(g.subcategory); });
    var r = function (x) { var i = order.indexOf(x); return i < 0 ? 999 : i; };
    return have.sort(function (a, b) { return r(a) - r(b) || (a < b ? -1 : a > b ? 1 : 0); });
  }
  function navCats() {
    return DATA.cats.filter(function (c) { return yes(c.show_in_nav) && famsIn(c.category).length; });
  }
  var bestFirst = function (a, b) { return a.sort - b.sort || a.order - b.order; };
  function thumbFor(c, sub) { var g = famsIn(c, sub).sort(bestFirst)[0]; return g ? g.image : ''; }
  var catURL = function (c, sub) {
    return 'category.html?c=' + encodeURIComponent(c) + (sub ? '&s=' + encodeURIComponent(sub) : '');
  };

  /* ---------- shared chrome ---------- */
  function navHTML(active) {
    var s = DATA.site;
    var cats = navCats(), isCat = cats.some(function (c) { return c.category === active; });
    var chev = '<svg class="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return '<div class="announce"><span class="opt">Official Meyaar brand store <span class="dot"></span> </span>' +
      'Every product is sold and fulfilled by <b>Amazon India</b>' +
      '<span class="opt"> <span class="dot"></span> Bulk &amp; corporate orders welcome</span></div>' +
      '<header class="nav" id="nav"><div class="nav__inner">' +
      '<a href="index.html" class="brand"><img class="brand__logo" src="logo.png" alt="Meyaar"></a>' +
      '<nav class="nav__links" aria-label="Main">' +
      '<a class="nav__link' + (active === 'home' ? ' active' : '') + '" href="index.html">Home</a>' +
      '<button type="button" class="nav__link nav__cats' + (isCat ? ' active' : '') + '" id="catsBtn" aria-expanded="false" aria-controls="mega">Categories ' + chev + '</button>' +
      '<a class="nav__link" href="index.html#new">New Arrivals</a>' +
      '<a class="nav__link' + (active === 'about' ? ' active' : '') + '" href="about.html">About</a>' +
      '<a class="nav__link' + (active === 'bulk' ? ' active' : '') + '" href="bulk.html">Bulk Orders</a>' +
      '</nav>' +
      '<button type="button" class="icon-btn nav__search" id="searchBtn" aria-label="Search products" aria-controls="search"><svg><use href="#i-search"/></svg></button>' +
      '<div class="nav__actions"><a href="' + esc(s.amazon_store_url || '#') + '" target="_blank" rel="noopener" class="btn btn--amazon btn--sm">Shop on Amazon <svg><use href="#i-ext"/></svg></a></div>' +
      '<button class="burger" id="burger" aria-label="Menu"><span></span><span></span><span></span></button>' +
      '</div>' +
      /* mega menu: category -> accessory types */
      '<div class="mega" id="mega" hidden><div class="mega__inner">' + cats.map(function (c) {
        return '<div class="mega__col"><a class="mega__head" href="' + catURL(c.category) + '">' + esc(catLabel(c.category)) + '</a>' +
          subsIn(c.category).map(function (sub) {
            var t = thumbFor(c.category, sub);
            return '<a class="mega__item" href="' + catURL(c.category, sub) + '">' +
              (t ? '<img class="photo" loading="lazy" src="' + esc(img(t, 120)) + '" alt="">' : '<span class="mega__dot"></span>') +
              '<span>' + esc(subLabel(c.category, sub)) + '</span></a>';
          }).join('') + '</div>';
      }).join('') + '</div></div>' +
      '</header>' +
      '<div class="drawer" id="drawer">' +
      '<a class="d-link" href="index.html">Home <span>01</span></a>' +
      cats.map(function (c, i) {
        return '<div class="d-group"><a class="d-link" href="' + catURL(c.category) + '" style="animation-delay:' + ((i + 2) * .05) + 's">' +
          esc(catLabel(c.category)) + ' <span>' + ('0' + (i + 2)).slice(-2) + '</span></a>' +
          '<div class="d-subs">' + subsIn(c.category).map(function (sub) {
            return '<a href="' + catURL(c.category, sub) + '">' + esc(subLabel(c.category, sub)) + '</a>';
          }).join('') + '</div></div>';
      }).join('') +
      '<a class="d-link" href="index.html#new">New Arrivals <span>' + ('0' + (cats.length + 2)).slice(-2) + '</span></a>' +
      '<a class="d-link" href="about.html">About <span>' + ('0' + (cats.length + 3)).slice(-2) + '</span></a>' +
      '<a class="d-link" href="bulk.html">Bulk Orders <span>' + ('0' + (cats.length + 4)).slice(-2) + '</span></a>' +
      '<div class="drawer__cta"><a href="bulk.html" class="btn btn--ghost btn--full">Bulk / Corporate Orders</a></div></div>' +
      /* site search */
      '<div class="search" id="search" hidden><div class="search__panel" role="dialog" aria-modal="true" aria-label="Search products">' +
      '<div class="search__bar"><svg><use href="#i-search"/></svg>' +
      '<input id="searchInput" type="search" placeholder="Search products, colours, models, SKU or ASIN" autocomplete="off" spellcheck="false" aria-label="Search products">' +
      '<button type="button" class="search__close" id="searchClose" aria-label="Close search">Esc</button></div>' +
      '<div class="search__results" id="searchResults" aria-live="polite"></div></div></div>';
  }

  function footHTML() {
    var s = DATA.site;
    var cats = navCats();
    return '<footer class="footer"><div class="wrap"><div class="foot-grid">' +
      '<div class="foot-brand"><a href="index.html"><img src="logo-full.png" alt="Meyaar — Quality for you"></a>' +
      '<p>' + esc(s.about_short || '') + '</p><div class="socials">' +
      (s.instagram ? '<a href="' + esc(s.instagram) + '" target="_blank" rel="noopener" aria-label="Instagram"><svg><use href="#i-ig"/></svg></a>' : '') +
      (s.facebook ? '<a href="' + esc(s.facebook) + '" target="_blank" rel="noopener" aria-label="Facebook"><svg><use href="#i-fb"/></svg></a>' : '') +
      '<a href="mailto:' + esc(s.support_email) + '" aria-label="Email"><svg><use href="#i-mail"/></svg></a>' +
      '</div></div>' +
      '<div class="foot"><h5>Shop</h5><ul>' + cats.map(function (c) {
        return '<li><a href="' + catURL(c.category) + '">' + esc(catLabel(c.category)) + '</a></li>';
      }).join('') + '</ul></div>' +
      '<div class="foot"><h5>Company</h5><ul>' +
      '<li><a href="about.html">About Meyaar</a></li><li><a href="about.html#story">Our story</a></li>' +
      '<li><a href="bulk.html">Bulk &amp; corporate</a></li><li><a href="policies.html">Privacy policy</a></li>' +
      '<li><a href="policies.html#terms">Terms</a></li></ul></div>' +
      '<div class="foot"><h5>Contact</h5><ul>' +
      '<li><a href="mailto:' + esc(s.support_email) + '">' + esc(s.support_email) + '</a></li>' +
      '<li><a href="mailto:' + esc(s.bulk_email) + '">Bulk: ' + esc(s.bulk_email) + '</a></li>' +
      '<li style="color:var(--muted);font-size:14px">' + esc(s.business_hours || '') + '</li>' +
      (s.map_url ? '<li><a href="' + esc(s.map_url) + '" target="_blank" rel="noopener">Delhi warehouse · Map</a></li>' : '') +
      '</ul></div>' +
      '<div class="foot"><h5>Registered office</h5><p style="font-size:13px;color:var(--muted);line-height:1.65">' +
      esc(s.legal_name || '') + '<br>' + esc(s.address || '').replace(/,\s*/g, ',<br>') +
      (s.gstin ? '<br><span style="color:var(--muted-2)">GSTIN ' + esc(s.gstin) + '</span>' : '') + '</p></div>' +
      '</div><div class="foot-bar"><span>© ' + new Date().getFullYear() + ' ' + esc(s.legal_name) + '. All rights reserved.</span>' +
      '<div class="foot-bar__links"><a href="policies.html">Privacy</a><a href="policies.html#terms">Terms</a>' +
      '<a href="policies.html#warranty">Warranty</a></div></div></div></footer>' +
      '<div class="toast" id="toast"><svg><use href="#i-info"/></svg><span id="toastMsg"></span></div>';
  }

  /* ---------- cards ---------- */
  function productCard(p, delay) {
    var price = money(p.priceMin || p.price), mrp = money(p.mrp);
    return '<a class="card rv" style="text-decoration:none' + (delay ? ';transition-delay:' + delay + 's' : '') + '" ' +
      'href="' + esc(productURL(p.rep)) + '">' +
      '<div class="card__media">' + (p.featured ? '<span class="card__badge card__badge--best">Featured</span>' : '') +
      (p.isNew ? '<span class="card__badge card__badge--new">New</span>' : '') +
      '<img class="prod photo" loading="lazy" src="' + esc(img(p.image, 500)) + '" alt="' + esc(p.title) + '"></div>' +
      '<div class="card__body"><span class="card__cat">' + esc(p.subcategory ? subLabel(p.category, p.subcategory) : catLabel(p.category)) + '</span>' +
      '<h3 class="card__name">' + esc(p.title) + '</h3>' +
      (p.summary ? '<div class="card__meta">' + esc(p.summary) + '</div>' : '') +
      '<div class="card__foot">' +
      (price ? '<span class="card__price">' + (p.priceVaries ? '<small>From</small> ' : '') + price +
        (!p.priceVaries && mrp && mrp !== price ? ' <s>' + mrp + '</s>' : '') + '</span>' : '') +
      '<span class="btn btn--amazon btn--sm">View <svg><use href="#i-arrow"/></svg></span></div></div></a>';
  }

  /* ---------- pages ---------- */
  function renderHome(app) {
    var s = DATA.site;
    var byRank = function (a, b) { return a.sort - b.sort; };
    var best = DATA.groups.filter(function (g) { return g.sort < 1e9; }).sort(byRank).slice(0, 8);
    var fresh = DATA.groups.filter(function (g) { return g.isNew; }).sort(byRank).slice(0, 8);
    var featured = DATA.groups.filter(function (g) { return g.featured; }).sort(byRank);
    var hero = featured[0] || best[0] || DATA.groups[0] || {};
    var row = function (id, eyebrow, heading, list) {
      return list.length ? '<section class="section"' + (id ? ' id="' + id + '"' : '') + '><div class="wrap"><div class="sec-head rv"><div>' +
        '<span class="eyebrow">' + eyebrow + '</span><h2 class="h-lg">' + esc(heading) + '</h2></div></div>' +
        '<div class="grid-4">' + list.map(function (p, i) { return productCard(p, i * .05); }).join('') + '</div></div></section>' : '';
    };
    app.innerHTML = navHTML('home') +
      '<section class="hero"><div class="hero__bg"><div class="grid-overlay"></div>' +
      '<div class="glow g1"></div><div class="glow g2"></div><div class="glow g3"></div></div>' +
      '<div class="hero__inner"><div class="hero__copy">' +
      (hero.title ? '<div class="hero__pill"><b>Bestseller</b> ' + esc(hero.title) + '</div>' : '') +
      '<h1 class="h-xl"><span class="line"><i>' + esc(s.hero_line1 || 'Thoughtfully') + '</i></span>' +
      '<span class="line"><i>' + esc(s.hero_line2 || 'designed.') + '</i></span>' +
      '<span class="line"><i class="accent">' + esc(s.hero_line3 || 'Quality for you.') + '</i></span></h1>' +
      '<p class="lede hero__sub">' + esc(s.hero_sub || '') + '</p>' +
      '<div class="hero__ctas">' +
      (hero.rep ? '<a href="' + esc(productURL(hero.rep)) + '" class="btn btn--amazon btn--lg">See the ' + esc((hero.title || '').split(' ')[1] || 'range') + ' <svg><use href="#i-arrow"/></svg></a>' : '') +
      '<a href="#shop" class="btn btn--ghost btn--lg">Shop the range <svg><use href="#i-arrow"/></svg></a></div>' +
      '<div class="hero__stats">' +
      [['stat1_value', 'stat1_label'], ['stat2_value', 'stat2_label'], ['stat3_value', 'stat3_label'], ['stat4_value', 'stat4_label']]
        .filter(function (p) { return s[p[0]]; })
        .map(function (p) { return '<div class="stat"><b>' + esc(s[p[0]]) + '</b><span>' + esc(s[p[1]]) + '</span></div>'; }).join('') +
      '</div></div>' +
      '<div class="hero__visual"><div class="hero__ring"></div><div class="hero__ring r2"></div><div class="hero__ring r3"></div>' +
      (hero.image ? '<img class="hero__prod photo" src="' + esc(img(hero.image, 1000)) + '" alt="' + esc(hero.title) + '">' : '') +
      '</div></div></section>' +

      '<div class="marquee"><div class="marquee__track" id="marqueeTrack"><div style="display:flex">' +
      (s.trust_items || '').split('|').filter(Boolean).map(function (t) {
        return '<span class="marquee__item"><svg><use href="#i-check"/></svg> ' + esc(t.trim()) + '</span>';
      }).join('') + '</div></div></div>' +

      '<div id="shop"></div>' +
      row('bestsellers', 'Bestsellers', s.bestsellers_heading || s.featured_heading || 'The ones people keep coming back for.', best) +
      row('new', 'New arrivals', s.new_heading || 'Just landed.', fresh) +

      '<section class="section section--tight band-grey"><div class="wrap"><div class="sec-head rv"><div>' +
      '<span class="eyebrow">Shop by category</span><h2 class="h-lg">' + esc(s.categories_heading || 'Every category, one standard.') + '</h2></div>' +
      '<p class="lede">' + esc(s.categories_sub || '') + '</p></div>' +
      '<div class="cm">' + navCats().map(function (c, i) {
        return '<div class="cm__col rv" style="transition-delay:' + (i * .04) + 's">' +
          '<a class="cm__head" href="' + catURL(c.category) + '"><span>' + esc(catLabel(c.category)) + '</span>' +
          '<em>' + famsIn(c.category).length + ' products</em></a><ul>' +
          subsIn(c.category).map(function (sub) {
            var t = thumbFor(c.category, sub), n = famsIn(c.category, sub).length;
            return '<li><a class="cm__item" href="' + catURL(c.category, sub) + '">' +
              (t ? '<img class="photo" loading="lazy" src="' + esc(img(t, 160)) + '" alt="">' : '<span class="cm__img"></span>') +
              '<span>' + esc(subLabel(c.category, sub)) + '</span><em>' + n + '</em></a></li>';
          }).join('') + '</ul></div>';
      }).join('') + '</div></div></section>' +

      '<section class="section"><div class="wrap"><div class="sec-head rv"><div>' +
      '<span class="eyebrow">Why Meyaar</span><h2 class="h-lg">Numbers we can be held to.</h2></div></div>' +
      '<div class="why-grid rv-s">' +
      [['i-box', s.why1_title, s.why1_text], ['i-star', s.why2_title, s.why2_text],
       ['i-truck', s.why3_title, s.why3_text], ['i-headset', s.why4_title, s.why4_text]]
        .filter(function (w) { return w[1]; })
        .map(function (w) {
          return '<div class="why"><svg class="why__icon"><use href="#' + w[0] + '"/></svg>' +
            '<h4>' + esc(w[1]) + '</h4><p>' + esc(w[2]) + '</p></div>';
        }).join('') + '</div></div></section>' +

      bulkBand() + footHTML();
  }

  function bulkBand() {
    var s = DATA.site;
    return '<section class="section" id="bulk"><div class="wrap"><div class="bulk rv-s"><div class="glow"></div>' +
      '<div class="bulk__inner"><span class="eyebrow">Bulk &amp; corporate orders</span>' +
      '<h2 class="h-md">' + esc(s.bulk_heading || 'Buying at volume?') + '</h2>' +
      '<p class="lede" style="margin-top:16px;max-width:48ch">' + esc(s.bulk_text || '') + '</p>' +
      '<div class="split__ctas" style="margin-top:26px">' +
      '<a href="bulk.html" class="btn btn--white btn--lg">Submit a bulk enquiry <svg><use href="#i-arrow"/></svg></a>' +
      '<a href="mailto:' + esc(s.bulk_email) + '" class="btn btn--onaccent btn--lg"><svg><use href="#i-mail"/></svg> ' + esc(s.bulk_email) + '</a>' +
      '</div></div></div></div></section>';
  }

  /* Sorting / filtering only reorders or narrows what is displayed; the catalogue itself is never reduced. */
  var SORTS = [
    ['featured', 'Featured', function (a, b) { return (b.featured - a.featured) || bestFirst(a, b); }],
    ['best', 'Best selling', bestFirst],
    ['newest', 'Newest', function (a, b) { return (b.isNew - a.isNew) || bestFirst(a, b); }],
    ['price-asc', 'Price: low to high', function (a, b) { return (a.priceMin || 1e12) - (b.priceMin || 1e12) || bestFirst(a, b); }],
    ['price-desc', 'Price: high to low', function (a, b) { return (b.priceMin || -1) - (a.priceMin || -1) || bestFirst(a, b); }]
  ];
  var SHOWS = [
    ['all', 'All products', function () { return true; }],
    ['new', 'New arrivals', function (g) { return g.isNew; }],
    ['best', 'Bestsellers', function (g) { return g.sort < 1e9; }]
  ];
  var pick = function (list, key) { return list.filter(function (x) { return x[0] === key; })[0] || list[0]; };

  function renderCategory(app) {
    var cname = qs('c'), sub = qs('s');
    var cat = catOf(cname), label = catLabel(cname);
    var all = famsIn(cname);                                  /* one entry per product family */
    var subs = subsIn(cname);
    var base = sub ? famsIn(cname, sub) : all;

    document.title = (sub ? subLabel(cname, sub) + ' — ' : '') + label + ' — Meyaar';
    app.innerHTML = navHTML(cname) +
      '<section class="cat-hero"><div class="glow" style="width:720px;height:720px;top:-54%;right:-16%;background:radial-gradient(circle,rgba(253,110,30,.14),transparent 62%)"></div>' +
      '<div class="wrap"><div class="crumb"><a href="index.html">Home</a><svg><use href="#i-arrow"/></svg>' +
      (sub ? '<a href="' + catURL(cname) + '">' + esc(label) + '</a><svg><use href="#i-arrow"/></svg><b>' + esc(subLabel(cname, sub)) + '</b>'
           : '<b>' + esc(label) + '</b>') + '</div>' +
      '<div class="cat-hero__inner"><span class="eyebrow">Meyaar ' + esc(label) + '</span>' +
      '<h1 class="h-lg" style="max-width:18ch">' + esc(sub ? subLabel(cname, sub) : (cat.heading || ('Every Meyaar ' + label + ' product, in one place.'))) + '</h1>' +
      (cat.blurb && !sub ? '<p class="lede" style="margin-top:18px;max-width:58ch">' + esc(cat.blurb) + '</p>' : '') +
      '</div></div></section>' +
      '<section class="section section--tight"><div class="wrap">' +
      (subs.length > 1 ? '<div class="filters">' +
        '<a class="filt' + (sub ? '' : ' on') + '" href="' + catURL(cname) + '">All ' + esc(label) + '<span>' + all.length + '</span></a>' +
        subs.map(function (x) {
          return '<a class="filt' + (sub === x ? ' on' : '') + '" href="' + catURL(cname, x) + '">' + esc(subLabel(cname, x)) +
            '<span>' + famsIn(cname, x).length + '</span></a>';
        }).join('') + '</div>' : '') +
      '<div class="cat-tools"><p class="cat-count" id="catCount"></p>' +
      '<label class="cat-sel">Show <select id="showSel">' + SHOWS.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="cat-sel">Sort by <select id="sortSel">' + SORTS.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="grid-4" id="grid"></div>' +
      '<div class="empty" id="catEmpty" hidden>Nothing here yet.</div>' +
      '<div style="text-align:center;margin-top:36px"><button class="btn btn--ghost btn--lg" id="more" hidden>Load more products</button></div>' +
      '</div></section>' + bulkBand() + footHTML();

    var grid = $('#grid'), more = $('#more'), sortSel = $('#sortSel'), showSel = $('#showSel');
    sortSel.value = pick(SORTS, qs('sort'))[0]; showSel.value = pick(SHOWS, qs('show'))[0];
    var shown = [], shownCount = 0;
    function page() {
      var next = shown.slice(shownCount, shownCount + 48);
      grid.insertAdjacentHTML('beforeend', next.map(function (p, i) { return productCard(p, Math.min(i, 8) * .04); }).join(''));
      shownCount += next.length;
      more.hidden = shownCount >= shown.length;
      $$('.rv:not(.in)', grid).forEach(function (e) { setTimeout(function () { e.classList.add('in'); }, 30); });
    }
    function draw() {
      var sh = pick(SHOWS, showSel.value), so = pick(SORTS, sortSel.value);
      shown = base.filter(sh[2]).sort(so[2]);
      $('#catCount').textContent = shown.length + (shown.length === 1 ? ' product' : ' products') +
        (shown.length !== base.length ? ' of ' + base.length : '');
      $('#catEmpty').hidden = shown.length > 0;
      grid.innerHTML = ''; shownCount = 0; page();
      var u = new URLSearchParams(location.search);
      if (so[0] === SORTS[0][0]) u.delete('sort'); else u.set('sort', so[0]);
      if (sh[0] === SHOWS[0][0]) u.delete('show'); else u.set('show', sh[0]);
      history.replaceState(null, '', 'category.html?' + u.toString());
    }
    sortSel.addEventListener('change', draw); showSel.addEventListener('change', draw);
    more.addEventListener('click', page);
    draw();
  }

  /* Old ?g= links from the previous site that must keep opening the product they used to open.
     Only consulted for ?g=; Amazon group/family data is not changed. */
  var LEGACY_G = { 'MR-NQ12-8B0H': 'B0GN2F3JFY' };

  /* Find the family + child a product URL points at.
     ?asin=B0…  exact child · ?sku=…  exact child (old swatch links) · ?g=…  family (old card links) */
  function findTarget(asin, sku, gid) {
    var hit = function (test) {
      for (var i = 0; i < DATA.groups.length; i++) {
        var g = DATA.groups[i];
        for (var j = 0; j < g.variants.length; j++) if (test(g.variants[j])) return { grp: g, v: g.variants[j] };
      }
      return null;
    };
    var famOfRaw = function (test) {          /* a hidden child: open its family at the representative */
      var r = DATA.products.filter(test)[0];
      var g = r && DATA.groups.filter(function (x) { return x.id === familyKey(r); })[0];
      return g ? { grp: g, v: g.rep } : null;
    };
    if (asin) {
      var a = hit(function (v) { return v.asin === asin; }) || famOfRaw(function (r) { return r.asin === asin; });
      if (a) return a;
    }
    if (sku) {
      var s = hit(function (v) { return v.sku === sku && v.asin; }) || hit(function (v) { return v.sku === sku; }) ||
              famOfRaw(function (r) { return r.sku === sku; });
      if (s) return s;
    }
    if (gid) {
      if (LEGACY_G[gid]) {
        var l = hit(function (v) { return v.asin === LEGACY_G[gid]; });
        if (l) return l;
      }
      var g = DATA.groups.filter(function (x) { return x.id === gid; })[0];
      if (g) return { grp: g, v: g.rep };
      /* Legacy fallback: families whose visible children carry this Amazon group or SKU. If several families
         match (an Amazon group split by family_override), take the one whose matching child has the best
         sort rank; unranked ties keep file order (Array sort is stable). */
      var cands = [];
      DATA.groups.forEach(function (x) {
        var m = x.variants.filter(function (v) { return v.group === gid || v.sku === gid; });
        if (m.length) cands.push({ grp: x, v: m[0], rank: Math.min.apply(null, m.map(sortOf)) });
      });
      if (cands.length) { cands.sort(function (a, b) { return a.rank - b.rank; }); return { grp: cands[0].grp, v: cands[0].v }; }
      return famOfRaw(function (r) { return r.group === gid || r.sku === gid; });
    }
    return null;
  }
  var productURL = function (v) {
    return 'product.html?' + (v.asin ? 'asin=' + encodeURIComponent(v.asin) : 'sku=' + encodeURIComponent(v.sku));
  };

  function renderProduct(app) {
    var t = findTarget(qs('asin'), qs('sku'), qs('g'));
    /* product.html?g= (empty) with nothing else valid: not a product link — go to the homepage */
    var params = new URLSearchParams(location.search);
    if (!t && params.has('g') && !params.get('g').trim()) { location.replace('index.html'); return; }
    if (!t) { app.innerHTML = navHTML('') + '<section class="section"><div class="wrap"><h1 class="h-lg">Product not found</h1><p class="lede" style="margin-top:16px"><a class="link-arrow" href="index.html">Back to home</a></p></div></section>' + footHTML(); return; }
    var grp = t.grp;
    var related = DATA.groups.filter(function (g) {
      return g.id !== grp.id && (grp.subcategory ? g.subcategory === grp.subcategory : g.category === grp.category);
    }).slice(0, 4);

    app.innerHTML = navHTML(grp.category) + '<div id="pdpLive"></div>' +
      (related.length ? '<section class="section"><div class="wrap wrap--narrow"><div class="sec-head rv"><div>' +
        '<span class="eyebrow">You might also like</span><h2 class="h-md">More ' + esc(grp.subcategory ? subLabel(grp.category, grp.subcategory) : catLabel(grp.category)) + '</h2></div>' +
        '<a class="link-arrow" href="' + catURL(grp.category) + '">All ' + esc(catLabel(grp.category)) + ' <svg><use href="#i-arrow"/></svg></a></div>' +
        '<div class="grid-4">' + related.map(function (p, i) { return productCard(p, i * .05); }).join('') + '</div></div></section>' : '') +
      footHTML();

    paintVariant(grp, t.v);

    /* Back / forward between variations of this product */
    window.onpopstate = function () {
      var n = findTarget(qs('asin'), qs('sku'), qs('g'));
      if (n && n.grp === grp) paintVariant(grp, n.v); else location.reload();
    };
  }

  /* One selector per variation dimension. A value is enabled only if the exact combination
     (that value + the other current selections) exists as a live child ASIN. */
  function selectorsHTML(grp, v) {
    return grp.dims.map(function (d, i) {
      var cur = v._vals[i];
      return '<div class="opt" data-dim="' + i + '"><div class="opt__label">' + esc(d.label) + ' <b>' + esc(cur) + '</b></div>' +
        '<div class="' + (d.swatch ? 'swatches' : 'pills') + '" role="radiogroup" aria-label="' + esc(d.label) + '">' +
        d.values.map(function (val) {
          var want = v._vals.slice(); want[i] = val;
          var child = matchChild(grp, want), sel = val === cur, dis = !child;
          var tip = dis ? val + ' — not available with the current selection' : val;
          var attrs = ' type="button" role="radio" aria-checked="' + sel + '" title="' + esc(tip) + '"' +
            (dis ? ' disabled aria-disabled="true"' : ' data-key="' + esc(rowKey(child)) + '"');
          if (!d.swatch) return '<button class="pill' + (sel ? ' sel' : '') + (dis ? ' dis' : '') + '"' + attrs + '>' + esc(val) + '</button>';
          var face = child || grp.variants.filter(function (x) { return x._vals[i] === val; })[0];
          return '<button class="sw-img' + (sel ? ' sel' : '') + (dis ? ' dis' : '') + '"' + attrs + '>' +
            '<img loading="lazy" src="' + esc(img(face.swatch || face.image_main, 160)) + '" alt="' + esc(val) + '"></button>';
        }).join('') + '</div></div>';
    }).join('');
  }

  function paintVariant(grp, v) {
    var host = $('#pdpLive');
    var shots = [v.image_main, v.image_1, v.image_2, v.image_3, v.image_4, v.image_5].filter(function (u) { return /^https?:\/\//.test(u || ''); });
    var bullets = [v.bullet1, v.bullet2, v.bullet3, v.bullet4, v.bullet5].filter(Boolean);
    var varSpecs = grp.mode === 'matrix' ? grp.dims.map(function (d, i) { return [d.label, v._vals[i]]; })
                 : grp.mode === 'simple' ? [['Option', v._vals[0]]] : [['Colour', v.colour]];
    var specs = [['Model', v.model]].concat(varSpecs).concat([['Material', v.material], ['Brand', v.brand],
                 ['ASIN', v.asin], ['Category', catLabel(grp.category) + (grp.subcategory ? ' · ' + subLabel(grp.category, grp.subcategory) : '')],
                 ['Sold & fulfilled by', 'Amazon India']]).filter(function (r) { return r[1]; });
    document.title = v.title + ' — Meyaar';

    host.innerHTML =
      '<section class="wrap wrap--narrow"><div class="crumb"><a href="index.html">Home</a><svg><use href="#i-arrow"/></svg>' +
      '<a href="' + catURL(grp.category) + '">' + esc(catLabel(grp.category)) + '</a><svg><use href="#i-arrow"/></svg>' +
      (grp.subcategory ? '<a href="' + catURL(grp.category, grp.subcategory) + '">' + esc(subLabel(grp.category, grp.subcategory)) + '</a>' +
      '<svg><use href="#i-arrow"/></svg>' : '') + '<b>' + esc(grp.title) + '</b></div></section>' +

      '<section class="wrap wrap--narrow" style="padding-bottom:clamp(40px,5vw,72px)"><div class="pdp" data-asin="' + esc(v.asin) + '">' +
      '<div class="pdp__gallery"><div class="gal__main">' +
      '<img class="prod photo" id="galMain" src="' + esc(img(shots[0], 1000)) + '" alt="' + esc(v.title) + '"></div>' +
      (shots.length > 1 ? '<div class="gal__thumbs">' + shots.map(function (u, i) {
        return '<button class="thumb' + (i ? '' : ' sel') + '" data-src="' + esc(img(u, 1000)) + '">' +
          '<img class="photo" loading="lazy" src="' + esc(img(u, 240)) + '" alt=""></button>';
      }).join('') + '</div>' : '') + '</div>' +

      '<div class="pdp__head"><span class="eyebrow">' + esc(catLabel(grp.category)) + (grp.subcategory ? ' · ' + esc(subLabel(grp.category, grp.subcategory)) : '') + '</span>' +
      '<h1 class="h-md" id="pdpTitle">' + esc(v.title) + '</h1>' +
      (v.model ? '<p style="color:var(--muted);font-size:14px;margin-bottom:16px">Model ' + esc(v.model) + '</p>' : '') +
      (money(v.price) ? '<div class="pdp__rating"><span class="card__price" id="pdpPrice" style="font-size:24px">' + money(v.price) + '</span>' +
        (money(v.mrp) && v.mrp !== v.price ? '<s style="color:var(--muted-2)">' + money(v.mrp) + '</s>' : '') +
        '<span class="muted" style="font-size:12.5px">MRP incl. of all taxes · live price on Amazon</span></div>' : '') +
      (v.description ? (function (d) {
        var short = d.length > 300 ? d.slice(0, 300).replace(/\s+\S*$/, '') + '…' : d;
        return '<p class="pdp__intro" id="desc">' + esc(short) + '</p>' +
          (d.length > 300 ? '<button class="link-arrow" id="descMore" style="margin:-14px 0 24px">Read full description <svg><use href="#i-arrow"/></svg></button>' : '');
      })(v.description) : '') +

      '<div class="variants">' + selectorsHTML(grp, v) + '</div>' +

      '<div class="buybox"><a href="' + esc(v.amazon_url) + '" target="_blank" rel="noopener" class="btn btn--amazon btn--xl btn--full" id="buyAmazon">Shop on Amazon <svg><use href="#i-ext"/></svg></a>' +
      '<div class="buybox__note"><svg><use href="#i-truck"/></svg> Sold and fulfilled by Amazon India — live price, delivery and returns on Amazon.</div>' +
      '<div class="buybox__note"><svg><use href="#i-shield"/></svg> Genuine Meyaar product. Support: ' + esc(DATA.site.support_email) + '</div></div>' +

      (bullets.length ? '<h3 class="h-sm" style="margin-bottom:6px">Key features</h3><ul class="keyfeat">' +
        bullets.map(function (b) { return '<li><svg><use href="#i-check"/></svg> ' + esc(b) + '</li>'; }).join('') + '</ul>' : '') +
      '</div></div></section>' +

      '<section class="section band-grey"><div class="wrap wrap--narrow">' +
      '<div class="grid-2" style="gap:clamp(30px,5vw,72px);align-items:start">' +
      '<div class="rv-l in"><span class="eyebrow">Specifications</span><h2 class="h-md" style="margin-bottom:22px">The details</h2>' +
      '<table class="spec-table">' + specs.map(function (r) {
        return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>';
      }).join('') + '</table></div>' +
      '<div class="rv-r in"><span class="eyebrow">Buy it on Amazon</span><h2 class="h-md" style="margin-bottom:18px">Ready when you are</h2>' +
      '<p class="lede" style="margin-bottom:26px">Live pricing, delivery estimates and returns are handled by Amazon India — the account you already have.</p>' +
      '<a href="' + esc(v.amazon_url) + '" target="_blank" rel="noopener" class="btn btn--amazon btn--lg">Shop on Amazon <svg><use href="#i-ext"/></svg></a>' +
      '</div></div></div></section>';

    var dm = $('#descMore', host);
    if (dm) dm.addEventListener('click', function () { $('#desc', host).textContent = v.description; dm.remove(); });

    $$('.thumb', host).forEach(function (t) {
      t.addEventListener('click', function () {
        $$('.thumb', host).forEach(function (x) { x.classList.remove('sel'); });
        t.classList.add('sel');
        var m = $('#galMain', host); m.style.opacity = '0';
        setTimeout(function () { m.src = t.getAttribute('data-src'); m.style.opacity = '1'; }, 140);
      });
    });

    /* Only enabled options carry data-key; disabled ones are real disabled buttons and never change anything */
    $$('.variants button[data-key]', host).forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-key');
        var next = grp.variants.filter(function (x) { return rowKey(x) === key; })[0];
        if (!next || next === v) return;
        history.pushState(null, '', productURL(next));
        paintVariant(grp, next);
      });
    });
  }

  function renderStatic(app, which) {
    var s = DATA.site;
    if (which === 'about') {
      document.title = 'About — Meyaar';
      app.innerHTML = navHTML('about') +
        '<section class="section"><div class="wrap wrap--narrow">' +
        '<span class="eyebrow">About Meyaar</span><h1 class="h-lg" style="max-width:20ch">' + esc(s.about_heading || 'Quality for you.') + '</h1>' +
        '<p class="lede" style="margin-top:22px;max-width:62ch">' + esc(s.about_short || '') + '</p>' +
        '<div class="bs-meta">' + [1, 2, 3, 4].map(function (i) {
          return s['stat' + i + '_value'] ? '<div class="stat"><b>' + esc(s['stat' + i + '_value']) + '</b><span>' + esc(s['stat' + i + '_label']) + '</span></div>' : '';
        }).join('') + '</div></div></section>' +
        '<section class="section band-cream" id="story"><div class="wrap wrap--narrow">' +
        '<span class="eyebrow">Our story</span><h2 class="h-lg" style="margin-bottom:26px">How Meyaar started</h2>' +
        (s.story || '').split('|').map(function (p) { return '<p class="lede" style="margin-bottom:18px;max-width:70ch">' + esc(p.trim()) + '</p>'; }).join('') +
        '</div></section>' +
        '<section class="section"><div class="wrap wrap--narrow"><span class="eyebrow">Our purpose</span>' +
        '<h2 class="h-lg" style="max-width:22ch">' + esc(s.purpose_heading || '') + '</h2>' +
        '<p class="lede" style="margin-top:20px;max-width:62ch">' + esc(s.purpose || '') + '</p></div></section>' +
        bulkBand() + footHTML();
    } else if (which === 'bulk') {
      document.title = 'Bulk & Corporate Orders — Meyaar';
      app.innerHTML = navHTML('bulk') +
        '<section class="section"><div class="wrap wrap--narrow">' +
        '<span class="eyebrow">Bulk &amp; corporate orders</span>' +
        '<h1 class="h-lg" style="max-width:20ch">' + esc(s.bulk_heading || 'Buying at volume?') + '</h1>' +
        '<p class="lede" style="margin-top:20px;max-width:58ch">' + esc(s.bulk_text || '') + '</p>' +
        '<div id="bulkForm" style="margin-top:36px"></div></div></section>' + footHTML();
      buildBulkForm($('#bulkForm'));
    } else {
      document.title = 'Policies — Meyaar';
      app.innerHTML = navHTML('') +
        '<section class="section"><div class="wrap wrap--narrow">' +
        '<span class="eyebrow">Policies</span><h1 class="h-lg">Privacy, terms &amp; warranty</h1>' +
        '<div style="margin-top:34px;max-width:70ch">' +
        '<h2 class="h-sm" id="privacy" style="margin:28px 0 10px">Privacy</h2><p class="lede">' + esc(s.privacy || '') + '</p>' +
        '<h2 class="h-sm" id="terms" style="margin:34px 0 10px">Terms</h2><p class="lede">' + esc(s.terms || '') + '</p>' +
        '<h2 class="h-sm" id="warranty" style="margin:34px 0 10px">Warranty</h2><p class="lede">' + esc(s.warranty || '') + '</p>' +
        '</div></div></section>' + footHTML();
    }
  }

  function buildBulkForm(host) {
    var s = DATA.site;
    var action = s.form_endpoint || '';
    host.innerHTML = '<form class="bulkform"' + (action ? ' action="' + esc(action) + '" method="POST"' : '') + '>' +
      ['name|Name|text|1', 'company|Company|text|1', 'email|Email|email|1', 'phone|Phone|tel|1',
       'products|Products required|text|1', 'quantity|Quantity|text|1'].map(function (f) {
        var p = f.split('|');
        return '<label class="fld"><span>' + p[1] + (p[3] === '1' ? ' *' : '') + '</span>' +
          '<input name="' + p[0] + '" type="' + p[2] + '"' + (p[3] === '1' ? ' required' : '') + '></label>';
      }).join('') +
      '<label class="fld fld--full"><span>Message</span><textarea name="message" rows="4"></textarea></label>' +
      '<div class="fld--full"><button class="btn btn--amazon btn--lg" type="submit">Send enquiry <svg><use href="#i-arrow"/></svg></button>' +
      '<p style="font-size:12.5px;color:var(--muted);margin-top:14px">' +
      (action ? 'Enquiries are delivered to ' + esc(s.bulk_email) + '.'
              : 'Form delivery is not connected yet — email ' + esc(s.bulk_email) + ' directly.') + '</p></div></form>';
    if (!action) {
      host.querySelector('form').addEventListener('submit', function (e) {
        e.preventDefault();
        var d = new FormData(e.target), b = [];
        d.forEach(function (v, k) { b.push(k + ': ' + v); });
        location.href = 'mailto:' + s.bulk_email + '?subject=Bulk enquiry&body=' + encodeURIComponent(b.join('\n'));
      });
    }
  }

  /* ---------- site search ----------
     Searches every live child of every listed family: title, short title, category / subcategory (data value
     and customer-facing label), model, SKU, ASIN, colour / size / variation values and product copy.
     One result per product family; when the match is specific to one child (its ASIN, SKU or colour),
     the result opens that exact child. */
  var normText = function (x) { return String(x == null ? '' : x).toLowerCase().replace(/[‘’“”"]/g, '').replace(/\s+/g, ' ').trim(); };
  var SEARCH = null;
  function searchIndex() {
    if (SEARCH) return SEARCH;
    SEARCH = DATA.groups.map(function (g) {
      return {
        g: g,
        fam: normText([g.title, g.full_title, catLabel(g.category), g.category,
                       g.subcategory ? subLabel(g.category, g.subcategory) : '', g.subcategory].join(' ')),
        kids: g.variants.map(function (v) {
          return { v: v, asin: normText(v.asin), sku: normText(v.sku),
            title: ' ' + normText(v.title + ' ' + v.short_title),
            vals: ' ' + normText([v.dim1_value, v.dim2_value, v.dim3_value, v.colour, v.variant_label].join(' ')),
            model: normText(v.model),
            body: normText([v.bullet1, v.bullet2, v.bullet3, v.bullet4, v.bullet5, v.description, v.material].join(' ')) };
        })
      };
    });
    return SEARCH;
  }
  function runSearch(q) {
    var toks = normText(q).split(' ').filter(Boolean);
    if (!toks.length) return [];
    /* short words / numbers must be a whole word ("3" ≠ "T300"); longer words match the start of a word ("wall" → "wallet") */
    var res = toks.map(function (t) {
      var x = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('(^|[^a-z0-9])' + x + (t.length <= 3 || /^\d+$/.test(t) ? '(?![a-z0-9])' : ''));
    });
    var out = [];
    searchIndex().forEach(function (e) {
      var best = null;
      e.kids.forEach(function (k) {
        var total = 0, specific = 0;
        for (var i = 0; i < toks.length; i++) {
          var t = toks[i], re = res[i], sc = 0, sp = false;
          if (k.asin && k.asin === t) { sc = 100; sp = true; }
          else if (k.sku && k.sku === t) { sc = 90; sp = true; }
          else if (t.length >= 3 && k.sku.indexOf(t) >= 0) { sc = 40; sp = true; }
          if (sc < 14 && re.test(k.vals)) { sc = 14; sp = true; }
          if (sc < 12 && re.test(k.title)) sc = 12;
          if (sc < 10 && re.test(e.fam)) { sc = 10; sp = false; }
          if (sc < 6 && re.test(k.model)) sc = 6;
          if (sc < 2 && t.length >= 4 && re.test(k.body)) sc = 2;
          if (!sc) { total = 0; break; }                 /* every word must match somewhere */
          total += sc; if (sp) specific += sc;
        }
        /* the whole query as a phrase in the product's own title or family text ranks first */
        if (total && toks.length > 1 && (k.title.indexOf(toks.join(' ')) >= 0 || e.fam.indexOf(toks.join(' ')) >= 0)) total += 25;
        if (total && (!best || total > best.total || (total === best.total && specific > best.specific)))
          best = { k: k, total: total, specific: specific };
      });
      if (best) out.push({ g: e.g, v: best.specific ? best.k.v : e.g.rep, total: best.total, specific: best.specific > 0 });
    });
    return out.sort(function (a, b) { return b.total - a.total || bestFirst(a.g, b.g); });
  }
  function searchResultsHTML(q) {
    var res = runSearch(q);
    if (!normText(q)) {
      return '<p class="search__hint">Popular categories</p><div class="search__chips">' + navCats().map(function (c) {
        return '<a href="' + catURL(c.category) + '">' + esc(catLabel(c.category)) + '</a>';
      }).join('') + '</div>';
    }
    if (!res.length) return '<p class="search__hint">No products match “' + esc(q) + '”. Try a product name, colour, SKU or ASIN.</p>';
    return '<p class="search__hint">' + res.length + (res.length === 1 ? ' product' : ' products') + '</p>' +
      res.slice(0, 30).map(function (r, i) {
        var g = r.g, v = r.v, pic = v.image_main || g.image;
        var vals = r.specific && v._vals && v._vals.length ? v._vals.join(' · ') : '';
        return '<a class="sr' + (i ? '' : ' sr--first') + '" href="' + esc(productURL(v)) + '">' +
          '<img class="photo" loading="lazy" src="' + esc(img(pic, 160)) + '" alt="">' +
          '<span class="sr__txt"><b>' + esc(g.title) + '</b>' +
          '<span>' + esc(catLabel(g.category)) + (g.subcategory ? ' › ' + esc(subLabel(g.category, g.subcategory)) : '') +
          (g.summary ? ' · ' + esc(g.summary) : '') + '</span>' +
          (vals ? '<em>' + esc(vals) + (v.asin ? ' · ' + esc(v.asin) : '') + '</em>' : '') + '</span></a>';
      }).join('');
  }

  /* ---------- behaviours shared by every page ---------- */
  function wireUp() {
    var nav = $('#nav'), progress = $('#progress');
    function onScroll() {
      var y = window.scrollY || 0, h = document.documentElement.scrollHeight - window.innerHeight;
      if (progress) progress.style.width = (h > 0 ? (y / h) * 100 : 0) + '%';
      if (nav) nav.classList.toggle('stuck', y > 24);
    }
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

    var burger = $('#burger'), drawer = $('#drawer');
    if (burger) burger.addEventListener('click', function () { document.body.classList.toggle('nav-open'); });
    if (drawer) $$('a', drawer).forEach(function (a) { a.addEventListener('click', function () { document.body.classList.remove('nav-open'); }); });

    var els = $$('.rv, .rv-l, .rv-r, .rv-s');
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) {
        en.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
      }, { threshold: .08, rootMargin: '0px 0px -5% 0px' });
      els.forEach(function (e) { io.observe(e); });
    } else els.forEach(function (e) { e.classList.add('in'); });

    /* Categories mega menu */
    var catsBtn = $('#catsBtn'), mega = $('#mega');
    function setMega(open) { if (!mega) return; mega.hidden = !open; catsBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    if (catsBtn) catsBtn.addEventListener('click', function (e) { e.stopPropagation(); setMega(mega.hidden); });
    document.addEventListener('click', function (e) { if (mega && !mega.hidden && !mega.contains(e.target)) setMega(false); });

    /* Search */
    var sBox = $('#search'), sIn = $('#searchInput'), sOut = $('#searchResults');
    function openSearch() {
      setMega(false); document.body.classList.remove('nav-open');
      sBox.hidden = false; document.body.classList.add('search-open');
      sOut.innerHTML = searchResultsHTML(sIn.value); setTimeout(function () { sIn.focus(); sIn.select(); }, 20);
    }
    function closeSearch() { sBox.hidden = true; document.body.classList.remove('search-open'); }
    if (sBox) {
      $('#searchBtn').addEventListener('click', openSearch);
      $('#searchClose').addEventListener('click', closeSearch);
      sBox.addEventListener('click', function (e) { if (e.target === sBox) closeSearch(); });
      sIn.addEventListener('input', function () { sOut.innerHTML = searchResultsHTML(sIn.value); });
      sIn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { var f = $('.sr', sOut); if (f) location.href = f.getAttribute('href'); }
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (sBox && !sBox.hidden) closeSearch(); setMega(false); }
      var typing = /input|textarea|select/i.test((e.target || {}).tagName || '');
      if (e.key === '/' && !typing && sBox && sBox.hidden) { e.preventDefault(); openSearch(); }
    });

    var tr = $('#marqueeTrack');
    if (tr && tr.firstElementChild) tr.appendChild(tr.firstElementChild.cloneNode(true));
  }

  /* ---------- boot ---------- */
  function boot() {
    var app = $('#app'); if (!app) return;
    var page = document.body.getAttribute('data-page') || 'home';
    Promise.all([
      fetch('icons.svg').then(function (r) { return r.text(); }),
      load('site.csv'),
      load('categories.csv'),
      load('products.csv'),
      load('families.csv').catch(function () { return []; })
    ]).then(function (res) {
      var holder = document.createElement('div');
      holder.style.display = 'none'; holder.innerHTML = res[0];
      document.body.insertBefore(holder, document.body.firstChild);
      res[1].forEach(function (r) { DATA.site[r.key] = r.value; });
      DATA.cats = res[2].sort(function (a, b) { return (+a.order || 99) - (+b.order || 99); });
      DATA.products = res[3];
      res[4].forEach(function (f) { if (f.family) DATA.families[f.family] = f; });
      DATA.groups = buildGroups(DATA.products);
      if (page === 'home') renderHome(app);
      else if (page === 'category') renderCategory(app);
      else if (page === 'product') renderProduct(app);
      else renderStatic(app, page);
      wireUp();
    }).catch(function (err) {
      app.innerHTML = '<div style="max-width:620px;margin:16vh auto;padding:0 24px;font-family:system-ui">' +
        '<h1 style="font-size:26px;margin-bottom:12px">Could not load the catalogue</h1>' +
        '<p style="color:#555;line-height:1.6">' + esc(err.message) + '</p>' +
        '<p style="color:#555;line-height:1.6;margin-top:12px">If you opened this file by double-clicking it, that is the reason — ' +
        'browsers block reading data files from your hard drive. Open the site from its web address instead.</p></div>';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
