// Runs in the page (main world). Reads comment threads Google has loaded,
// including resolved ones that are hidden in the margin.
function collectDiscussions() {
  const UNSAFE = /update|accept|reject|delete|remove|flush|save|send|sync|render|expand|collapse|listen|dispatch|click|resolve|assign|focus|select|edit|submit|hide|show|scroll|copy|move|undo|redo|dispose|notify|fire|trigger|toggle|equals|compare|toString|valueOf|toJSON/i;

  function methodNames(obj) {
    const names = [];
    let proto = Object.getPrototypeOf(obj);
    for (let depth = 0; proto && proto !== Object.prototype && depth < 3; depth++) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name !== "constructor") names.push(name);
      }
      proto = Object.getPrototypeOf(proto);
    }
    return names;
  }

  function safeFns(obj) {
    const fns = [];
    for (const name of methodNames(obj)) {
      if (UNSAFE.test(name)) continue;
      let fn;
      try { fn = obj[name]; } catch { continue; }
      if (typeof fn === "function" && fn.length === 0) fns.push(fn);
    }
    return fns;
  }

  function decode(value) {
    return String(value)
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/\u00a0/g, " ")
      .replace(/\u200b/g, "");
  }

  function isNoise(value) {
    const text = value.trim();
    if (!text || text === "text/html") return true;
    if (/^(kix|suggest|doco)\.[\w-]+$/i.test(text)) return true;
    if (/^AA[A-Za-z0-9_-]{6,}$/.test(text)) return true;
    if (/^[a-z0-9]{10,24}$/i.test(text)) return true;
    if (/^https?:\/\//.test(text) || text.startsWith("//")) return true;
    return false;
  }

  function looksLikeName(value) {
    const text = value.trim();
    if (text.length < 2 || text.length > 80) return false;
    if (/https?:|\/\/|^kix\.|^suggest\.|^doco\.|^AA[A-Za-z0-9_-]{6,}$/.test(text)) return false;
    if (/^\d+$/.test(text) || /^[a-z0-9]{10,}$/i.test(text)) return false;
    return /[A-Za-zÀ-ÿ]/.test(text);
  }

  function callStrings(obj) {
    const strings = [];
    for (const fn of safeFns(obj)) {
      try {
        const value = fn.call(obj);
        if (typeof value === "string" && value.trim()) strings.push(decode(value));
      } catch { /* getter that needs more state */ }
    }
    return strings;
  }

  function contentStrings(obj) {
    return [...new Set(callStrings(obj).map((s) => s.trim()).filter((s) => !isNoise(s)))];
  }

  function longest(list) {
    return list.reduce((best, item) => (item.length > best.length ? item : best), "");
  }

  function metaOf(obj) {
    let author = "";
    let date = "";
    for (const fn of safeFns(obj)) {
      let value;
      try { value = fn.call(obj); } catch { continue; }
      if (!value || typeof value !== "object" || value instanceof Node) continue;
      let keys;
      try { keys = Object.getOwnPropertyNames(value); } catch { continue; }
      if (keys.length > 40) continue;
      for (const key of keys) {
        let field;
        try { field = value[key]; } catch { continue; }
        if (typeof field === "string" && !author && looksLikeName(field)) author = field.trim();
        if (typeof field === "number" && field > 1e9 && field < 2.2e9) {
          date = new Date(field * 1000).toISOString();
        }
      }
    }
    return { author, date };
  }

  function isPost(value) {
    return !!value && typeof value === "object"
      && typeof value.getId === "function"
      && typeof value.isDeleted === "function"
      && typeof value.isResolved !== "function";
  }

  function readPost(post) {
    let deleted = false;
    let id = "";
    try { deleted = !!post.isDeleted(); } catch { /* keep */ }
    try { id = String(post.getId()); } catch { /* keep */ }
    const meta = metaOf(post);
    return {
      id,
      author: meta.author,
      date: meta.date,
      body: longest(contentStrings(post)),
      deleted,
    };
  }

  function postsOf(discussion) {
    const posts = [];
    const seen = new Set();
    const add = (value) => {
      if (!isPost(value) || seen.has(value)) return;
      seen.add(value);
      posts.push(value);
    };
    for (const fn of safeFns(discussion)) {
      try { add(fn.call(discussion)); } catch { /* keep walking */ }
    }
    let keys = [];
    try { keys = Object.getOwnPropertyNames(discussion); } catch { keys = []; }
    for (const key of keys) {
      let value;
      try { value = discussion[key]; } catch { continue; }
      if (!value || typeof value !== "object") continue;
      add(value);
      if (isPost(value)) continue;
      let inner = [];
      try { inner = Object.keys(value); } catch { continue; }
      if (inner.length > 500) continue;
      for (const childKey of inner) {
        try { add(value[childKey]); } catch { /* keep */ }
      }
    }
    return posts;
  }

  function readDiscussion(discussion) {
    let resolved = false;
    let deleted = false;
    let id = "";
    try { resolved = !!discussion.isResolved(); } catch { /* keep */ }
    try { deleted = !!discussion.isDeleted(); } catch { /* keep */ }
    try { id = String(discussion.getId()); } catch { /* keep */ }
    const posts = postsOf(discussion);
    let root = posts.find((post) => {
      try { return String(post.getId()) === id; } catch { return false; }
    }) || null;
    if (!root && posts.length) root = posts[0];
    const replies = posts.filter((post) => post !== root).map(readPost);
    replies.sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.id.localeCompare(b.id));
    const rootPost = root ? readPost(root) : { author: "", date: "", body: "", deleted: false };
    const discStrings = contentStrings(discussion);
    const rootStrings = root ? contentStrings(root) : [];
    const raw = [...callStrings(discussion), ...(root ? callStrings(root) : [])];
    const shared = rootStrings.filter((text) => discStrings.some((other) => other.trim() === text.trim()));
    const quote = longest(shared.length ? shared : discStrings);
    const body = longest(rootStrings.filter((text) => text.trim() !== quote.trim())) || rootPost.body;
    const suggestion = raw.some((text) => text.trim().startsWith("suggest."));
    return {
      id,
      resolved,
      deleted,
      kind: suggestion ? "suggestion" : "comment",
      quote,
      body: body && body.trim() !== quote.trim() ? body : (rootPost.body || ""),
      author: rootPost.author,
      date: rootPost.date,
      replies: replies.filter((reply) => reply.body),
    };
  }

  const starts = [];
  const roots = document.querySelectorAll(".docos, .docos-anchoreddocoview, .docos-streamdocoview, .kix-appview-editor");
  for (const el of [...roots].slice(0, 8)) {
    for (const key of Object.getOwnPropertyNames(el)) {
      try {
        const value = el[key];
        if (value && typeof value === "object") starts.push(value);
      } catch { /* host object */ }
    }
  }

  const seen = new Set();
  const queue = starts.map((obj) => [obj, 0]);
  const found = [];
  const deadline = Date.now() + 1500;
  while (queue.length && seen.size < 15000 && Date.now() < deadline) {
    const [obj, depth] = queue.pop();
    if (!obj || typeof obj !== "object" || seen.has(obj) || depth > 8) continue;
    if (typeof Node !== "undefined" && obj instanceof Node) continue;
    if (typeof Window !== "undefined" && obj instanceof Window) continue;
    seen.add(obj);
    let keys = [];
    try { keys = Object.getOwnPropertyNames(obj); } catch { continue; }
    const bulky = keys.length > 500;
    for (const key of keys) {
      let value;
      try { value = obj[key]; } catch { continue; }
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      if (typeof Node !== "undefined" && value instanceof Node) continue;
      let discussion = false;
      try {
        discussion = typeof value.isResolved === "function" && typeof value.getId === "function";
      } catch { discussion = false; }
      if (discussion) {
        seen.add(value);
        found.push(value);
        continue;
      }
      if (!bulky && depth < 8) queue.push([value, depth + 1]);
    }
  }

  const discussions = [];
  const ids = new Set();
  for (const discussion of found) {
    const item = readDiscussion(discussion);
    if (!item.id || ids.has(item.id)) continue;
    ids.add(item.id);
    if (!item.quote && !item.body && !item.replies.length) continue;
    discussions.push(item);
  }
  return { ok: true, discussions };
}
