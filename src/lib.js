(function (root) {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const HEADINGS = {
    Title: 1, Subtitle: 2,
    Heading1: 1, Heading2: 2, Heading3: 3, Heading4: 4, Heading5: 5, Heading6: 6,
  };

  function local(node) {
    const name = node?.localName || "";
    const cut = name.indexOf(":");
    return cut < 0 ? name : name.slice(cut + 1);
  }

  function attr(el, name) {
    if (!el) return "";
    return el.getAttributeNS?.(W, name) || el.getAttribute("w:" + name) || el.getAttribute(name) || "";
  }

  function relAttr(el, name) {
    if (!el) return "";
    return el.getAttributeNS?.(REL, name) || el.getAttribute("r:" + name) || "";
  }

  function kids(el, name) {
    return [...(el?.childNodes || [])].filter((node) => local(node) === name);
  }

  function clean(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\u200b/g, "").replace(/\t/g, " ");
  }

  function norm(value) {
    return clean(value).replace(/\s+/g, " ").trim().toLowerCase();
  }

  async function inflate(bytes) {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const stream = new Response(copy).body.pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Not a Word document");
    const count = view.getUint16(eocd + 10, true);
    let cursor = view.getUint32(eocd + 16, true);
    const files = {};
    for (let i = 0; i < count; i++) {
      if (view.getUint32(cursor, true) !== 0x02014b50) break;
      const method = view.getUint16(cursor + 10, true);
      const size = view.getUint32(cursor + 20, true);
      const nameLen = view.getUint16(cursor + 28, true);
      const extraLen = view.getUint16(cursor + 30, true);
      const commentLen = view.getUint16(cursor + 32, true);
      const local = view.getUint32(cursor + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
      const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const compressed = bytes.subarray(dataStart, dataStart + size);
      if (method === 0) files[name] = compressed;
      else if (method === 8) files[name] = await inflate(compressed);
      cursor += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  function parseXml(bytes) {
    if (!bytes) return null;
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
    if (local(doc.documentElement) === "parsererror") throw new Error("Could not read the document");
    return doc;
  }

  function loadRels(doc) {
    const rels = {};
    if (!doc) return rels;
    for (const node of doc.getElementsByTagName("*")) {
      if (local(node) !== "Relationship") continue;
      const id = node.getAttribute("Id");
      const target = node.getAttribute("Target");
      if (id && target) rels[id] = target;
    }
    return rels;
  }

  function loadNumbering(doc) {
    const abstracts = {};
    const nums = {};
    if (!doc) return nums;
    for (const node of doc.documentElement.childNodes) {
      if (local(node) === "abstractNum") {
        const levels = {};
        for (const level of kids(node, "lvl")) {
          levels[attr(level, "ilvl") || "0"] = attr(kids(level, "numFmt")[0], "val") || "bullet";
        }
        abstracts[attr(node, "abstractNumId")] = levels;
      }
    }
    for (const node of doc.documentElement.childNodes) {
      if (local(node) !== "num") continue;
      nums[attr(node, "numId")] = abstracts[attr(kids(node, "abstractNumId")[0], "val")] || { 0: "bullet" };
    }
    return nums;
  }

  function formatDate(iso) {
    const date = new Date(iso);
    if (!iso || Number.isNaN(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1) + "-" + pad(date.getUTCDate())
      + " " + pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes()) + " UTC";
  }

  function runText(run) {
    let text = "";
    for (const child of run.childNodes) {
      if (local(child) === "t" || local(child) === "delText") text += child.textContent || "";
      else if (local(child) === "tab") text += "\t";
      else if (local(child) === "br" || local(child) === "cr") text += "\n";
    }
    return clean(text);
  }

  function on(el, name) {
    const node = kids(el, name)[0];
    if (!node) return false;
    const value = attr(node, "val");
    return !value || !/^(0|false|off|none|auto)$/i.test(value);
  }

  function runStyle(run) {
    const props = kids(run, "rPr")[0];
    if (!props) return {};
    const fonts = kids(props, "rFonts")[0];
    const font = attr(fonts, "ascii") || attr(fonts, "hAnsi");
    const align = attr(kids(props, "vertAlign")[0], "val");
    return {
      b: on(props, "b"),
      i: on(props, "i"),
      strike: on(props, "strike"),
      code: /mono|consolas|courier|source code|inconsolata|menlo/i.test(font),
      sup: align === "superscript",
      sub: align === "subscript",
    };
  }

  function styleText(text, style) {
    const match = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const core = match[2];
    if (!core || !style) return text;
    let body = core;
    if (style.code) body = body.includes("`") ? "`` " + body + " ``" : "`" + body + "`";
    if (style.strike) body = "~~" + body + "~~";
    if (style.b && style.i) body = "***" + body + "***";
    else if (style.b) body = "**" + body + "**";
    else if (style.i) body = "*" + body + "*";
    if (style.sup) body = "<sup>" + body + "</sup>";
    if (style.sub) body = "<sub>" + body + "</sub>";
    return match[1] + body + match[3];
  }

  function joinTokens(tokens) {
    let out = "";
    let buf = null;
    const flush = () => {
      if (!buf) return;
      out += styleText(buf.text, buf.style);
      buf = null;
    };
    for (const token of tokens) {
      if (token.raw != null) { flush(); out += token.raw; continue; }
      if (!token.text) continue;
      const key = JSON.stringify(token.style || {});
      if (buf && buf.key === key) buf.text += token.text;
      else { flush(); buf = { text: token.text, style: token.style, key }; }
    }
    flush();
    return out;
  }

  function formatLink(inner, href) {
    if (!href) return inner;
    const visible = inner.replace(/\s+/g, " ").trim();
    const plain = visible.replace(/[`*~\[\]]/g, "");
    if (!plain || plain === href) return href;
    return "[" + visible.replace(/\]/g, "\\]") + "](" + href + ")";
  }

  function renderInline(node, ctx) {
    const tokens = [];
    for (const child of node.childNodes || []) {
      const name = local(child);
      if (!name || name === "pPr" || name === "rPr" || name === "commentReference") continue;
      if (name === "r") {
        const text = runText(child);
        if (!text) continue;
        for (const id of ctx.active) ctx.quotes[id] = (ctx.quotes[id] || "") + text;
        if (ctx.mode === "md") tokens.push({ text, style: runStyle(child) });
      } else if (name === "hyperlink") {
        const inner = renderInline(child, ctx);
        if (ctx.mode === "md") tokens.push({ raw: formatLink(inner, ctx.rels[relAttr(child, "id")]) });
      } else if (name === "commentRangeStart") {
        const id = attr(child, "id");
        ctx.active.add(id);
        if (ctx.ranges[id]) ctx.ranges[id].start = ctx.offset;
      } else if (name === "commentRangeEnd") {
        const id = attr(child, "id");
        ctx.active.delete(id);
        if (ctx.ranges[id]) ctx.ranges[id].end = ctx.offset;
        if (ctx.mode === "md" && ctx.markers[id]) tokens.push({ raw: ctx.markers[id] });
      } else if (name === "drawing" || name === "pict" || name === "object") {
        if (ctx.mode === "md") tokens.push({ raw: " [image] " });
      } else if (name === "del") {
        const inner = renderInline(child, ctx);
        if (ctx.mode === "md" && inner.trim()) tokens.push({ raw: "~~" + inner + "~~" });
      } else {
        const inner = renderInline(child, ctx);
        if (ctx.mode === "md" && inner) tokens.push({ raw: inner });
      }
      if (name === "r") ctx.offset += runText(child).length;
    }
    return ctx.mode === "md" ? joinTokens(tokens) : "";
  }

  function listPrefix(numId, ilvl, numbering, counters) {
    const fmt = numbering[numId]?.[ilvl] || numbering[numId]?.[0] || "bullet";
    if (!counters[numId]) counters[numId] = [];
    const counts = counters[numId];
    counts[ilvl] = (counts[ilvl] || 0) + 1;
    for (let i = Number(ilvl) + 1; i < counts.length; i++) counts[i] = 0;
    const indent = "  ".repeat(Number(ilvl) || 0);
    return fmt === "bullet" ? indent + "- " : indent + counts[ilvl] + ". ";
  }

  function renderParagraph(p, ctx) {
    for (const id of ctx.active) {
      if (ctx.quotes[id] && !ctx.quotes[id].endsWith("\n")) ctx.quotes[id] += "\n";
    }
    const props = kids(p, "pPr")[0];
    const style = attr(kids(props, "pStyle")[0], "val");
    const numPr = kids(props, "numPr")[0];
    const inline = renderInline(p, ctx).replace(/[ \t]+\n/g, "\n").trim();
    if (!inline) return null;
    const level = HEADINGS[style];
    if (level) return { text: "#".repeat(level) + " " + inline, list: false };
    if (numPr) {
      const ilvl = attr(kids(numPr, "ilvl")[0], "val") || "0";
      const numId = attr(kids(numPr, "numId")[0], "val") || "0";
      return { text: listPrefix(numId, ilvl, ctx.numbering, ctx.counters) + inline, list: true };
    }
    return { text: inline, list: false };
  }

  function renderTable(tbl, ctx) {
    const rows = kids(tbl, "tr").map((row) => kids(row, "tc").map((cell) => {
      const parts = [];
      for (const child of cell.childNodes) {
        if (local(child) === "p") parts.push(renderInline(child, ctx).replace(/\s+/g, " ").trim());
        else if (local(child) === "tbl") parts.push(renderTable(child, ctx).replace(/\s+/g, " ").trim());
      }
      return parts.filter(Boolean).join(" ").replace(/\|/g, "\\|") || " ";
    }));
    if (!rows.length) return "";
    const width = Math.max(...rows.map((row) => row.length));
    const padded = rows.map((row) => row.concat(Array(width - row.length).fill(" ")));
    const line = (row) => "| " + row.join(" | ") + " |";
    return [line(padded[0]), line(padded[0].map(() => "---")), ...padded.slice(1).map(line)].join("\n");
  }

  function renderBlocks(node, ctx) {
    const blocks = [];
    const walk = (parent) => {
      for (const child of parent.childNodes || []) {
        if (local(child) === "p") {
          const block = renderParagraph(child, ctx);
          if (block) blocks.push(block);
        } else if (local(child) === "tbl") {
          const text = renderTable(child, ctx);
          if (text) blocks.push({ text, list: false });
        } else if (local(child) === "sdt" || local(child) === "sdtContent" || local(child) === "customXml") {
          walk(child);
        }
      }
    };
    walk(node);
    let out = "";
    let previous = null;
    for (const block of blocks) {
      if (!out) { out = block.text; previous = block; continue; }
      out += (block.list && previous?.list ? "\n" : "\n\n") + block.text;
      previous = block;
    }
    return out;
  }

  function loadComments(doc) {
    const comments = {};
    if (!doc) return comments;
    for (const node of doc.documentElement.childNodes) {
      if (local(node) !== "comment") continue;
      const paragraphs = kids(node, "p").map((p) => renderInline(p, emptyCtx()).trim()).filter(Boolean);
      comments[attr(node, "id")] = {
        id: attr(node, "id"),
        author: attr(node, "author") || "Unknown",
        date: formatDate(attr(node, "date")),
        iso: attr(node, "date"),
        body: paragraphs.join("\n\n"),
        quote: "",
        start: Number.MAX_SAFE_INTEGER,
        end: Number.MAX_SAFE_INTEGER,
      };
    }
    return comments;
  }

  function emptyCtx() {
    return { mode: "md", active: new Set(), quotes: {}, ranges: {}, markers: {}, rels: {}, offset: 0 };
  }

  function groupThreads(comments) {
    const list = Object.values(comments).sort((a, b) => a.start - b.start || (a.iso || "").localeCompare(b.iso || ""));
    const threads = [];
    for (const comment of list) {
      const quote = norm(comment.quote);
      if (comment.start === Number.MAX_SAFE_INTEGER) {
        threads.push({
          start: comment.start, end: comment.end, quote: comment.quote || "",
          messages: [comment], markerId: comment.id, kind: "comment", status: "open",
        });
        continue;
      }
      const hit = threads.find((thread) => {
        const overlaps = comment.start < thread.end && thread.start < comment.end;
        if (!overlaps || thread.start === Number.MAX_SAFE_INTEGER) return false;
        return quote ? quote === norm(thread.quote) : !norm(thread.quote);
      });
      if (hit) {
        hit.messages.push(comment);
        hit.start = Math.min(hit.start, comment.start);
        hit.end = Math.max(hit.end, comment.end);
        if ((comment.quote || "").length > (hit.quote || "").length) hit.quote = comment.quote;
      } else {
        threads.push({
          start: comment.start,
          end: comment.end,
          quote: comment.quote || "",
          messages: [comment],
          markerId: comment.id,
          kind: "comment",
          status: "open",
        });
      }
    }
    for (const thread of threads) {
      thread.messages.sort((a, b) => (a.iso || "").localeCompare(b.iso || "") || (Number(a.id) - Number(b.id)));
      let marker = thread.messages[0];
      for (const message of thread.messages) {
        if ((message.end ?? -1) >= (marker.end ?? -1)) marker = message;
      }
      thread.markerId = marker.id;
    }
    return threads;
  }

  function sameText(a, b) {
    const left = norm(a);
    const right = norm(b);
    if (!left || !right) return false;
    if (left.length < 20 || right.length < 20) return left === right;
    return right.includes(left.slice(0, 80)) || left.includes(right.slice(0, 80));
  }

  function score(thread, discussion) {
    const blobs = [discussion.quote, discussion.body, ...(discussion.replies || []).map((reply) => reply.body)];
    let best = 0;
    for (const field of [thread.quote, thread.messages[0]?.body]) {
      if (!field) continue;
      for (const blob of blobs) {
        if (!sameText(field, blob)) continue;
        const left = norm(field).length;
        const right = norm(blob).length;
        best = Math.max(best, left < 20 && left === right ? 80 : Math.min(left, right));
      }
    }
    return best;
  }

  function mergeDiscussions(threads, discussions) {
    if (!discussions?.length) return;
    const used = new Set();
    for (const thread of threads) {
      let best = -1;
      let bestScore = 0;
      discussions.forEach((discussion, index) => {
        const value = score(thread, discussion);
        if (value > bestScore) { bestScore = value; best = index; }
      });
      if (best >= 0 && bestScore >= 12) {
        used.add(best);
        const discussion = discussions[best];
        thread.status = discussion.deleted ? "deleted" : discussion.resolved ? "resolved" : "open";
        if (discussion.kind === "suggestion") thread.kind = "suggestion";
      }
    }
    for (let index = 0; index < discussions.length; index++) {
      if (used.has(index)) continue;
      const discussion = discussions[index];
      if (threads.some((thread) => score(thread, discussion) >= 12)) continue;
      const messages = [];
      if (discussion.body || discussion.author) {
        messages.push({
          author: discussion.author || "Unknown",
          date: formatDate(discussion.date),
          body: discussion.body || "",
          deleted: discussion.deleted,
        });
      }
      for (const reply of discussion.replies || []) {
        messages.push({
          author: reply.author || "Unknown",
          date: formatDate(reply.date),
          body: reply.body || "",
          deleted: reply.deleted,
        });
      }
      if (!messages.length && !discussion.quote) continue;
      threads.push({
        kind: discussion.kind || "comment",
        status: discussion.deleted ? "deleted" : discussion.resolved ? "resolved" : "open",
        quote: discussion.quote || "",
        messages,
        markerId: null,
      });
    }
  }

  function oneLine(value) {
    const text = clean(value).replace(/\s+/g, " ").trim();
    return text.length > 500 ? text.slice(0, 500).trim() + "…" : text;
  }

  function messageBlock(message, reply) {
    const who = "**" + (message.author || "Unknown") + "**"
      + (message.date ? " · " + message.date : "")
      + (message.deleted ? " · deleted" : "");
    const body = (message.body || "").trim() || "_(empty)_";
    if (!reply) return who + "\n\n" + body;
    return "> " + who + "\n>\n" + body.split("\n").map((line) => (line ? "> " + line : ">")).join("\n");
  }

  function renderThread(thread) {
    const bits = [thread.label, thread.kind === "suggestion" ? "suggestion" : "", thread.status].filter(Boolean);
    const lines = ["### " + bits.join(" · ")];
    const sameAsBody = norm(thread.quote) === norm(thread.messages[0]?.body || "");
    if (thread.quote && !sameAsBody) lines.push("", "On: " + oneLine(thread.quote));
    thread.messages.forEach((message, index) => {
      lines.push("", messageBlock(message, index > 0));
    });
    return lines.join("\n");
  }

  function summary(threads) {
    const comments = threads.filter((thread) => thread.kind !== "suggestion");
    const count = (status) => comments.filter((thread) => thread.status === status).length;
    const parts = [];
    if (count("open")) parts.push(count("open") + " open");
    if (count("resolved")) parts.push(count("resolved") + " resolved");
    if (count("deleted")) parts.push(count("deleted") + " deleted");
    const suggestions = threads.length - comments.length;
    if (suggestions) parts.push(suggestions + (suggestions === 1 ? " suggestion" : " suggestions"));
    return parts.length ? parts.join(", ") : "none";
  }

  async function docxToMarkdown(buffer, opts) {
    const files = await unzip(buffer);
    const documentXml = parseXml(files["word/document.xml"]);
    if (!documentXml) throw new Error("This file has no document body");
    const rels = loadRels(parseXml(files["word/_rels/document.xml.rels"]));
    const numbering = loadNumbering(parseXml(files["word/numbering.xml"]));
    const comments = loadComments(parseXml(files["word/comments.xml"]));
    const body = [...documentXml.documentElement.childNodes].find((node) => local(node) === "body");

    const quoteCtx = {
      mode: "quote", active: new Set(), quotes: {}, ranges: {}, markers: {}, rels, offset: 0, numbering, counters: {},
    };
    for (const id of Object.keys(comments)) quoteCtx.ranges[id] = { start: null, end: null };
    renderBlocks(body, quoteCtx);
    for (const [id, range] of Object.entries(quoteCtx.ranges)) {
      if (!comments[id] || range.start == null) continue;
      comments[id].quote = (quoteCtx.quotes[id] || "").trim();
      comments[id].start = range.start;
      comments[id].end = range.end ?? range.start;
    }

    const all = groupThreads(comments);
    mergeDiscussions(all, opts.discussions);
    const threads = opts.content === "doc" ? [] : all.filter((thread) =>
      (opts.resolved !== false || thread.status !== "resolved")
      && (opts.suggestions !== false || thread.kind !== "suggestion"));
    const markers = {};
    threads.forEach((thread, index) => {
      thread.label = "c" + (index + 1);
      if (thread.markerId) markers[thread.markerId] = " [" + thread.label + "]";
    });

    const sections = [];
    if (opts.header !== false) {
      const head = ["# " + (opts.title || "Untitled document").trim()];
      if (opts.url) head.push("", opts.url);
      if (opts.content !== "doc") head.push("", "Comments: " + summary(threads));
      sections.push(head.join("\n"));
    }
    if (opts.content !== "comments") {
      const mdCtx = {
        mode: "md", active: new Set(), quotes: {}, ranges: quoteCtx.ranges, markers, rels, offset: 0, numbering, counters: {},
      };
      sections.push(renderBlocks(body, mdCtx).replace(/\n{3,}/g, "\n\n").trim());
    }
    if (threads.length) {
      const heading = opts.content === "comments" ? "## Comments" : "---\n\n## Comments";
      sections.push(heading + "\n\n" + threads.map(renderThread).join("\n\n"));
    }
    const markdown = sections.filter(Boolean).join("\n\n").trim();
    return { markdown: markdown && markdown + "\n", threads, summary: summary(threads) };
  }

  root.GDMD = { docxToMarkdown };
})(typeof globalThis !== "undefined" ? globalThis : self);
