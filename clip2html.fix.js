// Repairs and shows text copied from a terminal. Shared by clip2html (browser) and clip2hta
// (mshta, which runs the IE11 engine), so it is plain ES5: no arrow functions, let/const,
// template strings, spread, Intl.Segmenter or \p{...} regexes.
//
// Terminals such as Claude Code print Arabic in display order, so a copied line comes out
// reversed: Arabic letters backwards, while Latin words and numbers keep their own order but
// swap places. Undoing that is the same operation again: reverse the line, then put each
// left-to-right run back the right way round. Marks (tashkeel) and emoji stay with their
// character because the line is reversed by grapheme, not by code unit.
(function () {
  var CR = String.fromCharCode(13), NL = String.fromCharCode(10);
  function span(a, b) { return String.fromCharCode(a) + "-" + String.fromCharCode(b); }

  var AR_RANGES = span(0x0600, 0x06FF) + span(0x0750, 0x077F) + span(0x08A0, 0x08FF) +
                  span(0xFB50, 0xFDFF) + span(0xFE70, 0xFEFF);
  var ARABIC = new RegExp("[" + AR_RANGES + "]");
  // Letters, plus ؛ and ؟ which Unicode counts as Arabic too. The comma ، and digits take the
  // direction of what surrounds them.
  var AR_STRONG = new RegExp("[" + String.fromCharCode(0x061B, 0x061F) + span(0x0621, 0x064A) +
                             span(0x066E, 0x06D3) + span(0x0750, 0x077F) +
                             span(0x08A0, 0x08FF) + span(0xFB50, 0xFDFF) + span(0xFE70, 0xFEFF) + "]");
  var AR_LETTER = new RegExp("[" + span(0x0621, 0x064A) + span(0x066E, 0x06D3) + "]");
  var LTR = /[A-Za-z0-9]/;
  var LATIN = /[A-Za-z]/;
  var DIGIT = /[0-9]/;
  var AL = String.fromCharCode(0x0627, 0x0644);     // "ال"
  var LA = String.fromCharCode(0x0644, 0x0627);     // "لا", what "ال" turns into when reversed
  var WORD = new RegExp("[" + span(0x0621, 0x064A) + span(0x064B, 0x0652) + "]+", "g");
  var TABLE = "│";

  function startsWith(s, x) { return s.indexOf(x) === 0; }
  function trimStart(s) { return s.replace(/^\s+/, ""); }
  function some(list, test) { for (var i = 0; i < list.length; i++) if (test(list[i])) return true; return false; }

  // ---- graphemes ---------------------------------------------------------------------------
  // What a reader sees as one character: a letter with its tashkeel or accents, an emoji with
  // its skin tone or variation selector, emoji glued by the zero-width joiner, keycaps (1️⃣),
  // flags (two regional indicators) and subdivision flags (tag characters).
  var MARK = new RegExp("^[" + span(0x0300, 0x036F) + span(0x0610, 0x061A) + span(0x064B, 0x065F) +
                        String.fromCharCode(0x0670) + span(0x06D6, 0x06DC) + span(0x06DF, 0x06E4) +
                        span(0x06E7, 0x06E8) + span(0x06EA, 0x06ED) + span(0xFE00, 0xFE0F) +
                        String.fromCharCode(0x20E3) + "]$");
  var ZWJ = String.fromCharCode(0x200D);
  function pair(cp, hi, lo1, lo2) {
    return cp.length === 2 && cp.charCodeAt(0) === hi && cp.charCodeAt(1) >= lo1 && cp.charCodeAt(1) <= lo2;
  }
  function isSkinTone(cp) { return pair(cp, 0xD83C, 0xDFFB, 0xDFFF); }
  function isRegional(cp) { return pair(cp, 0xD83C, 0xDDE6, 0xDDFF); }
  function isTag(cp) { return pair(cp, 0xDB40, 0xDC20, 0xDC7F); }
  function codePoints(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) { out.push(s.charAt(i) + s.charAt(i + 1)); i++; }
      else out.push(s.charAt(i));
    }
    return out;
  }
  function graphemes(line) {
    var cps = codePoints(line), out = [];
    for (var i = 0; i < cps.length; i++) {
      var cp = cps[i], prev = out.length ? out[out.length - 1] : null;
      var glue = prev !== null && (MARK.test(cp) || cp === ZWJ || isSkinTone(cp) || isTag(cp) ||
                 prev.slice(-1) === ZWJ || (isRegional(cp) && isRegional(prev)));
      if (glue) out[out.length - 1] = prev + cp; else out.push(cp);
    }
    return out;
  }

  // ---- undoing a row shown right to left -----------------------------------------------------
  // Reverse it, keeping each left-to-right run in its own order. A number on its own (65001,
  // 5.1) keeps its digits in order but does not pull in the symbols around it, so %1 shows as
  // 1%. A run that starts with a letter takes everything up to its last letter or digit, plus a
  // closing bracket whose opener is inside it, as in args[0] or { b }.
  var CLOSE = { "]": "[", ")": "(", "}": "{" };
  function fromRtl(g) {
    var tokens = [], i = 0, j, last;
    while (i < g.length) {
      if (DIGIT.test(g[i])) {
        j = i + 1;
        while (j < g.length && (DIGIT.test(g[j]) || (/[.,]/.test(g[j]) && DIGIT.test(g[j + 1] || "")))) j++;
        tokens.push(g.slice(i, j).join(""));
        i = j;
      } else if (LATIN.test(g[i])) {
        last = i;
        for (j = i + 1; j < g.length && !ARABIC.test(g[j]); j++) if (LTR.test(g[j])) last = j;
        var run = g.slice(i, last + 1).join("");
        var next = last + 1;
        while (g[next] === " ") next++;
        var close = g[next];
        if (CLOSE[close] && run.split(CLOSE[close]).length > run.split(close).length) last = next;
        tokens.push(g.slice(i, last + 1).join(""));
        i = last + 1;
      } else {
        tokens.push(g[i]);
        i++;
      }
    }
    return tokens.reverse().join("");
  }

  // ---- undoing a row shown left to right -----------------------------------------------------
  // It started with an English word, so only each Arabic run, with the neutrals and numbers
  // inside it, is backwards. A number written after Arabic ("سنة 2014") belongs to that run and
  // shows up first on screen ("2014 ةنس"), so a run may start at a number that stands on its
  // own (not the 1 of "ps1") when Arabic follows before any Latin letter.
  function leadsIntoArabic(g, i) {
    for (var j = i; j < g.length; j++) {
      if (AR_STRONG.test(g[j])) return true;
      if (LATIN.test(g[j])) return false;
    }
    return false;
  }
  // Closing brackets and quotes written right after Arabic ("... 10؟")") are part of it too, so a
  // run may start at them when Arabic or such a number follows straight away.
  var CLOSERS = /^[)\]}"'»]$/;
  function closersLeadIntoArabic(g, i) {
    // a quote straight after an opening bracket opens a quotation: ("أيهما
    if (i > 0 && /^[(\[{]$/.test(g[i - 1])) return false;
    var j = i;
    while (j < g.length && CLOSERS.test(g[j])) j++;
    if (j === i || j >= g.length) return false;
    return AR_STRONG.test(g[j]) || (DIGIT.test(g[j]) && leadsIntoArabic(g, j));
  }
  // A bracket pair with English inside counts as left to right, so it splits an Arabic run in
  // two: "يقارن كل مستندين ("أيهما أفضل: A أم B؟")" flips as two separate runs.
  // Only a pair that closes counts; an opener with no partner after it is just flipped text.
  function bracketsLatin(g, j) {
    var opener = g[j], closer = { "(": ")", "[": "]", "{": "}" }[opener], depth = 0, latin = false;
    if (!closer) return false;
    for (var k = j; k < g.length; k++) {
      if (g[k] === opener) depth++;
      else if (g[k] === closer && --depth === 0) return latin;
      else if (LATIN.test(g[k])) latin = true;
    }
    return false;
  }
  function fromLtr(g) {
    var out = [], i = 0;
    while (i < g.length) {
      var number = DIGIT.test(g[i]) && !(i > 0 && LTR.test(g[i - 1]));
      if (AR_STRONG.test(g[i]) || (number && leadsIntoArabic(g, i)) || closersLeadIntoArabic(g, i)) {
        var last = i;
        for (var j = i + 1; j < g.length && !LATIN.test(g[j]) && !bracketsLatin(g, j); j++) {
          if (AR_STRONG.test(g[j])) last = j;
        }
        out.push(fromRtl(g.slice(i, last + 1)));
        i = last + 1;
      } else {
        out.push(g[i]);
        i++;
      }
    }
    return out.join("");
  }

  // A row that starts with an English word is shown left to right. Its first strong letter is
  // then Latin, and so is its last one, or else it ends in the sentence's own full stop, bracket
  // or quote: a flipped row carries those on its left edge instead.
  var END_MARK = /[.:!?؟)\]}"'»]$/;
  function strongs(g) {
    var out = [];
    for (var i = 0; i < g.length; i++) if (AR_STRONG.test(g[i]) || LTR.test(g[i])) out.push(g[i]);
    return out;
  }
  // The left edge tells too. In a flipped row it holds the end of the sentence, which never is
  // an opening bracket or a numbering mark, so a row starting with "[CLS]", "(", "1️⃣" or "①"
  // was shown left to right.
  var OPENER = /^[(\[{"'«]/;
  function isMarker(x) {
    var c = x.charCodeAt(0);
    return (c >= 0xD83C && c <= 0xD83E) || x.indexOf(String.fromCharCode(0x20E3)) > 0 ||
           (c >= 0x2460 && c <= 0x24FF) || (c >= 0x2776 && c <= 0x2793);
  }
  // A comma, semicolon, ? or ! never comes after a space in text that reads in order. Undoing a
  // row the wrong way round leaves exactly that behind ("كما نُسخ" ,"مصحح"), so it tells the
  // two readings apart when the edges cannot.
  // Quotes doubled up ("المصحح""), where the two halves of a pair ended up side by side, are the
  // same kind of tell.
  var ODD_PUNCT = /\s[,;!?،؛]|""|''/g;
  function oddPunct(s) { return (s.match(ODD_PUNCT) || []).length; }

  function fixRow(g) {
    var s = strongs(g);
    if (!s.length || !LTR.test(s[0])) return fromRtl(g);
    var k = 0;
    while (k < g.length && g[k] === " ") k++;
    if (k < g.length && (OPENER.test(g[k]) || isMarker(g[k]))) return fromLtr(g);
    if (LTR.test(s[s.length - 1])) return fromLtr(g);
    // English on the left edge and Arabic on the right fits both: an English sentence holding
    // Arabic, or an Arabic one holding English. Whichever undoing reads in order wins.
    var asLtr = fromLtr(g), asRtl = fromRtl(g), l = oddPunct(asLtr), r = oddPunct(asRtl);
    if (l !== r) return l < r ? asLtr : asRtl;
    return END_MARK.test(g.join("").replace(/\s+$/, "")) ? asLtr : asRtl;
  }

  // ---- long lines ----------------------------------------------------------------------------
  // A long line is wrapped into rows on screen, each row is flipped on its own, and copying glues
  // them back together. Without the space the wrap swallowed, an Arabic letter ends up touching
  // Latin or a full stop, which a flipped row never has, so that is a seam; a full stop that ends
  // the line is just the sentence's own. Rows glued with a space show no seam, but the terminal
  // wrapped by words, so they are cut again at the width measured from the visible seams.
  // A full stop, colon or percent sign only opens a row when a letter follows it directly
  // (".HTML", ".يداع", "%TEMP%"): "أيهما: A" is just a colon inside a sentence.
  var ROW_START = /[A-Za-z0-9.:%]/;
  var PUNCT_START = /[.:%]/;
  function letterAt(g, i) { return i < g.length && (AR_STRONG.test(g[i]) || LTR.test(g[i])); }
  function splitRows(g) {
    var rows = [[]];
    for (var i = 0; i < g.length; i++) {
      var c = g[i].charAt(0);
      var seam = i > 0 && AR_LETTER.test(g[i - 1].charAt(0)) && ROW_START.test(c) &&
                 (!PUNCT_START.test(c) || letterAt(g, i + 1)) &&
                 some(g.slice(i), function (y) { return AR_STRONG.test(y) || LTR.test(y); });
      // ...or with the quote that opened the flipped row in between: صنلا"copy
      if (!seam && i > 1 && /^["'»]$/.test(g[i - 1]) && AR_LETTER.test(g[i - 2].charAt(0)) &&
          LATIN.test(c)) seam = true;
      if (seam) rows.push([]);
      rows[rows.length - 1].push(g[i]);
    }
    return rows;
  }

  // Bullets and numbers, and the > Claude Code draws before the user's own message
  var BULLET = /^(\s*(?:[-*•]|[0-9]+[.)])\s+)(.*)$/;
  var PREFIX = /^(\s*(?:[-*•>]|[0-9]+[.)])\s+)(.*)$/;
  function parts(line) {
    var bullet = line.match(PREFIX);
    return { prefix: bullet ? bullet[1] : "", rows: splitRows(graphemes(bullet ? bullet[2] : line)) };
  }

  function wrap(g, room) {
    var rows = [];
    while (room > 0 && g.length > room) {
      var cut = -1;
      for (var i = room; i > 0; i--) if (g[i] === " ") { cut = i; break; }
      if (cut < 0) break;
      rows.push(g.slice(0, cut));
      g = g.slice(cut + 1);
    }
    rows.push(g);
    return rows;
  }

  // Every row before a seam is at most the width, and most come close to it. One can still hold
  // a hidden seam of its own (about twice the width), and a seam found by mistake can be short,
  // so the median is the yardstick: the widest row within half again of it is the width.
  function measureWidth(lines) {
    var seen = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!ARABIC.test(line) || startsWith(trimStart(line), TABLE)) continue;
      var p = parts(line);
      for (var r = 0; r < p.rows.length - 1; r++) seen.push(p.prefix.length + p.rows[r].length);
    }
    if (!seen.length) return 0;
    seen.sort(function (x, y) { return x - y; });
    var median = seen[Math.floor((seen.length - 1) / 2)], width = 0;
    for (var k = 0; k < seen.length; k++) if (seen[k] < median * 1.5 && seen[k] > width) width = seen[k];
    return width;
  }

  // ---- tables --------------------------------------------------------------------------------
  // Borders (┌──┬──┐, ├──┼──┤) are never flipped, so they give each column's true width. An
  // Arabic run can span several cells and swap them, so a row's direction cannot be read off the
  // row itself: whichever undoing puts every cell back at its column's width wins.
  var BORDER = /^\s*[┌├╭]/;
  function cellWidths(text) {
    var cells = text.replace(/^\s+|\s+$/g, "").split(TABLE).slice(1, -1), out = [];
    for (var i = 0; i < cells.length; i++) out.push(graphemes(cells[i]).length);
    return out.join();
  }
  function borderWidths(line) {
    var segs = line.replace(/^\s+|\s+$/g, "").slice(1, -1).split(/[┬┼┴]/), out = [];
    for (var i = 0; i < segs.length; i++) out.push(graphemes(segs[i]).length);
    return out.join();
  }

  // Fixes every line of a copy. State (the width, the current table's columns) lives here, so
  // each call starts fresh.
  function fixAll(lines) {
    var width = measureWidth(lines), columns = null, out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (BORDER.test(line)) columns = borderWidths(line);
      if (!ARABIC.test(line)) { out.push(line); continue; }

      if (startsWith(trimStart(line), TABLE)) {
        var g = graphemes(line), asRtl = fromRtl(g), asLtr = fromLtr(g);
        out.push(columns && cellWidths(asLtr) === columns && cellWidths(asRtl) !== columns ? asLtr : asRtl);
        continue;
      }

      // List bullets are drawn by the terminal in front of the text, outside the flipped part
      var p = parts(line), pieces = [];
      for (var r = 0; r < p.rows.length; r++) {
        var cut = wrap(p.rows[r], width - p.prefix.length);
        for (var c = 0; c < cut.length; c++) {
          var piece = fixRow(cut[c]).replace(/^\s+|\s+$/g, "");
          if (piece) pieces.push(piece);
        }
      }
      out.push(p.prefix + pieces.join(" "));
    }
    return out;
  }

  // "ال" starts a large share of Arabic words. In a reversed copy it shows up as "لا" at the end
  // instead, so whichever is more common tells which way round the text is.
  function looksReversed(text) {
    var normal = 0, reversed = 0, words = text.match(WORD) || [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length < 3) continue;
      if (startsWith(w, AL)) normal++;
      if (w.slice(-2) === LA) reversed++;
    }
    return reversed > normal;
  }

  // ---- showing it ----------------------------------------------------------------------------
  // Inside Arabic text the browser runs its own bidi over English and code too, so %1 can show
  // as 1% and brackets swap sides. Each stretch without Arabic is put in its own left-to-right
  // box (a span with dir="ltr", which isolates in browsers and embeds in IE), keeping it intact
  // while the Arabic around it reads right to left. Punctuation and brackets at the box's edges
  // belong to the Arabic sentence and stay outside, as does a number or emoji in front of a word.
  var NON_AR = "[^ " + AR_RANGES + "]+";
  // "= π × r²": the operators and Greek letters around a boxed word are part of the formula
  var MATH_WORD = new RegExp("^(?:[=<>+*/^%~\u00d7\u00f7\u2248\u2260\u2264\u2265\u00b1\u2192\u21d2-]+|[" + span(0x0370, 0x03FF) + "]+)$");
  var LATIN_RUNS = new RegExp("(" + NON_AR + "(?: +" + NON_AR + ")*)");
  var PAIRS = { "(": ")", "[": "]", "{": "}" };
  function opened(s) { return (s.match(/[(\[{]/g) || []).length - (s.match(/[)\]}]/g) || []).length; }
  function text(el, s) { el.appendChild(document.createTextNode(s)); }

  function fill(el, s) {
    if (!ARABIC.test(s)) { text(el, s); return el; }
    var pieces = s.split(LATIN_RUNS);
    for (var p = 0; p < pieces.length; p++) {
      var part = pieces[p];
      if (!part) continue;
      if (!LTR.test(part) || ARABIC.test(part)) { text(el, part); continue; }

      var words = part.split(" "), a = 0, b = words.length;
      while (a < b && !LTR.test(words[a])) a++;
      while (b > a && !LTR.test(words[b - 1])) b--;
      while (a < b - 1 && !LATIN.test(words[a]) &&
             some(words.slice(a + 1, b), function (w) { return LATIN.test(w); })) a++;
      while (b < words.length && /^[)\]}]+$/.test(words[b]) && opened(words.slice(a, b).join(" ")) > 0) b++;
      while (a > 0 && MATH_WORD.test(words[a - 1])) a--;
      while (b < words.length && MATH_WORD.test(words[b])) b++;

      var core = words.slice(a, b).join(" ");
      var tail = (core.match(/[.,:;!?]+$/) || [""])[0], lead = "";
      core = core.slice(0, core.length - tail.length);
      while (/[)\]}]$/.test(core) && opened(core) < 0) { tail = core.slice(-1) + tail; core = core.slice(0, -1); }
      while (/^[(\[{]/.test(core) && opened(core) > 0) { lead += core.charAt(0); core = core.slice(1); }
      while (core.length > 2 && PAIRS[core.charAt(0)] === core.slice(-1) && opened(core.slice(1, -1)) === 0) {
        lead += core.charAt(0);
        tail = core.slice(-1) + tail;
        core = core.slice(1, -1);
      }

      var before = words.slice(0, a).join(" ") + (a > 0 ? " " : "") + lead;
      var after = tail + (b < words.length ? " " : "") + words.slice(b).join(" ");
      if (before) text(el, before);
      var box = document.createElement("span");
      box.className = "ltr";
      box.dir = "ltr";
      text(box, core);
      el.appendChild(box);
      if (after) text(el, after);
    }
    return el;
  }

  // A copy that is mostly English (an English answer quoting a few Arabic words) reads left to
  // right: its English lines are prose rather than code, and only lines that are mostly Arabic
  // turn right to left. Set by render() from the whole copy.
  var englishDoc = false;
  var AR_COUNT = new RegExp(AR_STRONG.source, "g");
  function arabicCount(s) { return (s.match(AR_COUNT) || []).length; }
  function latinCount(s) { return (s.match(/[A-Za-z]/g) || []).length; }
  function mostlyArabic(s) { return arabicCount(s) > latinCount(s); }

  // The mirror case of fill(): inside an English line the browser joins Arabic phrases that only
  // have quotes and commas between them into one right-to-left block, so "مصحح", "كما نُسخ"
  // would show the second phrase first. Each phrase gets its own right-to-left box.
  var AR_PHRASE = new RegExp("([" + AR_RANGES + "]+(?: +[" + AR_RANGES + "]+)*)");
  function fillEnglish(el, s) {
    var pieces = s.split(AR_PHRASE);
    for (var p = 0; p < pieces.length; p++) {
      if (!pieces[p]) continue;
      if (!AR_STRONG.test(pieces[p])) { text(el, pieces[p]); continue; }
      var box = document.createElement("span");
      box.className = "rtl";
      box.dir = "rtl";
      text(box, pieces[p]);
      el.appendChild(box);
    }
    return el;
  }

  function lineEl(s, forceLtr) {
    var div = document.createElement("div");
    div.className = "ln";
    if (forceLtr) {
      div.className += " diagram";
      div.dir = "ltr";
      return fill(div, s);
    }
    if (englishDoc && !mostlyArabic(s)) {
      div.className += " en";
      if (s.replace(/\s+/g, "")) div.dir = "ltr";
      var item = s.match(BULLET);
      if (item) div.className += " item";
      return fillEnglish(div, item ? item[2] : s);
    }
    // an empty line needs no direction, and IE rejects dir="auto" outright
    if (ARABIC.test(s)) div.dir = "rtl";
    else if (s.replace(/\s+/g, "")) div.dir = "ltr";
    var bullet = ARABIC.test(s) && s.match(BULLET);
    if (bullet) {
      div.className += " item";
      return fill(div, bullet[2]);
    }
    return fill(div, s);
  }

  // A box-drawing table only lines up in a monospace font, and as one line of text the browser
  // would reorder English across its cells again. So it becomes a real table: rows end at each
  // border line, and a cell spread over several screen lines is joined back into one.
  var BOX = /^\s*[┌├└╭╰│]/;
  var ARROW_ONLY = /^\s*[↓↑⇣⇡⬇⬆|]+\s*$/;
  function tableEl(block) {
    var rows = [], cur = null, i, c, seenLines = {};
    for (i = 0; i < block.length; i++) {
      var t = block[i].replace(/^\s+|\s+$/g, "");
      if (startsWith(t, TABLE)) {
        var cells = t.split(TABLE).slice(1, -1);
        // A redraw can paste a whole row again with no border before it, which would merge it
        // into the row above. A filled-in line seen before is that repeat; continuation lines of
        // a wrapped cell have empty cells, so they are never mistaken for one.
        var full = !some(cells, function (x) { return !x.replace(/\s+/g, ""); });
        if (full && seenLines[t]) continue;
        seenLines[t] = true;
        if (!cur) { cur = []; for (c = 0; c < cells.length; c++) cur.push([]); }
        for (c = 0; c < cells.length; c++) {
          var v = cells[c].replace(/^\s+|\s+$/g, "");
          if (v && cur[c]) cur[c].push(v);
        }
      } else if (cur) {
        rows.push(cur);
        cur = null;
      }
    }
    if (cur) rows.push(cur);

    // A copy taken while the terminal redraws can repeat rows, and a table never needs the
    // same row twice in a row's place, so exact repeats are dropped.
    var seenRows = {}, unique = [];
    for (r = 0; r < rows.length; r++) {
      var key = [];
      for (c = 0; c < rows[r].length; c++) key.push(rows[r][c].join(" "));
      key = key.join(TABLE);
      if (!seenRows[key]) { seenRows[key] = true; unique.push(rows[r]); }
    }
    rows = unique;

    // The first row is a header only when the copy includes the table's top border; a copy that
    // starts partway down the table has no header to show.
    var hasHeader = /^\s*[┌╭]/.test(block[0]);
    var table = document.createElement("table");
    table.dir = !englishDoc && some(block, function (l) { return ARABIC.test(l); }) ? "rtl" : "ltr";
    for (var r = 0; r < rows.length; r++) {
      var tr = table.insertRow(-1);
      for (c = 0; c < rows[r].length; c++) {
        var s = rows[r][c].join(" ");
        var cell = document.createElement(r === 0 && hasHeader ? "th" : "td");
        if (englishDoc && !mostlyArabic(s)) {
          cell.dir = "ltr";
          fillEnglish(cell, s);
        } else {
          cell.dir = englishDoc ? "rtl" : (ARABIC.test(s) || !s ? table.dir : "ltr");
          fill(cell, s);
        }
        tr.appendChild(cell);
      }
    }
    var holder = document.createElement("div");
    holder.className = "tbl";
    holder.appendChild(table);
    return holder;
  }

  // What the user typed: Claude Code draws "> " before a prompt and "! " before a shell command,
  // at the start of the line. A reply can quote with "> " too, so it only counts at the start of
  // the copy or after the "✻ Worked for 2s · done 12:49 AM" line that ends the turn before. A
  // prompt runs to the next blank line, which takes in the rows of a long one; a command's output
  // follows it straight away, so a command is one line.
  var TURN_END = /^\s*[✻✶✳✢]\s+\S+ for [0-9]/;
  var YOU = /^([>!]) /;
  var REPLY = /^\s*[●⏺]/;
  function prompts(list) {
    var you = [], open = true;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s.replace(/\s+/g, "")) continue;
      var m = open && s.match(YOU);
      open = TURN_END.test(s);
      if (!m) continue;
      you[i] = true;
      if (m[1] === "!") continue;
      var j = i + 1;
      for (; j < list.length && list[j].replace(/\s+/g, "") && !REPLY.test(list[j]); j++) you[j] = true;
      i = j - 1;
    }
    return you;
  }

  // The user's own words, softly highlighted in a box of their own
  function youBox() {
    var box = document.createElement("div");
    box.className = "you";
    return box;
  }

  function render(out, list) {
    while (out.firstChild) out.removeChild(out.firstChild);
    var whole = list.join(NL);
    englishDoc = latinCount(whole) > arabicCount(whole);
    out.dir = englishDoc ? "ltr" : "rtl";
    // A diagram (lines joined by a line that is only an arrow, like ↓) was drawn left to right
    // in the terminal; shown right to left its → would point backwards. Every line of that
    // group, up to the blank lines around it, stays left to right.
    var diagram = [];
    for (var a = 0; a < list.length; a++) {
      if (!ARROW_ONLY.test(list[a])) continue;
      for (var u = a; u >= 0 && list[u].replace(/\s+/g, "") && !BOX.test(list[u]); u--) diagram[u] = true;
      for (var d = a; d < list.length && list[d].replace(/\s+/g, "") && !BOX.test(list[d]); d++) diagram[d] = true;
    }
    var you = prompts(list), box = null;
    for (var i = 0; i < list.length; ) {
      if (BOX.test(list[i])) {
        var block = [];
        while (i < list.length && BOX.test(list[i])) block.push(list[i++]);
        out.appendChild(tableEl(block));
        box = null;
      } else if (you[i]) {
        // the box shows whose words they are, so the "> " mark goes
        if (!box) out.appendChild(box = youBox());
        box.appendChild(lineEl(box.firstChild ? list[i] : list[i].replace(/^> /, ""), diagram[i]));
        i++;
      } else {
        out.appendChild(lineEl(list[i], diagram[i]));
        box = null;
        i++;
      }
    }
  }

  // ---- Markdown (clip2html --last) -------------------------------------------------------------
  // A reply read from Claude Code's own record is already in order, so nothing is repaired; it is
  // Markdown, so tables, headings, lists, quotes, bold and code are shown as such. Each line runs
  // in the direction of most of its letters, with the other language boxed as elsewhere.
  var MD_FENCE = /^\s*```/;
  var MD_TABLE = /^\s*\|/;
  var MD_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
  var MD_HEADING = /^(#{1,6})\s+(.*)$/;
  var MD_HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
  var MD_QUOTE = /^\s*>\s?(.*)$/;
  var MD_ITEM = /^(\s*)([-*+]|[0-9]+[.)])\s+(.*)$/;
  var MD_INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s](?:[^*]*[^*\s])?\*)/;

  // A line takes the direction its first letter and most of its letters agree on. When they
  // disagree ("الفرق بين cmd و PowerShell و Bash" starts Arabic but is mostly English letters;
  // "**cmd** قديم ومحدود" the other way round) it follows the reply as a whole.
  // (a link counts as its text: its address is dropped when shown)
  function plainOf(s) { return s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/`[^`]*`/g, " "); }
  // label: a list item, heading or table cell, where a short English name ("MySQL") in an Arabic
  // reply sits on the same side as the Arabic ones around it
  function lineDir(s, label) {
    var p = plainOf(s), docDir = englishDoc ? "ltr" : "rtl";
    if (!arabicCount(p) && !latinCount(p)) return docDir;
    if (label && !englishDoc && !arabicCount(p) && p.length <= 60) return "rtl";
    var first = p.match(new RegExp("[A-Za-z]|" + AR_STRONG.source));
    var firstArabic = first && AR_STRONG.test(first[0]);
    var most = mostlyArabic(p);
    if (firstArabic && most) return "rtl";
    if (!firstArabic && !most) return "ltr";
    return docDir;
  }

  // Inline pieces: `code` in its own left-to-right box, **bold** in <b>, the rest boxed by
  // language the same way as repaired text
  // English alone inside a right-to-left line: boxed so its brackets keep their sides, with the
  // spaces and the punctuation at its edges left to the sentence
  function boxLtr(el, s) {
    var lead = s.match(/^\s*/)[0], core = s.slice(lead.length);
    var tail = core.match(/[\s.,:;!?]*$/)[0];
    core = core.slice(0, core.length - tail.length);
    while (/[)\]}]$/.test(core) && opened(core) < 0) { tail = core.slice(-1) + tail; core = core.slice(0, -1); }
    while (/^[(\[{]/.test(core) && opened(core) > 0) { lead += core.charAt(0); core = core.slice(1); }
    if (!core) { text(el, s); return; }
    if (lead) text(el, lead);
    var box = document.createElement("span");
    box.className = "ltr";
    box.dir = "ltr";
    text(box, core);
    el.appendChild(box);
    if (tail) text(el, tail);
  }

  function inline(el, s, dir) {
    s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    var pieces = s.split(MD_INLINE);
    for (var p = 0; p < pieces.length; p++) {
      var piece = pieces[p];
      if (!piece) continue;
      if (/^`[^`]+`$/.test(piece)) {
        var code = document.createElement("span");
        code.className = "ltr code";
        code.dir = "ltr";
        text(code, piece.slice(1, -1));
        el.appendChild(code);
      } else if (/^\*\*[^*]+\*\*$/.test(piece)) {
        var b = document.createElement("b");
        inline(b, piece.slice(2, -2), dir);
        el.appendChild(b);
      } else if (/^\*[^*]+\*$/.test(piece)) {
        var it = document.createElement("i");
        inline(it, piece.slice(1, -1), dir);
        el.appendChild(it);
      } else if (dir === "rtl" && !ARABIC.test(piece) && LATIN.test(piece)) {
        boxLtr(el, piece);
      } else if (dir === "rtl") {
        fill(el, piece);
      } else {
        fillEnglish(el, piece);
      }
    }
    return el;
  }

  // number: "1." of a numbered item, kept in its own left-to-right box so it does not show as
  // ".1" at the start of an Arabic line
  // indent: the spaces before a list marker; two (or a tab) per level of nesting
  function mdLine(s, kind, number, indent) {
    var div = document.createElement("div");
    div.className = "ln md" + (kind ? " " + kind : "");
    div.dir = lineDir(s, kind !== "" && kind !== "quote");
    var level = Math.floor((indent || "").replace(/	/g, "  ").length / 2);
    if (level > 0) div.style[div.dir === "rtl" ? "marginRight" : "marginLeft"] = (level * 1.6) + "em";
    if (div.dir === "ltr") div.className += " en";
    if (number) {
      var mark = document.createElement("span");
      mark.className = "mark";
      mark.dir = "ltr";
      text(mark, number);
      div.appendChild(mark);
      text(div, " ");
    }
    return inline(div, s, div.dir);
  }

  function mdTable(lines) {
    var rows = [], hasHeader = false;
    for (var i = 0; i < lines.length; i++) {
      if (MD_RULE.test(lines[i])) { if (i === 1) hasHeader = true; continue; }
      var t = lines[i].replace(/^\s*\|/, "").replace(/\|\s*$/, "");
      var cells = t.split("|");
      for (var c = 0; c < cells.length; c++) cells[c] = cells[c].replace(/^\s+|\s+$/g, "");
      rows.push(cells);
    }
    var table = document.createElement("table");
    table.dir = englishDoc ? "ltr" : "rtl";
    for (var r = 0; r < rows.length; r++) {
      var tr = table.insertRow(-1);
      for (c = 0; c < rows[r].length; c++) {
        var cell = document.createElement(r === 0 && hasHeader ? "th" : "td");
        cell.dir = lineDir(rows[r][c], true);
        tr.appendChild(inline(cell, rows[r][c], cell.dir));
      }
    }
    var holder = document.createElement("div");
    holder.className = "tbl";
    holder.appendChild(table);
    return holder;
  }

  function renderMarkdown(out, list) {
    while (out.firstChild) out.removeChild(out.firstChild);
    var whole = plainOf(list.join(NL));
    englishDoc = latinCount(whole) > arabicCount(whole);
    out.dir = englishDoc ? "ltr" : "rtl";
    for (var i = 0; i < list.length; ) {
      var s = list[i], m;
      if (MD_FENCE.test(s)) {
        var code = [];
        i++;
        while (i < list.length && !MD_FENCE.test(list[i])) code.push(list[i++]);
        i++;
        var pre = document.createElement("pre");
        pre.className = "code";
        pre.dir = "ltr";
        // Arabic phrases in code get their own boxes too, or "مصحح", "كما نُسخ" swap places
        fillEnglish(pre, code.join(NL));
        out.appendChild(pre);
      } else if (MD_TABLE.test(s)) {
        var block = [];
        while (i < list.length && MD_TABLE.test(list[i])) block.push(list[i++]);
        out.appendChild(mdTable(block));
      } else if ((m = s.match(MD_HEADING))) {
        out.appendChild(mdLine(m[2], "h" + Math.min(m[1].length, 3)));
        i++;
      } else if (MD_HR.test(s)) {
        out.appendChild(document.createElement("hr"));
        i++;
      } else if ((m = s.match(MD_QUOTE))) {
        out.appendChild(mdLine(m[1], "quote"));
        i++;
      } else if ((m = s.match(MD_ITEM))) {
        var numbered = /[0-9]/.test(m[2]);
        out.appendChild(mdLine(m[3], numbered ? "num" : "item", numbered ? m[2] : "", m[1]));
        i++;
      } else {
        out.appendChild(mdLine(s, ""));
        i++;
      }
    }
  }

  // ---- turns (clip2html --last) ----------------------------------------------------------------
  // A --last page also carries the conversation's last turns, each a prompt (ask) and its reply,
  // as JSON in #turns, oldest first; it opens on the newest. turn(-1) / turn(1) step back and
  // forward (← and → in the templates).
  var turns = [], turnAt = -1;

  function splitLines(s) { return s.split(new RegExp(CR + "?" + NL)); }

  function showReply(reply, asked) {
    var out = document.getElementById("out"), lines = splitLines(reply);
    renderMarkdown(out, lines);
    // The prompt the reply answers goes above it, as typed: each line only gets its direction
    if (asked.replace(/\s+/g, "")) {
      var box = youBox(), a = splitLines(asked);
      for (var i = 0; i < a.length; i++) box.appendChild(mdLine(a[i], ""));
      out.insertBefore(box, out.firstChild);
    }
    document.getElementById("count").innerText = lines.length + " سطر";
  }

  // The turn buttons show only when there is somewhere to go
  function showTurnAt() {
    var nav = document.getElementById("turns-nav"), at = document.getElementById("turn-at");
    var older = document.getElementById("older"), newer = document.getElementById("newer");
    if (nav) nav.style.display = turns.length > 1 ? "" : "none";
    if (at) at.innerText = "سؤال " + (turnAt + 1) + " من " + turns.length;
    if (older) older.disabled = turnAt <= 0;
    if (newer) newer.disabled = turnAt >= turns.length - 1;
  }

  function turn(step) {
    var next = Math.max(0, Math.min(turns.length - 1, turnAt + step));
    if (turns.length < 2 || next === turnAt) return false;
    turnAt = next;
    showReply(turns[turnAt].reply || "", turns[turnAt].ask || "");
    showTurnAt();
    window.scrollTo(0, 0);
    return true;
  }

  // The session's name (from --last) heads the page and names the window; a copy has none.
  // A name runs right to left only when it has Arabic. With other sessions listed (#sessions:
  // {at, list of {id, name, project, time}}) a dropdown offers them by name and folder; picking one asks the
  // template to load it (window.clipLoadSession), since only the template knows how.
  function trim(s) { return s.replace(/^\s+|\s+$/g, ""); }
  function nameDir(s) { return s.search(WORD) >= 0 ? "rtl" : "ltr"; }

  function showSession() {
    var box = document.getElementById("session-name"), data = document.getElementById("session");
    if (!box) return;
    var name = data ? trim(data.value) : "";
    var span = box.getElementsByTagName("span")[0], pick = document.getElementById("session-pick");
    var all = null, listed = document.getElementById("sessions");
    try { if (listed && listed.value) all = JSON.parse(listed.value); } catch (e) { }

    var many = pick && all && all.list && all.list.length > 1;
    box.style.display = name ? "" : "none";
    span.innerText = name;
    span.setAttribute("dir", nameDir(name));
    if (name) document.title = name;
    if (!pick) return;
    pick.style.display = many ? "" : "none";
    if (!many) return;

    while (pick.options.length) pick.remove(0);
    for (var i = 0; i < all.list.length; i++) {
      var s = all.list[i], label = trim(s.name || "") || "(بلا اسم)";
      var o = document.createElement("option");
      o.value = s.id;
      o.text = label + (s.project ? "  ·  " + s.project : "");
      o.setAttribute("dir", nameDir(label));
      pick.add(o);
      if (s.id === all.at) pick.selectedIndex = i;
    }
    pick.setAttribute("dir", nameDir(pick.options[pick.selectedIndex].text));
    pick.onchange = function () {
      var id = pick.value;
      if (!window.clipLoadSession) return;
      window.clipLoadSession(id, function (session) {
        if (!session || !session.turns || !session.turns.length) return;
        all.at = id;
        listed.value = JSON.stringify(all);
        useSession(session);
      });
    };
  }

  // Shows a loaded session as if the page had been made from it: its last turn, ← / → for the rest
  function useSession(session) {
    var last = session.turns[session.turns.length - 1], src = document.getElementById("source");
    document.getElementById("session").value = session.name || "";
    document.getElementById("turns").value = JSON.stringify(session.turns);
    document.getElementById("ask").value = last.ask || "";
    src.value = last.reply || "";
    src.setAttribute("data-mode", "markdown");
    start();
    window.scrollTo(0, 0);
  }

  function start() {
    showSession();
    var src = document.getElementById("source"), source = src.value;
    var ask = document.getElementById("ask"), data = document.getElementById("turns");
    turns = [];
    try { if (data && data.value) turns = JSON.parse(data.value); } catch (e) { }
    if (!turns || !turns.length) turns = [];
    turnAt = turns.length - 1;
    showTurnAt();
    if (src.getAttribute("data-mode") === "markdown") {
      showReply(source, ask ? ask.value : "");
      return;
    }
    var lines = splitLines(source);
    render(document.getElementById("out"), looksReversed(source) ? fixAll(lines) : lines);
    document.getElementById("count").innerText = lines.length + " سطر";
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { fixAll: fixAll, looksReversed: looksReversed, graphemes: graphemes };
  } else {
    start();
    // for the templates: start() shows the page again after they swap its text (an older page
    // in the HTA), turn(step) steps through the turns
    window.clip2html = { start: start, turn: turn };
  }
})();
