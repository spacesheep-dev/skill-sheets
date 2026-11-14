// Pushed batches: the page's listener (the engine's applyDelta, which it calls) and the page sheet.js builds.
// Loaded by tests/run.js.
"use strict";
const assert = require("assert");
const path = require("path");

module.exports = function ({ E, test, script, PAGE, ROOT }) {
  const S = require(path.join(ROOT, "sheets/assets/sheet.js"));
  const sheet = () => ({ title: "T", tabs: [{ name: "Budget", cells: { A1: "Item", B1: "Cost", B9: "=SUM(B2:B8)" } }, { name: "Summary", cells: {} }] });
  const plainCopy = (x) => JSON.parse(JSON.stringify(x));

  test("a batch lands on its tab and the engine counts it", () => {
    const d = sheet(), r = E.applyDelta(d, JSON.stringify({ tab: "budget", cells: { A2: "Rent", B2: 1200, B3: 300 } }));
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(plainCopy(r.cells), ["A2", "B2", "B3"]);
    assert.strictEqual(new E.Book(d).value("Budget", "B9"), 1500);
  });
  test("a cell holding <img onerror> stays text", () => {
    const d = sheet(), evil = '<img src=x onerror="alert(1)">', r = E.applyDelta(d, JSON.stringify({ tab: "Budget", cells: { A2: evil } }));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(new E.Book(d).value("Budget", "A2"), evil);
    assert.strictEqual(E.fmtValue(evil, null, d), evil); // drawn with textContent: the same characters, not a tag
  });
  test("a pushed formula that refers to itself shows #CYCLE! and the rest still works", () => {
    const d = sheet(), r = E.applyDelta(d, JSON.stringify({ tab: "Budget", cells: { B2: "=B2*2", B3: 5 } }));
    assert.strictEqual(r.ok, true);
    const b = new E.Book(d);
    assert.strictEqual(b.value("Budget", "B2").e, "#CYCLE!");
    assert.strictEqual(b.value("Budget", "B9").e, "#CYCLE!"); // a total over it says so, as Excel would
    assert.strictEqual(b.value("Budget", "B3"), 5);
  });
  test("a batch over 500 cells is refused whole", () => {
    const d = sheet(), cells = {};
    for (let r = 2; r <= 502; r++) cells["A" + r] = "x";
    const res = E.applyDelta(d, JSON.stringify({ tab: "Budget", cells }));
    assert.strictEqual(res.ok, false);
    assert.match(res.why, /501 cells, over 500/);
    assert.strictEqual(d.tabs[0].cells.A2, undefined);
  });
  test("a batch that isn't JSON is refused, and nothing changes", () => {
    const d = sheet(), before = JSON.stringify(d);
    for (const bad of ["{tab: Budget}", "", "null", "[1,2]", '{"tab":"Budget","cells":[1]}', '{"tab":"Nope","cells":{}}']) {
      assert.strictEqual(E.applyDelta(d, bad).ok, false, bad);
    }
    assert.strictEqual(JSON.stringify(d), before);
  });
  test("keys that aren't addresses, and values that aren't data, are refused whole", () => {
    const d = sheet(), before = JSON.stringify(d);
    for (const cells of [{ __proto__x: 1 }, { "A1; B2": 1 }, { a2: 1 }, { A0: 1 }, { A2: [1] }, { A2: { v: "x", onclick: "y" } }, { A2: { v: { v: 1 } } }]) {
      assert.strictEqual(E.applyDelta(d, JSON.stringify({ tab: "Budget", cells })).ok, false, JSON.stringify(cells));
    }
    assert.strictEqual(E.applyDelta(d, '{"tab":"Budget","cells":{"__proto__":{"polluted":1}}}').ok, false);
    assert.strictEqual(({}).polluted, undefined);
    assert.strictEqual(JSON.stringify(d), before);
  });
  test("null clears a cell", () => {
    const d = sheet();
    assert.strictEqual(E.applyDelta(d, JSON.stringify({ tab: "Budget", cells: { A1: null } })).ok, true);
    assert.strictEqual(d.tabs[0].cells.A1, undefined);
  });
  test("the page listens for its delta block and hands it to applyDelta", () => {
    const ui = script("sheet-ui");
    assert.match(ui, /addEventListener\("ss:live"/);
    assert.match(ui, /E\.applyDelta\(data, box \? box\.textContent : ""\)/);
    assert.match(PAGE, /<script type="application\/json" id="sheet-delta" data-ss-id="sheet-delta">\{\}<\/script>/);
  });

  // --- what sheet.js sends ---
  test("a pushed batch can't end its block or start a tag, whatever a cell holds", () => {
    const html = S.deltaEdit("Budget", { A2: "</script><img src=x onerror=alert(1)>", A3: "a & b" }).html;
    assert.strictEqual((html.match(/<\/script>/g) || []).length, 1);
    assert.ok(!/<img/.test(html));
    const inner = /data-ss-id="sheet-delta">([\s\S]*)<\/script>$/.exec(html)[1];
    const d = sheet();
    assert.strictEqual(E.applyDelta(d, inner).ok, true);
    assert.strictEqual(d.tabs[0].cells.A2, "</script><img src=x onerror=alert(1)>");
  });
  test("the built page keeps the starter's scripts and escapes the words", () => {
    const s = Object.assign(sheet(), { title: "Bob's <b>budget</b>", lede: "Q1 & Q2 </p><script>x</script>", description: "\"quoted\"" });
    s.tabs[0].cells.A2 = "</script><script>alert(1)</script>";
    const page = S.buildPage(PAGE, s);
    assert.strictEqual((page.match(/<script/g) || []).length, (PAGE.match(/<script/g) || []).length);
    assert.ok(page.includes("<h1 data-ss-id=\"title\">Bob's &lt;b&gt;budget&lt;/b&gt;</h1>"));
    assert.ok(page.includes("Q1 &amp; Q2 &lt;/p&gt;&lt;script&gt;x&lt;/script&gt;"));
    const data = JSON.parse(/<script type="application\/json" id="sheet-data">([\s\S]*?)<\/script>/.exec(page)[1]);
    assert.strictEqual(data.tabs[0].cells.A2, "</script><script>alert(1)</script>");
    assert.strictEqual(data.lede, undefined);
    assert.strictEqual(page.replace(/<script type="application\/json" id="sheet-data">[\s\S]*?<\/script>/, "").replace(/<title>.*<\/title>|<meta name="description"[^>]*>|<h1 data-ss-id="title">.*<\/h1>|<p class="lede" data-ss-id="lede">.*<\/p>/g, ""),
      PAGE.replace(/<script type="application\/json" id="sheet-data">[\s\S]*?<\/script>/, "").replace(/<title>.*<\/title>|<meta name="description"[^>]*>|<h1 data-ss-id="title">.*<\/h1>|<p class="lede" data-ss-id="lede">.*<\/p>/g, ""));
  });
  test("push sends only the changed cells, in batches of at most 500", () => {
    const was = sheet(), now = sheet();
    for (let r = 2; r <= 1201; r++) now.tabs[0].cells["A" + r] = "row " + r;
    delete now.tabs[0].cells.B9;
    now.tabs[1].cells.A1 = "Total";
    const bs = S.batches(was, now);
    assert.deepStrictEqual(bs.map((b) => [b.tab, Object.keys(b.cells).length]), [["Budget", 500], ["Budget", 500], ["Budget", 201], ["Summary", 1]]);
    assert.strictEqual(bs[2].cells.B9, null);
    assert.strictEqual(S.frame(was), S.frame(now)); // cells only: no whole page
    now.tabs[0].cols = [{ w: 200 }];
    assert.notStrictEqual(S.frame(was), S.frame(now));
  });
};
