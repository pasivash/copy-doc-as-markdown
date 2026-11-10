import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";

globalThis.DOMParser = DOMParser;
await import("../src/lib.js");
const { docxToMarkdown } = globalThis.GDMD;

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const data = deflateRawSync(Buffer.from(text));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dir, end]));
}

const comment = (id, author, text) =>
  `<w:comment w:id="${id}" w:author="${author}" w:date="2026-01-0${id + 1}T10:00:00Z"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:comment>`;
const anchored = (id, text) =>
  `<w:commentRangeStart w:id="${id}"/><w:r><w:t>${text}</w:t></w:r><w:commentRangeEnd w:id="${id}"/>`;

const docx = zip({
  "word/document.xml": `<w:document ${NS}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Intro</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:t> start. </w:t></w:r>${anchored(0, "Open part here")}<w:r><w:t> and </w:t></w:r>${anchored(1, "Resolved part here")}</w:p>
    <w:p>${anchored(2, "Suggested change text")}</w:p>
  </w:body></w:document>`,
  "word/comments.xml": `<w:comments ${NS}>${comment(0, "Ann", "Please clarify this sentence")}${comment(1, "Bob", "Fixed the wording already")}${comment(2, "Cid", "Replace with something better")}</w:comments>`,
});

const discussions = [
  { id: "a", resolved: false, kind: "comment", quote: "Open part here", body: "Please clarify this sentence", replies: [] },
  { id: "b", resolved: true, kind: "comment", quote: "Resolved part here", body: "Fixed the wording already", replies: [] },
  { id: "c", resolved: false, kind: "suggestion", quote: "Suggested change text", body: "Replace with something better", replies: [] },
];

const convert = (opts) => docxToMarkdown(docx, { title: "Spec", url: "https://docs.google.com/document/d/x", discussions, ...opts });

test("full export has body, markers and every thread", async () => {
  const { markdown, summary } = await convert({});
  assert.match(markdown, /^# Spec\n\nhttps:\/\/docs\.google\.com\/document\/d\/x\n\nComments: /);
  assert.match(markdown, /# Intro/);
  assert.match(markdown, /\*\*Bold\*\* start\./);
  assert.match(markdown, /Open part here \[c1\]/);
  assert.match(markdown, /### c2 · resolved/);
  assert.match(markdown, /### c3 · suggestion · open/);
  assert.equal(summary, "1 open, 1 resolved, 1 suggestion");
});

test("hiding resolved threads and suggestions renumbers markers", async () => {
  const { markdown } = await convert({ resolved: false, suggestions: false });
  assert.match(markdown, /Open part here \[c1\]/);
  assert.doesNotMatch(markdown, /\[c2\]|Fixed the wording|Replace with something/);
  assert.match(markdown, /Resolved part here and|Resolved part here\n/);
});

test("comments only skips the body", async () => {
  const { markdown } = await convert({ content: "comments" });
  assert.doesNotMatch(markdown, /# Intro|\*\*Bold\*\*|\n---\n/);
  assert.match(markdown, /## Comments\n\n### c1 · open\n\nOn: Open part here/);
});

test("tracked changes become suggestions; live-only threads anchor by quote; title is not duplicated", async () => {
  const edit = (tag, text) => `<w:${tag} w:author="Sam" w:date="2026-01-05T10:00:00Z"><w:r><w:${tag === "del" ? "delText" : "t"}>${text}</w:${tag === "del" ? "delText" : "t"}></w:r></w:${tag}>`;
  const file = zip({
    "word/document.xml": `<w:document ${NS}><w:body>
      <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Plan</w:t></w:r></w:p>
      <w:p><w:r><w:t>Cut onboarding to five minutes.</w:t></w:r></w:p>
      <w:p><w:r><w:t>Support SSO for </w:t></w:r>${edit("ins", "Business")}${edit("del", "Team")}<w:r><w:t> plans</w:t></w:r></w:p>
    </w:body></w:document>`,
  });
  const live = [
    { id: "r", resolved: true, kind: "comment", quote: "Cut onboarding to five minutes.", body: "Baseline is 4m 30s", replies: [{ body: "Done" }] },
    { id: "s", resolved: false, kind: "suggestion", quote: "", body: "", replies: [] },
  ];
  const { markdown, summary } = await docxToMarkdown(file, { title: "Plan", discussions: live });
  assert.equal(markdown.match(/^# Plan$/gm).length, 1);
  assert.match(markdown, /Cut onboarding to five minutes\. \[c1\]/);
  assert.match(markdown, /Support SSO for Team \[c2\] plans/);
  assert.match(markdown, /### c1 · resolved[\s\S]*> Done/);
  assert.match(markdown, /### c2 · suggestion · open\n\n\*\*Sam\*\*.*\n\nReplace: "Team" with "Business"/);
  assert.equal(summary, "1 resolved, 1 suggestion");
});

test("document only drops comments and header summary", async () => {
  const { markdown } = await convert({ content: "doc", header: false });
  assert.match(markdown, /^# Intro/);
  assert.doesNotMatch(markdown, /Comments|\[c\d\]/);
});
