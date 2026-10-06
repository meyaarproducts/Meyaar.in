# Meyaar.in — brand showcase site

A static website. All products come from CSV files — **you never edit HTML to change the catalogue.**

Every product links out to Amazon. There is no cart, no checkout and no payment anywhere on this site.

---

## The only files you need to touch

| File | What it controls |
|---|---|
| `data/products.csv` | every product — titles, prices, images, Amazon links, categories |
| `data/categories.csv` | the categories, their order, and which ones appear in the menu |
| `data/site.csv` | all the words on the site — headlines, About, story, contact details, policies |

Everything else (`*.html`, `assets/`) is the design. Leave it alone unless you want the look changed.

---

## How to change something

### From the GitHub website (easiest)

1. Open the file, e.g. `data/products.csv`
2. Click the **pencil** icon
3. Make the change, scroll down, click **Commit changes**
4. Wait about a minute, then refresh the site

### From Excel (best for bulk changes)

1. On GitHub, open `data/products.csv` → **Download raw file**
2. Open it in Excel, make your changes, **Save As → CSV UTF-8**
3. On GitHub, go to the `data` folder → **Add file → Upload files** → drop the file in → **Commit changes**

> Always save as **CSV UTF-8**, or the ₹ symbol and special characters break.

---

## Common jobs

**Hide a product** — put `yes` in the `hide` column.

**Bestsellers row on the home page** — the 8 products with the lowest `sort` number (1 = best seller). Rows with an empty `sort` never appear there.

**New Arrivals row on the home page** — put `yes` in the `new` column (8 shown, best sellers first).

**Feature a product** — put `yes` in the `featured` column. The first featured product (by `sort`) is the big hero image.

**Move a product to a different category** — change the `category` and `subcategory` cells. New category names appear automatically; add a row to `categories.csv` if you want it in the menu.

**Change a price** — edit `price` and `mrp`. (Prices here are for display; Amazon's live price is what customers actually pay.)

**Change an image** — paste a different image URL into `image_main` or `image_1`…`image_5`.

**Change homepage wording** — edit `data/site.csv`. The `story` field uses `|` to separate paragraphs.

**Turn on the bulk enquiry form** — create a free form endpoint (Formspree or similar), then paste its URL into the `form_endpoint` row of `site.csv`. Until then the form opens the visitor's email app instead.

---

## Adding a new product

Add one row per colour/variant. Minimum columns to fill:

`sku, asin, group, title, short_title, category, subcategory, colour, price, mrp, image_main, amazon_url`

Rows that share the same **`group`** value are shown as one product with colour options.
Rows whose titles are identical apart from the colour — the part after the last comma, or inside the final brackets,
e.g. `…Case for AirPods Pro 3 (2025), Purple` — are also shown as one product.

---

## Refreshing the whole catalogue from Amazon

When you add lots of products on Amazon:

1. Seller Central → **Catalogue → Category Listings Report** → download the ZIP
2. Run:
   ```
   python3 tools/build_catalogue.py CategoryListingsReport.zip
   ```
3. Upload the regenerated `data/products.csv`

Your manual edits to `category`, `subcategory`, `featured`, `sort`, `hide` and `new` are kept, matched by SKU.

---

## Hosting

Served by GitHub Pages: repo **Settings → Pages → Branch: main → /(root)**.

Site address: `https://meyaarproducts.github.io/meyaar-site/`
Later, point **Meyaar.in** at it in the same Pages settings.

---

## One thing to know

The site reads the CSV files over the web, so **double-clicking `index.html` on your computer will not work** — browsers block pages from reading data files off your hard drive. Always open the site from its web address.

---

*Images are served from Amazon's own image servers. If you replace an image on a listing, update the matching URL in `products.csv` (or re-run the catalogue refresh above).*
