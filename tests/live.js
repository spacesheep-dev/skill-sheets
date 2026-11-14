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
    assert.match(ui, /deltaText = text\("sheet-delta"\);/);
    assert.match(ui, /E\.applyDelta\(data, deltaText\)/);
    assert.match(PAGE, /<pre hidden id="sheet-delta" data-ss-id="sheet-delta">\{\}<\/pre>/);
  });
  // A whole page pushed with the same scripts is changed in place by the platform (a morph): nothing re-runs, and
  // "ss:live" names every block. So no data is in a script, and the page reads its data block again when it changed.
  test("no data is in a script: the sheet and its batches are hidden text blocks the page reads as text", () => {
    assert.doesNotMatch(PAGE, /<script type="application\/json"/);
    assert.match(PAGE, /<pre hidden id="sheet-data" data-ss-id="sheet-data">\n\{[\s\S]*?\n\}\n<\/pre>/);
    const ui = script("sheet-ui");
    assert.match(ui, /function text\(id\) \{ var n = document\.getElementById\(id\); return n \? n\.textContent : ""; \}/);
    assert.match(ui, /data = JSON\.parse\(dataText\)/);
    assert.match(ui, /if \(ids\.indexOf\("sheet-data"\) >= 0 && text\("sheet-data"\) !== dataText\) return retake\(\);/);
    for (const id of ["sheet-engine", "sheet-ui"]) assert.doesNotMatch(script(id), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|new Function|\beval\(/, id);
    assert.doesNotMatch(PAGE.match(/<input id="fx"[^>]*>/)[0], /disabled/); // a whole-page update never disables the bar someone types in
  });

  test("a person's typing and place outlast a batch, a rewrite and a reload", () => {
    const ui = script("sheet-ui");
    assert.match(ui, /fx\.value = d \? d\.text :/); // the formula bar shows the draft, whatever is redrawn
    assert.match(ui, /if \(!state\.picked && !state\.draft\)/); // a batch doesn't pull someone typing to another tab
    assert.match(ui, /state\.draft\.under = true/); // a batch to the very cell being typed in marks it, keeps the text
    // the tab goes in the link with a hashchange (the viewer carries the # into the reload a save makes), and no Back step
    assert.match(ui, /location\.replace\("#tab=" \+ hashOf\(t\.name\)\)/);
    const hashOf = new Function("return " + /function hashOf\(name\) \{ return ([^\n]*); \}\n/.exec(ui)[1].replace(/^/, "(function (name) { return ") + "; })")();
    for (const name of ["Q1 (plan)", "Bob's *list*!", "~tilde", "Sales & costs", "Ünïcode 年"]) {
      assert.match("#tab=" + hashOf(name), /^#[A-Za-z0-9_.=%&/-]*$/, name); // what the viewer carries into a reload
      assert.strictEqual(decodeURIComponent(hashOf(name)), name);
    }
    assert.doesNotMatch(ui, /history\.(replaceState|pushState)|location\.hash\s*=/);
    assert.match(ui, /sessionStorage\.setItem\(PLACE,/);
    // the place is kept under the sheet's address without a version's part, so the reload onto /v/<sha>/ finds it
    const key = new Function("location", "return " + /var PLACE = ("sheet-place:" \+ location\.pathname[\s\S]*?), placing = false/.exec(ui)[1]);
    const at = (pathname) => key({ pathname });
    assert.strictEqual(at("/v/0123abcd/"), at("/"));
    assert.strictEqual(at("/v/0123abcd/index.html"), at("/index.html"));
    assert.strictEqual(at("/s/0000-id/v/0123abcd/index.html"), at("/s/0000-id/"));
    assert.strictEqual(at("/budget.html"), "sheet-place:/budget.html");
    assert.notStrictEqual(at("/v/0123abcd/budget.html"), at("/"));
    assert.notStrictEqual(at("/s/other-id/"), at("/s/0000-id/"));
    // only a whole index file name goes: two sheets whose names end in "index" keep their own places
    assert.notStrictEqual(at("/q1index.html"), at("/q1index.htm"));
    assert.notStrictEqual(at("/q1index.html"), at("/q1"));
    assert.strictEqual(at("/v/0123abcd/q1index.html"), at("/q1index.html"));
    assert.strictEqual(at("/index.htm"), at("/"));
    assert.match(ui, /py: wantPy != null \? wantPy : window\.scrollY/); // a page not yet at full height doesn't store a shorter scroll
    assert.match(PAGE, /\.grid td\.under\{/);
  });

  // --- what sheet.js sends ---
  // What a cell can hold that HTML would read: a closing tag, a tag, a comment, an entity, CR, NUL, line separators.
  const HOSTILE = ["</pre><img src=x onerror=alert(1)>", "</script><script>alert(1)</script>", "<!-- x", "&lt;b&gt; &amp; &#60;", "a & b",
    "a\r\nb\rc", "nul\u0000", "ls\u2028ps\u2029", "]]>", '<pre hidden id="sheet-data" data-ss-id="sheet-data">{}</pre>', "<svg/onload=alert(1)>"];
  // HTML text with no <, > or & (nor CR or NUL, which a parser rewrites) is read as written: its textContent is the JSON.
  const plainText = (t) => !/[<>&\r\u0000]/.test(t);
  test("a pushed batch can't end its block or start a tag, whatever a cell holds", () => {
    const cells = Object.fromEntries(HOSTILE.map((v, i) => ["A" + (i + 2), v]));
    const html = S.deltaEdit("Budget", cells).html;
    const m = /^<pre hidden id="sheet-delta" data-ss-id="sheet-delta">([\s\S]*)<\/pre>$/.exec(html);
    assert.ok(m && plainText(m[1]), html);
    const d = sheet();
    assert.strictEqual(E.applyDelta(d, m[1]).ok, true);
    HOSTILE.forEach((v, i) => assert.strictEqual(d.tabs[0].cells["A" + (i + 2)], v));
  });
  test("the built page keeps the starter's scripts and escapes the words", () => {
    const s = Object.assign(sheet(), { title: "Bob's <b>budget</b>", lede: "Q1 & Q2 </p><script>x</script>", description: "\"quoted\"" });
    s.tabs[0].cells.A2 = "</script><script>alert(1)</script>";
    const page = S.buildPage(PAGE, s);
    assert.strictEqual((page.match(/<script/g) || []).length, (PAGE.match(/<script/g) || []).length);
    assert.ok(page.includes("<h1 data-ss-id=\"title\">Bob's &lt;b&gt;budget&lt;/b&gt;</h1>"));
    assert.ok(page.includes("Q1 &amp; Q2 &lt;/p&gt;&lt;script&gt;x&lt;/script&gt;"));
    const data = S.pageData(page);
    assert.strictEqual(data.tabs[0].cells.A2, "</script><script>alert(1)</script>");
    assert.strictEqual(data.lede, undefined);
    const DATA = /<pre hidden id="sheet-data" data-ss-id="sheet-data">[\s\S]*?<\/pre>/;
    assert.strictEqual(page.replace(DATA, "").replace(/<title>.*<\/title>|<meta name="description"[^>]*>|<h1 data-ss-id="title">.*<\/h1>|<p class="lede" data-ss-id="lede">.*<\/p>/g, ""),
      PAGE.replace(DATA, "").replace(/<title>.*<\/title>|<meta name="description"[^>]*>|<h1 data-ss-id="title">.*<\/h1>|<p class="lede" data-ss-id="lede">.*<\/p>/g, ""));
  });
  test("a cell's text can't leave the sheet's data block, and comes back exactly as written", () => {
    const s = sheet(); s.tabs.push({ name: "</pre><b>x", cells: {} });
    HOSTILE.forEach((v, i) => { s.tabs[0].cells["A" + (i + 2)] = v; s.tabs[2].cells["B" + (i + 1)] = { v, note: v }; });
    const page = S.buildPage(PAGE, s), inner = /<pre hidden id="sheet-data" data-ss-id="sheet-data">([\s\S]*?)<\/pre>/.exec(page)[1];
    assert.ok(plainText(inner));
    assert.strictEqual((page.match(/<\/pre>/g) || []).length, (PAGE.match(/<\/pre>/g) || []).length);
    assert.strictEqual((page.match(/<img|<svg|<b>/g) || []).length, (PAGE.match(/<img|<svg|<b>/g) || []).length);
    assert.deepStrictEqual(S.pageData(page), JSON.parse(JSON.stringify(s)));
  });
  test("every page sheet.js builds runs the starter's scripts exactly, so a push of it is changed in place", () => {
    const scripts = (p) => (p.match(/<script[\s\S]*?<\/script>/g) || []).join("\n");
    const a = sheet(), b = sheet(); b.title = "Other"; b.tabs[0].cells.A9 = HOSTILE[1]; b.tabs.push({ name: "Two", cells: { A1: HOSTILE[0] } });
    assert.ok(scripts(PAGE).length > 1000);
    assert.strictEqual(scripts(S.buildPage(PAGE, a)), scripts(PAGE));
    assert.strictEqual(scripts(S.buildPage(PAGE, b)), scripts(PAGE));
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
