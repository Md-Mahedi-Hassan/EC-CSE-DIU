const status = document.querySelector("#guidelineStatus");
const list = document.querySelector("#guidelineList");
const title = document.querySelector("#guidelineTitle");
const slotOverview = document.querySelector("#slotOverview");
const markedNotice = document.querySelector("#markedNotice");
const cooperationNote = document.querySelector("#cooperationNote");
const centerName = document.querySelector("#centerName");

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const SLOT_LABELS = ["A", "B", "C"];
const TIME_TOKEN_SOURCE = String.raw`(?:[01]?\d|2[0-3])\s*[:.]\s*[0-5]\d\s*(?:[AaPp]\s*\.?\s*[Mm]\.?)`;
const TIME_RANGE_PATTERN = new RegExp(`(${TIME_TOKEN_SOURCE})\\s*(?:to|[-–—])\\s*(${TIME_TOKEN_SOURCE})`, "i");

function normalizeTime(value) {
  return clean(value)
    .replace(/(\d)\s*[.:]\s*(\d{2})/g, "$1:$2")
    .replace(/\s*([AP])\s*\.?\s*M\.?\b/gi, (_, marker) => ` ${marker.toUpperCase()}M`)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTimeRange(start, end) {
  return `${normalizeTime(start)} to ${normalizeTime(end)}`;
}

function applySlotTimePatterns(text, times) {
  const patterns = [
    new RegExp(`\\bSlot\\s*[:=]?\\s*([ABC])\\b\\s*(?:[-–—:=()\\s])*(${TIME_TOKEN_SOURCE})\\s*(?:to|[-–—])\\s*(${TIME_TOKEN_SOURCE})`, "gi"),
    new RegExp(`(?:^|[\\n|;])\\s*([ABC])\\b\\s*(?:[-–—:=()\\s])*(${TIME_TOKEN_SOURCE})\\s*(?:to|[-–—])\\s*(${TIME_TOKEN_SOURCE})`, "gi"),
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const slot = match[1]?.toUpperCase();
      if (SLOT_LABELS.includes(slot)) times[slot] = normalizeTimeRange(match[2], match[3]);
    }
  }
  return times;
}

function scheduleZoneText(lines) {
  const start = lines.findIndex((line) => /Exam\s+Slot\s+Schedule|Slot\s+Schedule|Exam\s+Timing/i.test(line.text));
  if (start < 0) return "";

  const zone = [];
  for (let index = start; index < Math.min(lines.length, start + 30); index += 1) {
    const text = lines[index]?.text || "";
    if (index > start && /^(Important Notice|N\.?\s*B\.?|\*\s*Marked|Marked Faculty|Contact Point|Convener)/i.test(text)) break;
    zone.push(text);
  }
  return zone.join("\n");
}

function extractRange(text) {
  const match = text.match(TIME_RANGE_PATTERN);
  return match ? normalizeTimeRange(match[1], match[2]) : "";
}

function extractSlotTimes(lines, currentTimes = {}) {
  const times = { ...currentTimes };
  const allText = lines.map((line) => line.text).join("\n");
  const scheduleText = scheduleZoneText(lines);

  applySlotTimePatterns(allText, times);
  if (scheduleText) applySlotTimePatterns(scheduleText, times);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const slotMatch = line.text.match(/\bSlot\s*[:=]?\s*([ABC])\b/i);
    if (!slotMatch) continue;

    const windowText = [line.text, lines[index + 1]?.text, lines[index + 2]?.text]
      .filter(Boolean)
      .join("\n");
    const range = extractRange(windowText);
    if (range) times[slotMatch[1].toUpperCase()] = range;
  }

  return times;
}

