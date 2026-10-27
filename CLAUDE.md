# clip2html / clip2hta

Shows text in a readable page, mainly Arabic from Claude Code, which a Windows terminal displays
and copies in the wrong order.

| Command | Shows |
|---|---|
| `clip2html` | Claude Code's latest reply, read from its own record, in the default browser |
| `clip2hta` | the same, in an HTA window (`mshta`) |
| `clip2html --clip` / `clip2hta --clip` | the clipboard (`--last` is still accepted, as the default) |
| `re` / `rew` | short for `clip2hta` / `clip2html`, flags included (`re`, the shortest, is the HTA) |

The commands live in `C:\Users\sayeh\scripts` (on PATH) as four small wrappers, `clip2html.cmd`
and `clip2hta.cmd` for cmd/PowerShell and extensionless `clip2html` / `clip2hta` for Git Bash
and `!` in Claude Code. They only call `clip2html.ps1` in this folder by its full path, so this
folder must not move without updating them.

## Files

- `clip2html.ps1` reads the clipboard (or the last reply), fills a template, writes the page to
  `%TEMP%\clip2html\clip-<time>.html|.hta` and opens it. `-Hta` picks the HTA template.
  Must stay ASCII: Windows PowerShell 5.1 reads a `.ps1` without BOM in the ANSI code page.
- `clip2html.fix.js` repairs and renders the text. Shared by both templates and inlined into
  each page, so it must stay ES5 (mshta runs IE11): no arrow functions, `let`/`const`, template
  strings, spread, `Intl`, `\p{...}`, `Element.append`.
- `clip2html.template.html` / `clip2hta.template.hta` are the pages. Placeholders: `{{SCRIPT}}`,
  `{{STAMP}}`, `{{MODE}}` (`clip` or `markdown`), `{{RAW}}` (the text), `{{ASK}}` (the prompt a
  `--last` reply answers), `{{TURNS}}` (JSON of the session's last 30 `{ask, reply}`, oldest
  first) and `{{SESSION}}` (the session's name: its `custom-title` from `/rename`, else its
  `ai-title`; shown above the page and used as the window title) and `{{SESSIONS}}` (JSON
  `{at, list}` of the 15 newest sessions with a reply, for the session dropdown), all HTML-encoded
  in hidden `<textarea>`s and filled last, in one pass, so nothing in them is taken for a placeholder.
- `%TEMP%\clip2html\sessions\` caches each listed session as `<id>.js` (`window.clipSession =
  {id, name, turns}`, ASCII-escaped JSON) plus `index.json` (name, folder, time, file stamp). A
  session is read again only when its file changed, so `--last` stays fast. Picking a session in
  the dropdown loads its `.js`: the browser page with a `<script>` tag, the HTA by reading it.
- Each generated page carries its own copy of the code. A fix only shows on pages made after it.

## The two modes

**clip** (clipboard): Claude Code prints Arabic in display order, so a copied line is reversed.
`fixAll()` undoes it. The rules, each learned from a real copy in `tests/samples`:

- Whether a copy is reversed at all: "ال" starting words vs "لا" ending them (`looksReversed`).
- A row shown right to left is reversed whole, keeping Latin runs and numbers in order
  (`fromRtl`); a row that started with English was shown left to right and only its Arabic runs
  are reversed (`fromLtr`). Which one: the row's edges (`fixRow`). When both fit, both are tried
  and the one without tell-tale marks (a space before a comma, doubled quotes) wins.
- Long lines were wrapped into rows, each flipped alone, then glued back by the copy. Seams show
  as an Arabic letter touching Latin or a full stop; hidden seams are cut again at the terminal
  width, measured from the visible seams (median-based).
- Tables: border lines give the true column widths; each row is undone whichever way makes its
  cells fit them. Rows repeated by a terminal redraw are dropped.
- Words Claude Code itself dropped while displaying (seen: "The", "label") cannot come back.

**markdown** (`--last`): the reply comes from `~/.claude/projects/<project>/<session>.jsonl`,
newest file first, reading only its tail. It is the text of `assistant` entries after the user's
last real prompt; other entry types (`api-request-blob`...) carry copies of the prompt and must
be skipped, as must `!` commands, tool results and the interrupted notice. Nothing is repaired;
it is rendered as Markdown (tables, headings, lists with nesting, quotes, code, bold, italic).
Rules learned from real replies (`tests/samples/md-fixes.md`): English with brackets inside an
Arabic line (even in bold) gets its own left-to-right box, or `O(log n)` shows as `(O(log n`;
operators and Greek letters next to a boxed run join it (`= π × r²`); a short English-only list
item, heading or table cell (`MySQL`) is aligned with the Arabic ones around it; a link counts as
its text when picking a line's direction, or its address makes the line look English.
Markdown samples are also compared with a snapshot of the rendered page, `tests/expected/*.dom`.

## Display rules (both modes)

- Each line runs right to left or left to right by its first letter and most of its letters.
- Inside Arabic, each English/code stretch sits in its own left-to-right box (`fill`); inside
  English, each Arabic phrase in its own right-to-left box (`fillEnglish`). Without them the
  browser swaps "مصحح", "كما نُسخ" and turns %1 into 1%.
- A mostly English copy is shown left to right as prose.
- Diagrams (lines joined by a line that is only ↓) stay left to right so → keeps its meaning.
- What the user typed sits in a softly highlighted box (`.you`). With `--last` it is the prompt
  from the record. In a copy it is a line starting `> ` (prompt, up to the next blank line) or
  `! ` (command, one line), only at the start of the copy or after the `✻ Worked for 2s · done`
  line that ends a turn: a `> ` anywhere else is a quote in a reply (`prompts()`).

## Moving around (both pages)

- ← / → : earlier and later turns of a `--last` page (buttons hidden when there is only one).
- The session dropdown, in the same row as the turn buttons, switches to another recent session.
  It replaced the older / newer page buttons (Ctrl+← / Ctrl+→), which the user dropped: old
  `--clip` copies are no longer reachable from a page.

## IE (clip2hta) pitfalls already hit

- `dir="auto"` throws "Invalid argument" and stopped the page after one line.
- An inline left-to-right span with a background inside Arabic shows blank: `.code` is
  `inline-block` in the HTA template.
- No CSS variables, `prefers-color-scheme`, `<bdi>` or `navigator.clipboard`.
- Settings: the HTA keeps zoom and theme in `%TEMP%\clip2html\hta-zoom.txt` / `hta-theme.txt`;
  the browser page in `localStorage` (`clip2html.zoom`, `clip2html.theme`).
- The pages have no copy button on purpose: select with Ctrl+A, then Ctrl+C.

## Testing

```
node tests/run.js                 # repairs every clip sample and compares with tests/expected,
                                  # renders every sample with a fake DOM
powershell -ExecutionPolicy Bypass -File tests\hta-check.ps1   # every sample in real mshta
```

When a new copy comes out wrong: save it in `tests/samples/clip-<name>.txt`, fix the code until
it reads right, check the other samples did not change, then `node tests/run.js --update` and
review the diff of `tests/expected` before committing. To see a page, render it with headless
Edge (`msedge --headless=new --screenshot=...`); for the HTA, capture its window alone with
`PrintWindow` rather than the screen.
