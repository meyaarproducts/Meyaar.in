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
    if (!url) return '';
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
  var DATA = { products: [], groups: [], cats: [], site: {} };

  /* Split a title into the product name and its colour:
     "…Case for AirPods Pro 3 (2025), Purple" -> base "…(2025)", colour "Purple"
     "…Vegan Leather (Black)"                -> base "…Vegan Leather", colour "Black"
     "…(2025), Lotion Jar (Blue)"            -> base "…(2025)", colour "Lotion Jar (Blue)" */
  function splitTitle(t) {
    t = String(t || '').trim();
    if (/\)$/.test(t)) {
      var depth = 0;
      for (var i = t.length - 1; i >= 0; i--) {
        if (t[i] === ')') depth++;
        else if (t[i] === '(' && --depth === 0) {
          if (i <= 0) break;
          var base = t.slice(0, i).replace(/[\s,]+$/, ''), colour = t.slice(i + 1, -1).trim();
          /* a short design name before the brackets is part of the colour too */
          var c = base.lastIndexOf(','), tail = base.slice(c + 1).trim();
          if (c > 0 && tail.length <= 24 && !/[()\d]/.test(tail)) { base = base.slice(0, c).trim(); colour = tail + ' (' + colour + ')'; }
          return { base: base, colour: colour };
        }
      }
    }
    var k = t.lastIndexOf(',');
    if (k > 0) return { base: t.slice(0, k).trim(), colour: t.slice(k + 1).trim() };
    return { base: t, colour: '' };
  }
  var sortOf = function (r) { var n = parseInt(r.sort, 10); return isNaN(n) ? 1e9 : n; };
  var yes = function (v) { return String(v || '').toLowerCase() === 'yes'; };

  function buildGroups(rows) {
    /* Rows join the same product when they share a `group` (Amazon parent SKU)
       OR their titles are identical once the colour is stripped. */
    var parent = {};
    function find(k) { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; }
    function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }
    var live = rows.filter(function (r) { return !yes(r.hide); });
    live.forEach(function (r) {
      var g = 'g:' + (r.group || r.sku), base = splitTitle(r.title).base.toLowerCase().replace(/\s+/g, ' ');
      r._colour = r.colour || r.variant_label || splitTitle(r.title).colour;
      if (!(g in parent)) parent[g] = g;
      r._key = g;
      if (base.length >= 15) {
        var t = 't:' + base;
        if (!(t in parent)) parent[t] = t;
        union(g, t);
      }
    });
    var map = {}, order = [];
    live.forEach(function (r) {
      var root = find(r._key);
      if (!map[root]) { map[root] = { id: r.group || r.sku, variants: [] }; order.push(root); }
      map[root].variants.push(r);
    });
    return order.map(function (g) {
      var p = map[g], v = p.variants;
      v.sort(function (a, b) { return sortOf(a) - sortOf(b); });
      var m = v[0];
      p.title = m.short_title || m.title;
      p.full_title = m.title;
      p.category = m.category; p.subcategory = m.subcategory;
      p.price = m.price; p.mrp = m.mrp; p.model = m.model;
      p.image = m.image_main;
      p.sort = sortOf(m);
      p.featured = v.some(function (x) { return yes(x.featured); });
      p.isNew = v.some(function (x) { return yes(x['new']); });
      p.colours = v.map(function (x) { return x._colour; }).filter(Boolean);
      return p;
    });
  }

  /* ---------- shared chrome ---------- */
  function navHTML(active) {
    var s = DATA.site;
    var links = DATA.cats.filter(function (c) { return (c.show_in_nav || '').toLowerCase() === 'yes'; });
    return '<div class="announce"><span class="opt">Official Meyaar brand store <span class="dot"></span> </span>' +
      'Every product is sold and fulfilled by <b>Amazon India</b>' +
      '<span class="opt"> <span class="dot"></span> Bulk &amp; corporate orders welcome</span></div>' +
      '<header class="nav" id="nav"><div class="nav__inner">' +
      '<a href="index.html" class="brand"><img class="brand__logo" src="logo.png" alt="Meyaar"></a>' +
      '<nav class="nav__links">' +
      '<a class="nav__link' + (active === 'home' ? ' active' : '') + '" href="index.html">Home</a>' +
      links.map(function (c) {
        return '<a class="nav__link' + (active === c.category ? ' active' : '') +
          '" href="category.html?c=' + encodeURIComponent(c.category) + '">' + esc(c.label || c.category) + '</a>';
      }).join('') +
      '<a class="nav__link' + (active === 'about' ? ' active' : '') + '" href="about.html">About</a>' +
      '<a class="nav__link' + (active === 'bulk' ? ' active' : '') + '" href="bulk.html">Bulk Orders</a>' +
      '</nav>' +
      '<div class="nav__actions"><a href="' + esc(s.amazon_store_url || '#') + '" target="_blank" rel="noopener" class="btn btn--amazon btn--sm">Shop on Amazon <svg><use href="#i-ext"/></svg></a></div>' +
      '<button class="burger" id="burger" aria-label="Menu"><span></span><span></span><span></span></button>' +
      '</div></header>' +
      '<div class="drawer" id="drawer">' +
      '<a class="d-link" href="index.html">Home <span>01</span></a>' +
      links.map(function (c, i) {
        return '<a class="d-link" href="category.html?c=' + encodeURIComponent(c.category) + '" style="animation-delay:' + ((i + 2) * .05) + 's">' +
          esc(c.label || c.category) + ' <span>' + ('0' + (i + 2)).slice(-2) + '</span></a>';
      }).join('') +
      '<a class="d-link" href="about.html">About <span>' + ('0' + (links.length + 2)).slice(-2) + '</span></a>' +
      '<a class="d-link" href="bulk.html">Bulk Orders <span>' + ('0' + (links.length + 3)).slice(-2) + '</span></a>' +
      '<div class="drawer__cta"><a href="bulk.html" class="btn btn--ghost btn--full">Bulk / Corporate Orders</a></div></div>';
  }

  function footHTML() {
    var s = DATA.site;
    var cats = DATA.cats.slice(0, 6);
    return '<footer class="footer"><div class="wrap"><div class="foot-grid">' +
      '<div class="foot-brand"><a href="index.html"><img src="logo-full.png" alt="Meyaar — Quality for you"></a>' +
      '<p>' + esc(s.about_short || '') + '</p><div class="socials">' +
      (s.instagram ? '<a href="' + esc(s.instagram) + '" target="_blank" rel="noopener" aria-label="Instagram"><svg><use href="#i-ig"/></svg></a>' : '') +
      (s.facebook ? '<a href="' + esc(s.facebook) + '" target="_blank" rel="noopener" aria-label="Facebook"><svg><use href="#i-fb"/></svg></a>' : '') +
      '<a href="mailto:' + esc(s.support_email) + '" aria-label="Email"><svg><use href="#i-mail"/></svg></a>' +
      '</div></div>' +
      '<div class="foot"><h5>Shop</h5><ul>' + cats.map(function (c) {
        return '<li><a href="category.html?c=' + encodeURIComponent(c.category) + '">' + esc(c.label || c.category) + '</a></li>';
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
    var price = money(p.price), mrp = money(p.mrp);
    return '<a class="card rv" style="text-decoration:none' + (delay ? ';transition-delay:' + delay + 's' : '') + '" ' +
      'href="product.html?g=' + encodeURIComponent(p.id) + '">' +
      '<div class="card__media">' + (p.featured ? '<span class="card__badge card__badge--best">Featured</span>' : '') +
      (p.isNew ? '<span class="card__badge card__badge--new">New</span>' : '') +
      '<img class="prod photo" loading="lazy" src="' + esc(img(p.image, 500)) + '" alt="' + esc(p.title) + '"></div>' +
      '<div class="card__body"><span class="card__cat">' + esc(p.subcategory || p.category) + '</span>' +
      '<h3 class="card__name">' + esc(p.title) + '</h3>' +
      (p.colours.length > 1 ? '<div class="card__meta">' + p.colours.length + ' colours</div>' : '') +
      '<div class="card__foot">' +
      (price ? '<span class="card__price">' + price + (mrp && mrp !== price ? ' <s>' + mrp + '</s>' : '') + '</span>' : '') +
      '<span class="btn btn--amazon btn--sm">View <svg><use href="#i-arrow"/></svg></span></div></div></a>';
  }

  function catTile(c, count, delay) {
    var hero = c.image || (DATA.groups.filter(function (g) { return g.category === c.category; })[0] || {}).image;
    return '<a class="cat rv" style="text-decoration:none' + (delay ? ';transition-delay:' + delay + 's' : '') + '" ' +
      'href="category.html?c=' + encodeURIComponent(c.category) + '">' +
      (hero ? '<img class="cat__icon photo" loading="lazy" src="' + esc(img(hero, 200)) + '" alt="">' : '<span class="cat__icon"></span>') +
      '<div><div class="cat__name">' + esc(c.label || c.category) + '</div>' +
      '<div class="cat__count">' + count + ' products</div></div>' +
      '<span class="cat__arrow"><svg><use href="#i-arrow"/></svg></span></a>';
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
    var counts = {};
    DATA.groups.forEach(function (g) { counts[g.category] = (counts[g.category] || 0) + 1; });

    app.innerHTML = navHTML('home') +
      '<section class="hero"><div class="hero__bg"><div class="grid-overlay"></div>' +
      '<div class="glow g1"></div><div class="glow g2"></div><div class="glow g3"></div></div>' +
      '<div class="hero__inner"><div class="hero__copy">' +
      (hero.title ? '<div class="hero__pill"><b>New</b> ' + esc(hero.title) + '</div>' : '') +
      '<h1 class="h-xl"><span class="line"><i>' + esc(s.hero_line1 || 'Thoughtfully') + '</i></span>' +
      '<span class="line"><i>' + esc(s.hero_line2 || 'designed.') + '</i></span>' +
      '<span class="line"><i class="accent">' + esc(s.hero_line3 || 'Quality for you.') + '</i></span></h1>' +
      '<p class="lede hero__sub">' + esc(s.hero_sub || '') + '</p>' +
      '<div class="hero__ctas">' +
      (hero.id ? '<a href="product.html?g=' + encodeURIComponent(hero.id) + '" class="btn btn--amazon btn--lg">See the ' + esc((hero.title || '').split(' ')[1] || 'range') + ' <svg><use href="#i-arrow"/></svg></a>' : '') +
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
      '<div class="cat-grid">' + DATA.cats.map(function (c, i) {
        return counts[c.category] ? catTile(c, counts[c.category], i * .04) : '';
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

  function renderCategory(app) {
    var cname = qs('c'), sub = qs('s');
    var cat = DATA.cats.filter(function (c) { return c.category === cname; })[0] || { category: cname, label: cname };
    var all = DATA.groups.filter(function (g) { return g.category === cname; })
      .sort(function (a, b) { return a.sort - b.sort; });
    var subs = [];
    all.forEach(function (g) { if (g.subcategory && subs.indexOf(g.subcategory) < 0) subs.push(g.subcategory); });
    var subOrder = (cat.subcategories || '').split('|').map(function (x) { return x.trim(); }).filter(Boolean);
    var rankSub = function (x) { var i = subOrder.indexOf(x); return i < 0 ? 999 : i; };
    subs.sort(function (a, b) { return rankSub(a) - rankSub(b) || (a < b ? -1 : a > b ? 1 : 0); });
    var shown = sub ? all.filter(function (g) { return g.subcategory === sub; }) : all;

    document.title = (cat.label || cname) + ' — Meyaar';
    app.innerHTML = navHTML(cname) +
      '<section class="cat-hero"><div class="glow" style="width:720px;height:720px;top:-54%;right:-16%;background:radial-gradient(circle,rgba(253,110,30,.14),transparent 62%)"></div>' +
      '<div class="wrap"><div class="crumb"><a href="index.html">Home</a><svg><use href="#i-arrow"/></svg><b>' + esc(cat.label || cname) + '</b></div>' +
      '<div class="cat-hero__inner"><span class="eyebrow">Meyaar ' + esc(cat.label || cname) + '</span>' +
      '<h1 class="h-lg" style="max-width:18ch">' + esc(cat.heading || ('Every Meyaar ' + (cat.label || cname) + ' product, in one place.')) + '</h1>' +
      (cat.blurb ? '<p class="lede" style="margin-top:18px;max-width:58ch">' + esc(cat.blurb) + '</p>' : '') +
      '</div></div></section>' +
      '<section class="section section--tight"><div class="wrap">' +
      (subs.length > 1 ? '<div class="filters">' +
        '<a class="filt' + (sub ? '' : ' on') + '" href="category.html?c=' + encodeURIComponent(cname) + '">All ' + esc(cat.label || cname) + '</a>' +
        subs.map(function (x) {
          return '<a class="filt' + (sub === x ? ' on' : '') + '" href="category.html?c=' + encodeURIComponent(cname) + '&s=' + encodeURIComponent(x) + '">' + esc(x) + '</a>';
        }).join('') + '</div>' : '') +
      '<p class="cat-count">' + shown.length + (shown.length === 1 ? ' product' : ' products') + '</p>' +
      (shown.length ? '<div class="grid-4" id="grid"></div>' +
        (shown.length > 48 ? '<div style="text-align:center;margin-top:36px"><button class="btn btn--ghost btn--lg" id="more">Load more products</button></div>' : '')
        : '<div class="empty">Nothing here yet.</div>') +
      '</div></section>' + bulkBand() + footHTML();

    var grid = $('#grid'), shownCount = 0;
    function page() {
      var next = shown.slice(shownCount, shownCount + 48);
      grid.insertAdjacentHTML('beforeend', next.map(function (p, i) { return productCard(p, Math.min(i, 8) * .04); }).join(''));
      shownCount += next.length;
      var btn = $('#more');
      if (btn && shownCount >= shown.length) btn.style.display = 'none';
      $$('.rv:not(.in)', grid).forEach(function (e) { setTimeout(function(){ e.classList.add('in'); }, 30); });
    }
    if (grid) { page(); var mb = $('#more'); if (mb) mb.addEventListener('click', page); }
  }

  function renderProduct(app) {
    var gid = qs('g'), sku = qs('sku');
    var grp = DATA.groups.filter(function (g) {
      return gid ? g.id === gid || g.variants.some(function (v) { return (v.group || v.sku) === gid; })
                 : g.variants.some(function (v) { return v.sku === sku; });
    })[0];
    if (!grp) { app.innerHTML = navHTML('') + '<section class="section"><div class="wrap"><h1 class="h-lg">Product not found</h1><p class="lede" style="margin-top:16px"><a class="link-arrow" href="index.html">Back to home</a></p></div></section>' + footHTML(); return; }

    var v = sku ? (grp.variants.filter(function (x) { return x.sku === sku; })[0] || grp.variants[0]) : grp.variants[0];
    var shots = [v.image_main, v.image_1, v.image_2, v.image_3, v.image_4, v.image_5].filter(Boolean);
    var bullets = [v.bullet1, v.bullet2, v.bullet3, v.bullet4, v.bullet5].filter(Boolean);
    var specs = [['Model', v.model], ['Colour', v.colour || (grp.variants.length > 1 ? v._colour : '')], ['Material', v.material],
                 ['Brand', v.brand], ['Category', v.category + (v.subcategory ? ' · ' + v.subcategory : '')],
                 ['Sold & fulfilled by', 'Amazon India']].filter(function (r) { return r[1]; });
    var related = DATA.groups.filter(function (g) {
      return g.id !== grp.id && (grp.subcategory ? g.subcategory === grp.subcategory : g.category === grp.category);
    }).slice(0, 4);
    document.title = v.title + ' — Meyaar';

    app.innerHTML = navHTML(v.category) +
      '<section class="wrap wrap--narrow"><div class="crumb"><a href="index.html">Home</a><svg><use href="#i-arrow"/></svg>' +
      '<a href="category.html?c=' + encodeURIComponent(v.category) + '">' + esc(v.category) + '</a><svg><use href="#i-arrow"/></svg>' +
      (v.subcategory ? '<a href="category.html?c=' + encodeURIComponent(v.category) + '&s=' + encodeURIComponent(v.subcategory) + '">' + esc(v.subcategory) + '</a>' +
      '<svg><use href="#i-arrow"/></svg>' : '') + '<b>' + esc(grp.title) + '</b></div></section>' +

      '<section class="wrap wrap--narrow" style="padding-bottom:clamp(40px,5vw,72px)"><div class="pdp">' +
      '<div class="pdp__gallery"><div class="gal__main">' +
      '<img class="prod photo" id="galMain" src="' + esc(img(shots[0], 1000)) + '" alt="' + esc(v.title) + '"></div>' +
      (shots.length > 1 ? '<div class="gal__thumbs">' + shots.map(function (u, i) {
        return '<button class="thumb' + (i ? '' : ' sel') + '" data-src="' + esc(img(u, 1000)) + '">' +
          '<img class="photo" loading="lazy" src="' + esc(img(u, 240)) + '" alt=""></button>';
      }).join('') + '</div>' : '') + '</div>' +

      '<div class="pdp__head"><span class="eyebrow">' + esc(v.category) + (v.subcategory ? ' · ' + esc(v.subcategory) : '') + '</span>' +
      '<h1 class="h-md">' + esc(v.title) + '</h1>' +
      (v.model ? '<p style="color:var(--muted);font-size:14px;margin-bottom:16px">Model ' + esc(v.model) + '</p>' : '') +
      (money(v.price) ? '<div class="pdp__rating"><span class="card__price" style="font-size:24px">' + money(v.price) + '</span>' +
        (money(v.mrp) && v.mrp !== v.price ? '<s style="color:var(--muted-2)">' + money(v.mrp) + '</s>' : '') +
        '<span class="muted" style="font-size:12.5px">MRP incl. of all taxes · live price on Amazon</span></div>' : '') +
      (v.description ? (function (d) {
        var short = d.length > 300 ? d.slice(0, 300).replace(/\s+\S*$/, '') + '…' : d;
        return '<p class="pdp__intro" id="desc">' + esc(short) + '</p>' +
          (d.length > 300 ? '<button class="link-arrow" id="descMore" style="margin:-14px 0 24px">Read full description <svg><use href="#i-arrow"/></svg></button>' : '');
      })(v.description) : '') +

      (grp.variants.length > 1 ? '<div class="opt"><div class="opt__label">Colour — <b>' + esc(v._colour) + '</b></div>' +
        '<div class="swatches">' + grp.variants.map(function (x) {
          return '<a class="sw-img' + (x.sku === v.sku ? ' sel' : '') + '" href="product.html?g=' + encodeURIComponent(grp.id) + '&sku=' + encodeURIComponent(x.sku) + '" title="' + esc(x._colour) + '">' +
            '<img loading="lazy" src="' + esc(img(x.swatch || x.image_main, 160)) + '" alt="' + esc(x._colour) + '"></a>';
        }).join('') + '</div></div>' : '') +

      '<div class="buybox"><a href="' + esc(v.amazon_url) + '" target="_blank" rel="noopener" class="btn btn--amazon btn--xl btn--full">Shop on Amazon <svg><use href="#i-ext"/></svg></a>' +
      '<div class="buybox__note"><svg><use href="#i-truck"/></svg> Sold and fulfilled by Amazon India — live price, delivery and returns on Amazon.</div>' +
      '<div class="buybox__note"><svg><use href="#i-shield"/></svg> Genuine Meyaar product. Support: ' + esc(DATA.site.support_email) + '</div></div>' +

      (bullets.length ? '<h3 class="h-sm" style="margin-bottom:6px">Key features</h3><ul class="keyfeat">' +
        bullets.map(function (b) { return '<li><svg><use href="#i-check"/></svg> ' + esc(b) + '</li>'; }).join('') + '</ul>' : '') +
      '</div></div></section>' +

      '<section class="section band-grey"><div class="wrap wrap--narrow">' +
      '<div class="grid-2" style="gap:clamp(30px,5vw,72px);align-items:start">' +
      '<div class="rv-l"><span class="eyebrow">Specifications</span><h2 class="h-md" style="margin-bottom:22px">The details</h2>' +
      '<table class="spec-table">' + specs.map(function (r) {
        return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>';
      }).join('') + '</table></div>' +
      '<div class="rv-r"><span class="eyebrow">Buy it on Amazon</span><h2 class="h-md" style="margin-bottom:18px">Ready when you are</h2>' +
      '<p class="lede" style="margin-bottom:26px">Live pricing, delivery estimates and returns are handled by Amazon India — the account you already have.</p>' +
      '<a href="' + esc(v.amazon_url) + '" target="_blank" rel="noopener" class="btn btn--amazon btn--lg">Shop on Amazon <svg><use href="#i-ext"/></svg></a>' +
      '</div></div></div></section>' +

      (related.length ? '<section class="section"><div class="wrap wrap--narrow"><div class="sec-head rv"><div>' +
        '<span class="eyebrow">You might also like</span><h2 class="h-md">More ' + esc(grp.subcategory || grp.category) + '</h2></div>' +
        '<a class="link-arrow" href="category.html?c=' + encodeURIComponent(v.category) + '">All ' + esc(v.category) + ' <svg><use href="#i-arrow"/></svg></a></div>' +
        '<div class="grid-4">' + related.map(function (p, i) { return productCard(p, i * .05); }).join('') + '</div></div></section>' : '') +
      footHTML();

    var dm = $('#descMore');
    if (dm) dm.addEventListener('click', function () { $('#desc').textContent = v.description; dm.remove(); });

    $$('.thumb').forEach(function (t) {
      t.addEventListener('click', function () {
        $$('.thumb').forEach(function (x) { x.classList.remove('sel'); });
        t.classList.add('sel');
        var m = $('#galMain'); m.style.opacity = '0';
        setTimeout(function () { m.src = t.getAttribute('data-src'); m.style.opacity = '1'; }, 140);
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
      load('products.csv')
    ]).then(function (res) {
      var holder = document.createElement('div');
      holder.style.display = 'none'; holder.innerHTML = res[0];
      document.body.insertBefore(holder, document.body.firstChild);
      res[1].forEach(function (r) { DATA.site[r.key] = r.value; });
      DATA.cats = res[2].sort(function (a, b) { return (+a.order || 99) - (+b.order || 99); });
      DATA.products = res[3];
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
