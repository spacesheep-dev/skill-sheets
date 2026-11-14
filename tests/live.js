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
  test("fill-down moves relative references and keeps $, quotes and tab names", () => {
    const f = S.fill({ "F2:F4": "=IF($C2=\"B2\",'Q1 plan'!B2*Budget!$B$2,SUM(C$1:C2))", "B6:D6": "=B5*2", A1: "Item" }, "t");
    assert.deepStrictEqual(Object.keys(f), ["F2", "F3", "F4", "B6", "C6", "D6", "A1"]);
    assert.strictEqual(f.F4, "=IF($C4=\"B2\",'Q1 plan'!B4*Budget!$B$2,SUM(C$1:C4))");
    assert.strictEqual(f.D6, "=D5*2");
    assert.throws(() => S.fill({ "A1:B2": 1 }, "t"), /one column or one row/);
  });
  test("a filled formula gives the same values as the same formula typed out", () => {
    const typed = { name: "T", cells: { A1: 2, A2: 3, A3: 4, B1: "=A1*10", B2: "=A2*10", B3: "=A3*10" } };
    const filled = { name: "T", cells: Object.assign({ A1: 2, A2: 3, A3: 4 }, S.fill({ "B1:B3": "=A1*10" }, "t")) };
    const v = (t) => ["B1", "B2", "B3"].map((a) => new E.Book({ tabs: [t] }).value("T", a));
    assert.deepStrictEqual(v(filled), v(typed));
  });
  test("check fails a summary whose rows all come to zero, and passes when the examples reach it", () => {
    const months = {}, sheetFor = (txDate) => ({ tabs: [
      { name: "Log", cells: { A1: "Date", B1: "Amount", A2: txDate, B2: 120, A3: txDate, B3: 80 } },
      { name: "Summary", cells: Object.assign(months, S.fill({ A2: "=DATE(2026,6,1)", "A3:A7": "=EDATE(A2,1)", "B2:B7": "=SUMIFS(Log!B:B,Log!A:A,\">=\"&A2,Log!A:A,\"<\"&EDATE(A2,1))" }, "t")) }] });
    const bad = S.checkSheet(sheetFor("2027-01-03"), E).fails;
    assert.ok(bad.some((f) => /^zeros: Summary!B2:B7 \(6 formulas\)/.test(f)), bad.join("; "));
    const good = S.checkSheet(sheetFor("2026-08-03"), E).fails;
    assert.ok(!good.some((f) => /^zeros: Summary!B/.test(f)), good.join("; "));
  });
  test("month headers made by EDATE show as dates, even in a money column", () => {
    const tab = { name: "Summary", freeze: 1, cols: [{}, {}, {}, { fmt: "money" }, { fmt: "money" }, { fmt: "money" }],
      cells: Object.assign({ D1: "2026-09-01", D2: 120 }, S.fill({ "E1:F1": "=EDATE(D1,1)", "G1:H1": { v: "=EOMONTH(F1,0)", fmt: "month" } }, "t")) };
    const b = new E.Book({ locale: "en-GB", currency: "GBP", tabs: [tab] }), raw = b.raw.summary;
    const shown = (a) => E.fmtValue(b.value("Summary", a), E.cellFmt(tab, a, raw[a], b.input("Summary", a)), { locale: "en-GB", currency: "GBP" });
    assert.deepStrictEqual(["D1", "E1", "F1", "G1", "H1", "D2"].map(shown), ["1 Sept 2026", "1 Oct 2026", "1 Nov 2026", "Nov 2026", "Nov 2026", "£120"]);
    assert.strictEqual(raw.H1.v === undefined ? tab.cells.H1.v : raw.H1.v, "=EOMONTH(G1,0)"); // a {v, fmt} cell fills down too
    assert.strictEqual(tab.cells.H1.fmt, "month");
  });
  test("the legend says nothing until someone else has edited a cell on the tab", () => {
    const ui = script("sheet-ui");
    assert.match(ui, /if \(peer\) \{ var p = el\("span"\);[^\n]*Edited by someone else/);
    assert.match(ui, /lg\.hidden = !lg\.childNodes\.length/);
    assert.match(PAGE, /\.legend\[hidden\]\{display:none\}/);
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