async function extractPageLines(page) {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = content.items
    .filter((item) => item.str?.trim())
    .map((item) => ({
      text: clean(item.str),
      x: item.transform[4],
      y: viewport.height - item.transform[5],
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const lines = [];
  for (const item of items) {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 5);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }
  lines.forEach((line) => {
    line.items.sort((a, b) => a.x - b.x);
    line.text = clean(line.items.map((item) => item.text).join(" "));
  });
  lines.sort((a, b) => a.y - b.y);
  return lines;
}

async function loadGuidelines() {
  try {
    const pdfjs = await import("./pdf.min.js");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.js", import.meta.url).href;
    const response = await fetch(`./duty-roster.pdf?refresh=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`duty-roster.pdf returned HTTP ${response.status}.`);
    const pdfDocument = await pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()) }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      status.innerHTML = `<i></i> Reading page ${pageNumber} of ${pdfDocument.numPages}`;
      const page = await pdfDocument.getPage(pageNumber);
      pages.push({ pageNumber, lines: await extractPageLines(page) });
    }

    const lines = pages.at(-1)?.lines || [];
    const allLines = pages.flatMap((page) => page.lines);
    const allText = lines.map((line) => line.text).join(" ");
    const publishedTitle = allLines.find((line) => /Invigilator'?s Duty (Plan|Roster)/i.test(line.text))?.text;
    if (publishedTitle) title.textContent = `Extracted from ${publishedTitle}.`;

    const times = extractSlotTimes(allLines, {});
    slotOverview.innerHTML = SLOT_LABELS.map((slot) => `
      <article class="${times[slot] ? "" : "slot-undetected"}">
        <b class="slot-badge slot-${slot.toLowerCase()}">${slot}</b>
        <div><span>Slot ${slot}</span><strong>${escapeHtml(times[slot] || "Time not detected from duty-roster.pdf")}</strong></div>
      </article>
    `).join("");

    const centerMatch = allText.match(/Center.*?(KT-?\s*204)|\b(KT-?\s*204)\b/i);
    if (centerMatch) centerName.textContent = `Center: ${(centerMatch[1] || centerMatch[2]).replace(/\s+/g, "")}`;

    const starLine = lines.find((line) => /Marked Faculty Members/i.test(line.text));
    if (starLine) markedNotice.textContent = starLine.text.replace(/^\*\s*/, "");

    const noticeStart = lines.findIndex((line) => /^1\.\s/.test(line.text));
    const noticeEnd = lines.findIndex((line, index) => index > noticeStart && /Md Jakaria|Contact Point|Convener/i.test(line.text));
    const noticeLines = lines.slice(noticeStart, noticeEnd > noticeStart ? noticeEnd : lines.length);
    const guidelines = [];
    let current = null;
    for (const line of noticeLines) {
      const start = line.text.match(/^(\d+)\.\s*(.*)/);
      if (start) {
        current = { number: Number(start[1]), text: start[2] };
        guidelines.push(current);
      } else if (current && line.text && !/^-{3,}/.test(line.text)) {
        current.text = clean(`${current.text} ${line.text}`);
      }
    }

    if (!guidelines.length) throw new Error("The numbered Important Notice section was not detected.");
    list.innerHTML = guidelines.map((item) => `
      <article class="guideline-item">
        <span>${item.number}</span>
        <p>${escapeHtml(item.text)}</p>
      </article>
    `).join("");

    const nbStart = lines.findIndex((line) => /^N\.\s*B\./i.test(line.text));
    if (nbStart >= 0) {
      const cooperation = [];
      for (let index = nbStart; index < noticeStart; index += 1) {
        if (lines[index]?.text) cooperation.push(lines[index].text);
      }
      if (cooperation.length) cooperationNote.textContent = clean(cooperation.join(" "));
    }

    status.className = "data-status ready";
    status.innerHTML = "<i></i> Guidelines ready";
  } catch (error) {
    console.error(error);
    status.className = "data-status error";
    status.innerHTML = "<i></i> Notice error";
    list.innerHTML = `<div class="no-suggestion">Could not extract guidelines: ${escapeHtml(error.message)}</div>`;
  }
}

if (!globalThis.__GUIDELINES_PARSER_TEST__) loadGuidelines();

export { extractSlotTimes, loadGuidelines };
