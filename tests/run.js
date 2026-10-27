// Regression tests for clip2html.fix.js.
//
//   node tests/run.js            check every sample
//   node tests/run.js --update   accept the current output as expected (after checking it!)
//
// samples/clip-*.txt  text copied from a terminal; repaired with fixAll() and compared, line by
//                     line, with expected/<name>.txt
// samples/md-*.md     Claude Code replies read with --last; shown as Markdown
// Every sample is also rendered with a small fake DOM, so a script error in the display code
// (the part fixAll() does not cover) fails the run too.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const code = fs.readFileSync(path.join(root, "clip2html.fix.js"), "utf8");
const F = require(path.join(root, "clip2html.fix.js"));
const samples = path.join(__dirname, "samples");
const expectedDir = path.join(__dirname, "expected");
const update = process.argv.includes("--update");
let failed = 0;

// Just enough of a DOM for render(): elements with children, attributes and text nodes
function fakeElement(tag) {
  return {
    tagName: tag.toUpperCase(), children: [], childNodes: [], className: "", dir: "", attrs: {}, style: {},
    get firstChild() { return this.childNodes[0] || null; },
    appendChild(c) { this.childNodes.push(c); if (c.tagName) this.children.push(c); return c; },
    insertBefore(c, ref) {
      this.childNodes.splice(Math.max(0, this.childNodes.indexOf(ref)), 0, c);
      if (c.tagName) this.children.splice(Math.max(0, this.children.indexOf(ref)), 0, c);
      return c;
    },
    removeChild(c) {
      this.childNodes.splice(this.childNodes.indexOf(c), 1);
      const k = this.children.indexOf(c);
      if (k >= 0) this.children.splice(k, 1);
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    insertRow() { const r = fakeElement("tr"); this.appendChild(r); return r; },
  };
}

function render(text, mode, turns) {
  const source = fakeElement("textarea");
  source.value = text;
  source.attrs["data-mode"] = mode;
  const nodes = { source, out: fakeElement("div"), count: fakeElement("span") };
  if (turns) {
    nodes.turns = fakeElement("textarea");
    nodes.turns.value = JSON.stringify(turns);
    for (const id of ["turns-nav", "turn-at", "older", "newer"]) nodes[id] = fakeElement("span");
  }
  global.window = { scrollTo() {} };
  global.navigator = {};
  global.document = {
    getElementById: (id) => nodes[id],
    createElement: fakeElement,
    createTextNode: (t) => ({ text: t }),
  };
  new Function("module", code)(undefined);
  return nodes.out;
}

if (update) fs.mkdirSync(expectedDir, { recursive: true });

// A rendered page as indented pseudo-HTML: tag, class, direction, margin, then its text. A
// Markdown sample is compared with this snapshot, so a change in how a line is boxed shows up.
function dump(node, depth) {
  if (node.text !== undefined) return "  ".repeat(depth) + JSON.stringify(node.text);
  const style = Object.keys(node.style || {}).map((k) => k + ":" + node.style[k]).join(";");
  const head = node.tagName.toLowerCase() + (node.className ? "." + node.className.replace(/ +/g, ".") : "") +
    (node.dir ? "[" + node.dir + "]" : "") + (style ? "{" + style + "}" : "");
  return ["  ".repeat(depth) + head].concat(node.childNodes.map((c) => dump(c, depth + 1))).join("\n");
}

for (const name of fs.readdirSync(samples).sort()) {
  const text = fs.readFileSync(path.join(samples, name), "utf8");
  const markdown = name.endsWith(".md");
  const problems = [];

  if (!markdown) {
    const lines = text.split(/\r?\n/);
    const out = (F.looksReversed(text) ? F.fixAll(lines) : lines).join("\n");
    const file = path.join(expectedDir, name);
    if (update) {
      fs.writeFileSync(file, out);
    } else if (!fs.existsSync(file)) {
      problems.push("no expected output yet (run with --update after checking it)");
    } else {
      const want = fs.readFileSync(file, "utf8").split("\n");
      const got = out.split("\n");
      for (let i = 0; i < Math.max(want.length, got.length); i++) {
        if (want[i] === got[i]) continue;
        problems.push(`line ${i + 1}\n    expected: ${want[i]}\n    got:      ${got[i]}`);
        if (problems.length >= 5) break;
      }
    }
  }

  let shown = "";
  try {
    const out = render(text, markdown ? "markdown" : "clip");
    if (!out.children.length) problems.push("rendered nothing");
    if (markdown) {
      const got = out.children.map((c) => dump(c, 0)).join("\n");
      const file = path.join(expectedDir, name + ".dom");
      if (update) fs.writeFileSync(file, got);
      else if (!fs.existsSync(file)) problems.push("no expected page yet (run with --update after checking it)");
      else if (fs.readFileSync(file, "utf8") !== got) problems.push("rendered page differs from expected/" + name + ".dom");
    }
    // the boxes around what the user typed, each with its line count
    const you = out.children.filter((c) => c.className === "you").map((c) => c.children.length);
    shown = `${out.children.length} blocks, ${out.dir}` + (you.length ? `, user: ${you.join(" + ")} lines` : "");
  } catch (err) {
    problems.push("render threw: " + err.message);
  }

  if (problems.length) {
    failed++;
    console.log(`FAIL ${name}`);
    for (const p of problems) console.log("  " + p);
  } else {
    console.log(`ok   ${name}  (${shown})`);
  }
}

// A --last page carrying three turns opens on the newest; turn(-1) steps back and stops at the
// oldest, turn(1) comes forward again. The prompt's box comes first, its line is the prompt.
{
  const turns = [{ ask: "first", reply: "one" }, { ask: "second", reply: "two" }, { ask: "", reply: "three" }];
  const out = render("three", "markdown", turns);
  const firstText = () => {
    const first = out.children[0];
    const box = first.className === "you" ? first.children[0] : first;
    return (first.className === "you" ? "asked " : "") + box.childNodes.map((n) => n.text).join("");
  };
  const seen = [firstText()];
  for (const step of [-1, -1, -1, 1]) { window.clip2html.turn(step); seen.push(firstText()); }
  const want = ["three", "asked second", "asked first", "asked first", "asked second"];
  if (seen.join() === want.join()) console.log("ok   turns  (" + seen.join(" > ") + ")");
  else { failed++; console.log("FAIL turns\n    expected: " + want.join(" > ") + "\n    got:      " + seen.join(" > ")); }
}

if (update) console.log("expected outputs written to tests/expected");
process.exit(failed ? 1 : 0);
