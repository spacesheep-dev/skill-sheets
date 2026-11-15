# Changelog

Each release is a heading with its tag. The release workflow uses the words under it as the release's notes.

## v2.0.1

- On a phone the sheet starts on the first screen. The description folds to two lines with "more", and the two downloads sit under one Download button.
- A chart is drawn at the width it's shown at, so its labels stay 12 px on a phone and don't touch at any width. Its value steps are round (£0, £500, £1,000), month labels drop a year the title names, and one series the title names has no key.
- One value a column's format can't show, like 1000000000 typed into a date column, no longer stops the grid drawing or loses the edit. It shows as typed, marked, and the status line says why: "C3 isn't a date, so it shows what you typed."
- Every cell and chart is drawn on its own, so one that fails can't stop the rest. The status line's warnings are red on a line of their own; the rest stays grey.
- Leaving the formula bar sends only the edit the person made. Before, after Enter in a date column, the next tap saved the cell below as their edit, and could lose the tap.
- A formula whose ranges add up past the limit shows `#CALC!` at once, instead of reading millions of cells first.
- "More columns" sits in the tabs row, over nothing. A drop-down's text stops short of its arrow, and row numbers past 199 show whole.
- Enter on a focused button presses it.
- The folder's hash is `36168641a830`.

## v2.0.0

- The sheet fills in while it's built. Within about 20 seconds the space shows the title, the named tabs and what the agent is doing. Each tab's rows then arrive in batches, outlined as they land, on every open tab. The last save says it's done, and the "working on this page" card goes away.
- The agent works through one script, `assets/sheet.js`: `start` names the sheet, `push` shows what it wrote, `check` works the sheet out and lists what's wrong, and `save` keeps a version. The skill comes in two parts: `SKILL.md`, then the rest (`references/build.md`), which the first push prints.
- People type into cells, pick from drop-downs and tick boxes. Each person's edits are kept apart, survive a restore, and show to everyone else. What someone is typing stays put while the agent pushes or saves.
- On a phone, cells, buttons, tabs and the formula bar are 44 px tall, big enough for a thumb.
- Formulas are worked out off the page, so a big sheet doesn't freeze it. A sheet that takes too long shows `#CALC!` instead of hanging. Error cells are marked and listed.
- Downloads: a CSV of one tab, and an .xlsx of every tab, with formulas, number formats, drop-downs, highlights, column widths and frozen header rows.
- Nothing in a cell is ever read as HTML or run as code.
- **What it doesn't do yet:** others' edits arrive within about 15 seconds, not at once. The agent can't read what people typed. Formulas use the 57 functions in `references/functions.md` (no TEXT, for one). There are no pivot tables, filter views or multi-column sorts. Keep a tab under about 5,000 rows.
- **Timings,** on staging with Claude Opus 5.5 at high effort, one run each: a job tracker was done in 1:36, a sales pipeline in 2:21, and a holiday cost split in 3:24 (about 45 s of that was a refused first save, since fixed). The page never went more than 40 s without a change. At xhigh effort the pipeline and the split took 2:50 to 4:35, with up to 1:21 between changes.
- **Breaking:** a sheet made by v1.0.0 keeps its data in a form this version doesn't read. Asked to change one, the agent starts a new sheet in that space; the old one stays in the space's history.
- A save changes open tabs in place, rather than reloading them, once Spacesheep has its 14 Nov 2026 save fix (on staging now).
- The folder's hash is `d92341b3afb5`.

## v1.0.0

- Moved out of the app's repo, with its history. The words are unchanged: the folder's hash is `3bd41f22ce1b`.
