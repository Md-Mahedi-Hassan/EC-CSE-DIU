const $ = (selector) => document.querySelector(selector);

const ui = {
  dataStatus: $("#dataStatus"),
  reloadButton: $("#reloadButton"),
  search: $("#facultySearch"),
  clearSearch: $("#clearSearch"),
  suggestions: $("#suggestions"),
  facultyCount: $("#facultyCount"),
  loadingPanel: $("#loadingPanel"),
  loadingDetail: $("#loadingDetail"),
  errorPanel: $("#errorPanel"),
  errorMessage: $("#errorMessage"),
  emptyState: $("#emptyState"),
  personResults: $("#personResults"),
  facultyAvatar: $("#facultyAvatar"),
  facultyName: $("#facultyName"),
  facultyInitial: $("#facultyInitial"),
  facultyDesignation: $("#facultyDesignation"),
  facultyGroup: $("#facultyGroup"),
  outsideNotice: $("#outsideNotice"),
  totalDuties: $("#totalDuties"),
  totalDays: $("#totalDays"),
  firstDuty: $("#firstDuty"),
  noDuty: $("#noDuty"),
  schedulePanel: $("#schedulePanel"),
  dutyList: $("#dutyList"),
  examTitle: $("#examTitle"),
  publishedTitle: $("#publishedTitle"),
  publishedTitleText: $("#publishedTitleText"),
  facultyPhone: $("#facultyPhone"),
  facultyEmail: $("#facultyEmail"),
  contactMatchStatus: $("#contactMatchStatus"),
};

const DEFAULT_TIMES = {
  A: "9:00 AM to 10:30 AM",
  B: "11:15 AM to 12:45 PM",
  C: "1:30 PM to 3:00 PM",
};
const SLOT_LABELS = ["A", "B", "C"];
const TIME_TOKEN_SOURCE = String.raw`(?:[01]?\d|2[0-3])\s*[:.]\s*[0-5]\d\s*(?:[AaPp]\s*\.?\s*[Mm]\.?)`;
const TIME_RANGE_PATTERN = new RegExp(`(${TIME_TOKEN_SOURCE})\\s*(?:to|[-–—])\\s*(${TIME_TOKEN_SOURCE})`, "i");

let directory = [];
let facultyContacts = [];
let rosterInfo = {
  title: "Invigilator Duty Roster",
  year: new Date().getFullYear(),
  dates: [],
  times: { ...DEFAULT_TIMES },
};
let selectedFaculty = null;
let visibleSuggestions = [];
let activeSuggestion = -1;
let pdfEnginePromise;

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeTime(value) {
  return cleanText(value)
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

function formatPhoneNumbers(value) {
  return String(value || "")
    .split(",")
    .map((phone) => {
      const trimmed = phone.trim();
      return /^1/.test(trimmed) ? `0${trimmed}` : trimmed;
    })
    .filter(Boolean)
    .join(", ");
}

function primaryPhoneHref(value) {
  const firstPhone = formatPhoneNumbers(value).split(",")[0]?.trim() || "";
  return firstPhone ? `tel:${firstPhone.replace(/[^\d+]/g, "")}` : "#";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function initialsFromName(name) {
  const words = name
    .replace(/\([^)]*\)/g, "")
    .replace(/\b(Dr|Mr|Ms|Mrs|Most|Md|Eng)\.?\b/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (words.slice(0, 2).map((word) => word[0]).join("") || "FM").toUpperCase();
}

function comparableName(name) {
  return normalize(
    String(name || "")
      .replace(/\([^)]*\)/g, "")
      .replace(/\b(Professor|Dr|Mr|Ms|Mrs|Most|Md|Eng)\.?\b/gi, ""),
  );
}

function cleanInitial(value) {
  return String(value || "").replace(/[^A-Za-z]/g, "").toUpperCase();
}

function nameCloseness(leftName, rightName) {
  const left = comparableName(leftName);
  const right = comparableName(rightName);
  if (!left || !right) return 9999;
  if (left === right) return 0;
  if (left.includes(right) || right.includes(left)) return Math.abs(left.length - right.length) + 5;

  const leftTokens = new Set(String(leftName || "").toLowerCase().replace(/\([^)]*\)/g, "").split(/\s+/).map(normalize).filter(Boolean));
  const rightTokens = new Set(String(rightName || "").toLowerCase().replace(/\([^)]*\)/g, "").split(/\s+/).map(normalize).filter(Boolean));
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return 100 - overlap * 10 + Math.abs(left.length - right.length);
}


async function getPdfEngine() {
  if (!pdfEnginePromise) {
    pdfEnginePromise = import("./pdf.min.js").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.js", import.meta.url).href;
      return pdfjs;
    });
  }
  return pdfEnginePromise;
}

function groupItemsIntoLines(items) {
  const lines = [];
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

  for (const item of sorted) {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 5);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
    line.y = line.items.reduce((sum, current) => sum + current.y, 0) / line.items.length;
  }

  return lines
    .map((line) => {
      line.items.sort((a, b) => a.x - b.x);
      line.text = cleanText(line.items.map((item) => item.text).join(" "));
      return line;
    })
    .sort((a, b) => a.y - b.y);
}

async function pdfLinesFromUrl(url, progressLabel = "") {
  const pdfjs = await getPdfEngine();
  const response = await fetch(`${url}?refresh=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url.replace("./", "")} returned HTTP ${response.status}.`);
  const data = new Uint8Array(await response.arrayBuffer());
  const document = await pdfjs.getDocument({ data }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    if (progressLabel) ui.loadingDetail.textContent = `${progressLabel}: page ${pageNumber} of ${document.numPages}...`;
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items
      .filter((item) => item.str?.trim())
      .map((item) => ({
        text: cleanText(item.str),
        x: item.transform[4],
        y: viewport.height - item.transform[5],
        width: Math.max(item.width || 0, item.str.length * 2.5),
      }));
    pages.push({ pageNumber, width: viewport.width, height: viewport.height, lines: groupItemsIntoLines(items) });
  }
  return { pages, pageCount: document.numPages };
}

function itemCenter(item) {
  return item.x + item.width / 2;
}

function nearestIndex(value, candidates, accessor = (candidate) => candidate) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  candidates.forEach((candidate, index) => {
    const distance = Math.abs(accessor(candidate) - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function extractHeader(lines, pageWidth) {
  const headerLines = lines.filter((line) => line.y < 150);
  const dateItems = headerLines
    .flatMap((line) => line.items)
    .filter((item) => /^\d{1,2}-[A-Za-z]{3}$/.test(item.text))
    .map((item) => ({ label: item.text, x: itemCenter(item) }))
    .sort((a, b) => a.x - b.x);

  const dayItems = headerLines
    .flatMap((line) => line.items)
    .filter((item) => /^(SUN|MON|TUE|WED|THU|FRI|SAT)$/i.test(item.text))
    .map((item) => ({ label: item.text.toUpperCase(), x: itemCenter(item) }));

  const slotItems = headerLines
    .flatMap((line) => line.items)
    .filter((item) => /^[ABC]$/.test(item.text) && itemCenter(item) > pageWidth * 0.49)
    .map((item) => ({ slot: item.text, x: itemCenter(item) }))
    .sort((a, b) => a.x - b.x);

  const dates = dateItems.map((date) => ({
    ...date,
    day: dayItems.length ? dayItems[nearestIndex(date.x, dayItems, (item) => item.x)].label : "",
  }));

  const columns = slotItems.map((slot) => ({
    ...slot,
    dateIndex: nearestIndex(slot.x, dates, (date) => date.x),
  }));

  return { dates, columns };
}


function dutyColumnStartX(header, pageWidth) {
  const columns = [...(header?.columns || [])].sort((a, b) => a.x - b.x);
  if (!columns.length) return pageWidth * 0.48;
  const gaps = columns
    .slice(1)
    .map((column, index) => column.x - columns[index].x)
    .filter((gap) => Number.isFinite(gap) && gap > 2);
  const smallestGap = gaps.length ? Math.min(...gaps) : pageWidth * 0.025;
  return columns[0].x - Math.max(10, Math.min(24, smallestGap * 0.65));
}

function textInColumn(items, minX, maxX) {
  return cleanText(
    items
      .filter((item) => itemCenter(item) >= minX && itemCenter(item) < maxX)
      .map((item) => item.text)
      .join(" "),
  );
}

function readableGroup(group) {
  return cleanText(group)
    .replace(/^Department of CSE\s*/i, "")
    .replace(/Faculty members$/i, "Faculty")
    .replace(/Other Departments-Faculty/i, "Other Departments Faculty");
}

function parseFacultyRows(lines, pageNumber, pageWidth, header, currentGroup) {
  const people = [];
  let group = currentGroup;

  for (const line of lines) {
    if (/Faculty members/i.test(line.text)) {
      group = line.text;
      continue;
    }

    if (line.y < 135) continue;
    const serialItem = line.items.find(
      (item) => item.x < pageWidth * 0.082 && /^\d+(?:\s+.+)?$/.test(item.text),
    );
    if (!serialItem) continue;

    const serialMatch = serialItem.text.match(/^(\d+)(?:\s+(.+))?$/);
    const leadingName = serialMatch?.[2] || "";
    const remainingItems = line.items.filter((item) => item !== serialItem);
    const name = cleanText(
      [leadingName, textInColumn(remainingItems, pageWidth * 0.08, pageWidth * 0.33)]
        .filter(Boolean)
        .join(" "),
    );
    if (!name) continue;

    const rawInitial = textInColumn(remainingItems, pageWidth * 0.33, pageWidth * 0.396).replace(/\s+/g, "");
    const designation = textInColumn(remainingItems, pageWidth * 0.396, pageWidth * 0.515);
    const dutyStartX = dutyColumnStartX(header, pageWidth);
    const dutyItems = line.items.filter((item) => itemCenter(item) >= dutyStartX && /^[ABC]$/.test(item.text));
    const duties = [];

    for (const item of dutyItems) {
      if (!header.columns.length) continue;
      const column = header.columns[nearestIndex(itemCenter(item), header.columns, (candidate) => candidate.x)];
      const date = header.dates[column.dateIndex];
      if (!date) continue;
      const key = `${date.label}-${column.slot}`;
      if (duties.some((duty) => duty.key === key)) continue;
      duties.push({
        key,
        date: date.label,
        day: date.day,
        slot: column.slot,
        order: column.dateIndex * 10 + "ABC".indexOf(column.slot),
      });
    }

    people.push({
      id: `${pageNumber}-${serialMatch[1]}-${normalize(name)}-${normalize(rawInitial)}`,
      serial: serialMatch[1],
      page: pageNumber,
      name,
      initial: rawInitial.replace(/^\*/, ""),
      marked: rawInitial.startsWith("*"),
      designation: designation || "Designation not listed",
      group: readableGroup(group || "Faculty"),
      duties: duties.sort((a, b) => a.order - b.order),
    });
  }

  return { people, group };
}

function findTitle(lines) {
  const titleLine = lines.find((line) => /Invigilator'?s Duty (Plan|Roster)/i.test(line.text));
  return titleLine?.text || "";
}

function extractSlotTimes(lines, currentTimes) {
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

async function parseRosterPdf() {
  const source = await pdfLinesFromUrl("./duty-roster.pdf", "Reading duty roster");
  const people = [];
  let currentGroup = "";
  let primaryHeader = null;
  let title = "";
  let times = { ...DEFAULT_TIMES };

  for (const page of source.pages) {
    const { pageNumber, lines, width } = page;
    const pageHeader = extractHeader(lines, width);

    if (!primaryHeader && pageHeader.dates.length && pageHeader.columns.length) primaryHeader = pageHeader;
    if (!title) title = findTitle(lines);
    times = extractSlotTimes(lines, times);

    const parsed = parseFacultyRows(lines, pageNumber, width, pageHeader.dates.length ? pageHeader : primaryHeader, currentGroup);
    people.push(...parsed.people);
    currentGroup = parsed.group;
  }

  if (!people.length) throw new Error("No faculty rows were detected in the PDF.");
  if (!primaryHeader?.dates.length) throw new Error("The exam dates and slot columns were not detected.");

  const yearMatch = title.match(/\b(20\d{2})\b/);
  return {
    people,
    info: {
      title: title || "Invigilator Duty Roster",
      year: yearMatch ? Number(yearMatch[1]) : new Date().getFullYear(),
      dates: primaryHeader.dates,
      times,
      pages: source.pageCount,
    },
  };
}

function extractInitialFromName(name) {
  const matches = [...String(name).matchAll(/\(\s*([A-Za-z]{2,8})\s*\)/g)];
  return matches.at(-1)?.[1]?.toUpperCase() || "";
}

function parseContactLine(line, pageWidth, group) {
  if (line.y < 75) return null;
  const allText = line.text;
  const emailMatches = allText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const nameText = textInColumn(line.items, pageWidth * 0.045, pageWidth * 0.285)
    .replace(/^\d+\s*/, "")
    .trim();
  const initial = extractInitialFromName(nameText);
  if (!nameText || (!initial && !emailMatches.length)) return null;

  const designation = textInColumn(line.items, pageWidth * 0.285, pageWidth * 0.46);
  const employeeId = textInColumn(line.items, pageWidth * 0.46, pageWidth * 0.57);
  const phone = textInColumn(line.items, pageWidth * 0.57, pageWidth * 0.695);
  const email = cleanText(emailMatches.join(", "));

  return {
    name: nameText,
    initial,
    designation,
    employeeId,
    phone,
    email,
    group,
  };
}

async function parseFacultyListPdf() {
  const source = await pdfLinesFromUrl("./faculty-list.pdf", "Reading faculty contacts");
  const records = [];
  let group = "Full Time Faculty";

  for (const page of source.pages) {
    for (const line of page.lines) {
      if (/Contractual Faculty/i.test(line.text)) group = "Contractual Faculty";
      else if (/Part-Time Faculty|Adjunct Faculty/i.test(line.text)) group = "Part-time / Adjunct Faculty";
      else if (/BBA\/BBS|Other Department/i.test(line.text)) group = "Other Department Faculty";
      else if (/Assistant Technical Officer/i.test(line.text)) group = "Technical Staff";
      else if (/Student Associate/i.test(line.text)) group = "Student Associate";
      else if (/Teaching Assistant/i.test(line.text)) group = "Teaching Assistant";
      else if (/Visiting Researcher|Visiting Professor/i.test(line.text)) group = "Visiting Faculty";

      const record = parseContactLine(line, page.width, group);
      if (record) records.push(record);
    }
  }

  const deduplicated = [];
  for (const record of records) {
    const recordName = comparableName(record.name);
    const recordInitial = cleanInitial(record.initial);
    const existing = deduplicated.find((candidate) => {
      const candidateName = comparableName(candidate.name);
      if (candidateName !== recordName) return false;

      const candidateInitial = cleanInitial(candidate.initial);
      // Important: same/similar names with different initials are different faculty members.
      // Do not merge their phone/email records.
      if (candidateInitial && recordInitial && candidateInitial !== recordInitial) return false;
      return true;
    });

    if (!existing) deduplicated.push(record);
    else {
      existing.initial ||= record.initial;
      existing.designation ||= record.designation;
      existing.employeeId ||= record.employeeId;
      existing.phone ||= record.phone;
      existing.email ||= record.email;
      existing.group ||= record.group;
    }
  }
  return deduplicated;
}

function findFacultyContact(person) {
  const personInitial = cleanInitial(person.initial);
  const nameKey = comparableName(person.name);

  // First priority: initial must match. This prevents two faculty members with the same/similar
  // name but different initials from receiving the same phone/email record.
  if (personInitial) {
    const initialMatches = facultyContacts.filter((record) => cleanInitial(record.initial) === personInitial);
    if (initialMatches.length === 1) return initialMatches[0];
    if (initialMatches.length > 1) {
      return initialMatches
        .map((record) => ({
          record,
          score: nameCloseness(record.name, person.name),
        }))
        .sort((a, b) => a.score - b.score || comparableName(a.record.name).localeCompare(comparableName(b.record.name)))[0].record;
    }
  }

  // Fallback to name only when it is unambiguous and the contact initial is compatible.
  const exactNameMatches = facultyContacts.filter((record) => {
    if (comparableName(record.name) !== nameKey) return false;
    const recordInitial = cleanInitial(record.initial);
    return !personInitial || !recordInitial || recordInitial === personInitial;
  });

  if (exactNameMatches.length === 1) return exactNameMatches[0];
  if (exactNameMatches.length > 1) {
    const distinctInitials = new Set(exactNameMatches.map((record) => cleanInitial(record.initial)).filter(Boolean));
    if (distinctInitials.size <= 1) return exactNameMatches[0];
  }

  return null;
}


function hasRosterMatchForContact(contact, people) {
  const contactInitial = cleanInitial(contact.initial);
  const contactName = comparableName(contact.name);
  if (!contactName && !contactInitial) return true;

  if (contactInitial) {
    const initialMatches = people.filter((person) => cleanInitial(person.initial) === contactInitial);
    if (initialMatches.length === 1) return true;
    if (initialMatches.length > 1) {
      return initialMatches.some((person) => nameCloseness(person.name, contact.name) <= 8);
    }
  }

  return people.some((person) => {
    if (comparableName(person.name) !== contactName) return false;
    const personInitial = cleanInitial(person.initial);
    return !contactInitial || !personInitial || contactInitial === personInitial;
  });
}

function facultyListOnlyPerson(contact, index) {
  const initial = cleanInitial(contact.initial) || initialsFromName(contact.name);
  return {
    id: `faculty-list-only-${initial || index}-${normalize(contact.name)}-${index}`,
    serial: 100000 + index,
    name: cleanText(contact.name),
    initial,
    designation: contact.designation || "Designation not available",
    group: contact.group || "Faculty list",
    duties: [],
    marked: false,
    contact,
    facultyListOnly: true,
  };
}

function buildSearchDirectory(rosterPeople, contactRecords) {
  const combined = [...rosterPeople];
  contactRecords.forEach((contact, index) => {
    if (!contact?.name) return;
    if (hasRosterMatchForContact(contact, rosterPeople)) return;
    combined.push(facultyListOnlyPerson(contact, index));
  });
  return combined.sort((a, b) => {
    const aDuty = a.duties?.length ? 0 : 1;
    const bDuty = b.duties?.length ? 0 : 1;
    return aDuty - bDuty || cleanInitial(a.initial).localeCompare(cleanInitial(b.initial)) || a.name.localeCompare(b.name);
  });
}

function setLoadingState() {
  ui.loadingPanel.classList.remove("hidden");
  ui.errorPanel.classList.add("hidden");
  ui.emptyState.classList.add("hidden");
  ui.personResults.classList.add("hidden");
  ui.search.disabled = true;
  ui.dataStatus.className = "data-status";
  ui.dataStatus.innerHTML = "<i></i> Loading roster";
}

function setReadyState() {
  ui.loadingPanel.classList.add("hidden");
  ui.errorPanel.classList.add("hidden");
  ui.emptyState.classList.remove("hidden");
  ui.search.disabled = false;
  ui.facultyCount.textContent = `${directory.length} searchable faculty records and ${facultyContacts.length} faculty contacts indexed`;
  ui.publishedTitleText.textContent = rosterInfo.title;
  ui.publishedTitle.classList.remove("hidden");
  ui.dataStatus.className = "data-status ready";
  ui.dataStatus.innerHTML = "<i></i> Roster ready";
  ui.search.focus();
}

function setErrorState(error) {
  ui.loadingPanel.classList.add("hidden");
  ui.emptyState.classList.add("hidden");
  ui.personResults.classList.add("hidden");
  ui.errorPanel.classList.remove("hidden");
  ui.errorMessage.textContent = error?.message || "An unknown PDF parsing error occurred.";
  ui.facultyCount.textContent = "Roster unavailable";
  ui.dataStatus.className = "data-status error";
  ui.dataStatus.innerHTML = "<i></i> Roster error";
  ui.search.disabled = true;
}

async function loadRoster() {
  setLoadingState();
  selectedFaculty = null;
  ui.search.value = "";
  ui.clearSearch.classList.add("hidden");
  ui.suggestions.classList.add("hidden");

  try {
    const [parsed, contacts] = await Promise.all([parseRosterPdf(), parseFacultyListPdf()]);
    facultyContacts = contacts;
    directory = buildSearchDirectory(parsed.people, contacts);
    rosterInfo = parsed.info;
    setReadyState();
  } catch (error) {
    console.error(error);
    setErrorState(error);
  }
}

function searchDirectory(query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  return directory
    .map((person) => {
      const initial = normalize(person.initial);
      const name = normalize(person.name);
      let score = 100;
      if (initial === normalizedQuery) score = 0;
      else if (initial.startsWith(normalizedQuery)) score = 1;
      else if (name.startsWith(normalizedQuery)) score = 2;
      else if (name.includes(normalizedQuery)) score = 3;
      else if (initial.includes(normalizedQuery)) score = 4;
      return { person, score };
    })
    .filter((result) => result.score < 100)
    .sort((a, b) => a.score - b.score || a.person.name.localeCompare(b.person.name))
    .slice(0, 12)
    .map((result) => result.person);
}

function renderSuggestions() {
  const query = ui.search.value.trim();
  visibleSuggestions = searchDirectory(query);
  activeSuggestion = -1;

  if (!query) {
    ui.suggestions.classList.add("hidden");
    ui.suggestions.innerHTML = "";
    return;
  }

  if (!visibleSuggestions.length) {
    ui.suggestions.innerHTML = '<div class="no-suggestion">No matching faculty member found.</div>';
  } else {
    ui.suggestions.innerHTML = visibleSuggestions
      .map((person, index) => `
        <button class="suggestion" type="button" role="option" data-index="${index}">
          <span class="suggestion-avatar">${escapeHtml(initialsFromName(person.name))}</span>
          <span class="suggestion-copy">
            <strong>${escapeHtml(person.name)}</strong>
            <small>${escapeHtml(person.designation)} / ${escapeHtml(person.group)}${person.duties?.length ? "" : " / No duty"}</small>
          </span>
          <span class="suggestion-initial">${escapeHtml(person.initial || "No initial")}</span>
        </button>
      `)
      .join("");
  }
  ui.suggestions.classList.remove("hidden");
}

function dateParts(label) {
  const [day, month] = label.split("-");
  return { day, month: month?.toUpperCase() || "" };
}

function longDate(duty) {
  return `${duty.day ? `${duty.day}, ` : ""}${duty.date}-${rosterInfo.year}`;
}

function facultyDirectoryStatus(contact, person) {
  const group = `${contact?.group || ""} ${person.group || ""}`.toLowerCase();
  if (group.includes("contractual")) return "Contractual Faculty members";
  if (group.includes("part-time") || group.includes("adjunct")) return "Part-time Faculty members";
  if (group.includes("other department")) return "Other Departments-Faculty members";
  if (group.includes("full time")) return "Full Time Faculty members";
  return contact ? contact.group : "Faculty category not available";
}

function groupDutiesByDate(duties) {
  const groups = [];
  for (const duty of duties) {
    let group = groups.find((candidate) => candidate.date === duty.date);
    if (!group) {
      group = { date: duty.date, day: duty.day, duties: [] };
      groups.push(group);
    }
    group.duties.push(duty);
  }
  return groups;
}

function renderFaculty(person) {
  selectedFaculty = person;
  const contact = findFacultyContact(person);
  person.contact = contact;
  ui.search.value = person.initial || person.name;
  ui.clearSearch.classList.remove("hidden");
  ui.suggestions.classList.add("hidden");
  ui.emptyState.classList.add("hidden");
  ui.personResults.classList.remove("hidden");

  ui.facultyAvatar.textContent = initialsFromName(person.name);
  ui.facultyName.textContent = person.name;
  ui.facultyInitial.textContent = person.initial || "Initial not listed";
  ui.facultyDesignation.textContent = contact?.designation || person.designation;
  ui.facultyGroup.textContent = contact?.group || person.group;
  const phone = contact?.phone
    ? formatPhoneNumbers(contact.phone)
    : "Not available in faculty-list.pdf";
  const email = contact?.email || "Not available in faculty-list.pdf";
  ui.facultyPhone.textContent = phone;
  ui.facultyPhone.href = contact?.phone ? primaryPhoneHref(contact.phone) : "#";
  ui.facultyEmail.textContent = email;
  ui.facultyEmail.href = contact?.email ? `mailto:${contact.email.split(",")[0].trim()}` : "#";
  ui.contactMatchStatus.textContent = facultyDirectoryStatus(contact, person);
  ui.outsideNotice.classList.toggle("hidden", !person.marked);
  ui.totalDuties.textContent = person.duties.length;
  ui.totalDays.textContent = new Set(person.duties.map((duty) => duty.date)).size;
  ui.firstDuty.textContent = person.duties.length ? `${person.duties[0].date}, Slot ${person.duties[0].slot}` : "No duty";
  ui.examTitle.textContent = rosterInfo.title;
  ui.noDuty.classList.toggle("hidden", person.duties.length > 0);
  if (!person.duties.length) {
    ui.noDuty.innerHTML = person.facultyListOnly
      ? "<strong>No exam room duty is assigned for this faculty member.</strong><p>This faculty member is available in faculty-list.pdf, but no duty is listed in duty-roster.pdf.</p>"
      : "<strong>No CSE invigilation duty is listed for this faculty member.</strong><p>The faculty member appears in the roster, but no duty is assigned for the available dates/slots.</p>";
  }
  ui.schedulePanel.classList.toggle("hidden", person.duties.length === 0);

  ui.dutyList.innerHTML = groupDutiesByDate(person.duties)
    .map((dayGroup) => {
      const date = dateParts(dayGroup.date);
      const slotLabels = dayGroup.duties.map((duty) => `Slot ${duty.slot}`).join(", ");
      return `
        <article class="duty-row">
          <div class="date-tile">
            <strong>${escapeHtml(date.day)}</strong>
            <span>${escapeHtml(date.month)}</span>
          </div>
          <div class="daily-duty-content">
            <div class="daily-duty-heading">
              <strong>${escapeHtml(dayGroup.day || "Exam day")}, ${escapeHtml(dayGroup.date)}-${rosterInfo.year}</strong>
              <span>${escapeHtml(slotLabels)}</span>
            </div>
            <div class="daily-slots">
              ${dayGroup.duties.map((duty) => `
                <div class="duty-slot">
                  <span class="slot-badge slot-${duty.slot.toLowerCase()}">${escapeHtml(duty.slot)}</span>
                  <div>
                    <small>Slot ${escapeHtml(duty.slot)}</small>
                    <strong>${escapeHtml(rosterInfo.times[duty.slot] || DEFAULT_TIMES[duty.slot])}</strong>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  ui.personResults.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateActiveSuggestion(direction) {
  if (!visibleSuggestions.length) return;
  activeSuggestion = (activeSuggestion + direction + visibleSuggestions.length) % visibleSuggestions.length;
  [...ui.suggestions.querySelectorAll(".suggestion")].forEach((item, index) => {
    item.classList.toggle("active", index === activeSuggestion);
    if (index === activeSuggestion) item.scrollIntoView({ block: "nearest" });
  });
}

function clearSelection() {
  selectedFaculty = null;
  ui.search.value = "";
  ui.clearSearch.classList.add("hidden");
  ui.suggestions.classList.add("hidden");
  ui.personResults.classList.add("hidden");
  ui.emptyState.classList.remove("hidden");
  ui.search.focus();
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function drawText(context, text, x, y, options = {}) {
  context.fillStyle = options.color || "#17211b";
  context.font = `${options.weight || 400} ${options.size || 24}px ${options.font || "Arial, sans-serif"}`;
  context.textAlign = options.align || "left";
  context.textBaseline = options.baseline || "alphabetic";
  context.fillText(text, x, y);
}

function wrapText(context, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function buildRosterCanvas() {
  if (!selectedFaculty) return null;
  const duties = selectedFaculty.duties;
  const dutyDays = groupDutiesByDate(duties);
  const width = 1400;
  const headerHeight = 380;
  const summaryHeight = 170;
  const rowHeight = 132;
  const footerHeight = 150;
  const height = headerHeight + summaryHeight + Math.max(1, dutyDays.length) * rowHeight + footerHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  context.fillStyle = "#f4f6f1";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#176a45";
  context.fillRect(0, 0, width, 205);
  drawText(context, "CSE INVIGILATION DUTY", 80, 68, { color: "#d9eee1", size: 22, weight: 700 });
  drawText(context, selectedFaculty.name, 80, 128, { color: "#ffffff", size: 44, weight: 800 });
  drawText(context, `${selectedFaculty.initial || "Initial not listed"}  |  ${selectedFaculty.designation}`, 80, 173, { color: "#e3f2e8", size: 24, weight: 600 });

  context.fillStyle = "#fff4d9";
  roundedRect(context, 70, 225, width - 140, 92, 14);
  context.fill();
  context.strokeStyle = "#d3a44e";
  context.stroke();
  drawText(context, "IMPORTANT REMINDER", 100, 263, { color: "#8a570d", size: 19, weight: 850 });
  drawText(context, "Collect answer scripts and question papers at least 20 minutes before the exam starts.", 100, 296, { color: "#60461d", size: 21, weight: 700 });

  context.fillStyle = "#ffffff";
  roundedRect(context, 70, 337, width - 140, 205, 14);
  context.fill();
  context.strokeStyle = "#d9dfd8";
  context.lineWidth = 2;
  context.stroke();
  drawText(context, "PERSONAL DUTY SUMMARY", 100, 382, { color: "#176a45", size: 19, weight: 800 });
  drawText(context, String(duties.length), 105, 467, { size: 58, weight: 850 });
  drawText(context, "Total duties", 190, 462, { color: "#68736b", size: 24, weight: 600 });
  drawText(context, String(new Set(duties.map((duty) => duty.date)).size), 510, 467, { size: 58, weight: 850 });
  drawText(context, "Duty days", 595, 462, { color: "#68736b", size: 24, weight: 600 });
  drawText(context, selectedFaculty.contact?.phone ? formatPhoneNumbers(selectedFaculty.contact.phone) : "Phone unavailable", width - 100, 425, { color: "#176a45", size: 21, weight: 700, align: "right" });
  drawText(context, selectedFaculty.contact?.email || "Email unavailable", width - 100, 462, { color: "#68736b", size: 18, weight: 600, align: "right" });

  let y = 582;
  if (!duties.length) {
    context.fillStyle = "#ffffff";
    roundedRect(context, 70, y, width - 140, rowHeight - 18, 12);
    context.fill();
    drawText(context, "No CSE invigilation duty is listed.", width / 2, y + 58, { color: "#68736b", size: 28, weight: 700, align: "center" });
  }

  dutyDays.forEach((dayGroup, index) => {
    const rowY = y + index * rowHeight;
    context.fillStyle = "#ffffff";
    roundedRect(context, 70, rowY, width - 140, rowHeight - 14, 12);
    context.fill();
    context.strokeStyle = "#d9dfd8";
    context.stroke();

    drawText(context, `${dayGroup.day ? `${dayGroup.day}, ` : ""}${dayGroup.date}-${rosterInfo.year}`, 100, rowY + 42, { size: 25, weight: 800 });
    let slotX = 100;
    dayGroup.duties.forEach((duty) => {
      const slotColors = {
        A: ["#fbebea", "#a94242"],
        B: ["#fff4de", "#a16512"],
        C: ["#eaf1fb", "#365d94"],
      };
      const [background, color] = slotColors[duty.slot] || slotColors.A;
      context.fillStyle = background;
      roundedRect(context, slotX, rowY + 58, 355, 43, 8);
      context.fill();
      drawText(context, `Slot ${duty.slot}`, slotX + 18, rowY + 85, { color, size: 18, weight: 900 });
      drawText(context, rosterInfo.times[duty.slot] || DEFAULT_TIMES[duty.slot], slotX + 337, rowY + 85, { color: "#45534a", size: 16, weight: 700, align: "right" });
      slotX += 375;
    });
  });

  const footerY = height - footerHeight + 22;
  drawText(context, rosterInfo.title, 70, footerY, { color: "#68736b", size: 20, weight: 700 });
  context.font = "600 18px Arial, sans-serif";
  const noteLines = wrapText(context, "Please collect answer scripts and question papers from the exam control room at least 20 minutes before the exam starts.", width - 140);
  noteLines.forEach((line, index) => drawText(context, line, 70, footerY + 38 + index * 27, { color: "#445148", size: 18, weight: 600 }));
  drawText(context, "Developed by Md. Mahedi Hassan", width - 70, height - 35, { color: "#7d8780", size: 16, weight: 500, align: "right" });

  return canvas;
}

function rosterFilename(extension) {
  const name = (selectedFaculty?.initial || selectedFaculty?.name || "faculty")
    .replace(/[^A-Za-z0-9_-]+/g, "-");
  return `${name}-invigilation-duty.${extension}`;
}

function downloadRosterImage() {
  const canvas = buildRosterCanvas();
  if (!canvas) return;
  const link = document.createElement("a");
  link.download = rosterFilename("png");
  link.href = canvas.toDataURL("image/png");
  link.click();
}

async function downloadRosterPdf() {
  const canvas = buildRosterCanvas();
  if (!canvas) return;
  const button = $("#printRosterButton");
  const originalText = button.lastChild?.textContent || "Download PDF";
  button.disabled = true;
  if (button.lastChild) button.lastChild.textContent = " Preparing PDF";

  try {
    const { PDFDocument } = await import("./pdf-lib.min.js");
    const pdf = await PDFDocument.create();
    const png = await pdf.embedPng(canvas.toDataURL("image/png"));
    const scale = 0.6;
    const pageWidth = canvas.width * scale;
    const pageHeight = canvas.height * scale;
    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawImage(png, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    });

    const bytes = await pdf.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = rosterFilename("pdf");
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error(error);
    alert(`Could not create the PDF: ${error.message}`);
  } finally {
    button.disabled = false;
    if (button.lastChild) button.lastChild.textContent = originalText;
  }
}

function bootRosterPage() {
  if (!ui.search || !ui.reloadButton || !ui.suggestions) return;
ui.search.addEventListener("input", () => {
    ui.clearSearch.classList.toggle("hidden", !ui.search.value);
    renderSuggestions();
  });
  
  ui.search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      updateActiveSuggestion(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      updateActiveSuggestion(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const person = visibleSuggestions[activeSuggestion >= 0 ? activeSuggestion : 0];
      if (person) renderFaculty(person);
    } else if (event.key === "Escape") {
      ui.suggestions.classList.add("hidden");
    }
  });
  
  ui.suggestions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-index]");
    if (!button) return;
    const person = visibleSuggestions[Number(button.dataset.index)];
    if (person) renderFaculty(person);
  });
  
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#searchBox")) ui.suggestions.classList.add("hidden");
  });
  
  ui.clearSearch.addEventListener("click", clearSelection);
  ui.reloadButton.addEventListener("click", loadRoster);
  $("#tryAgainButton").addEventListener("click", loadRoster);
  $("#downloadImageButton").addEventListener("click", downloadRosterImage);
  $("#printRosterButton").addEventListener("click", downloadRosterPdf);
  
  }

if (!globalThis.__ROSTER_PARSER_TEST__) {
  bootRosterPage();
  loadRoster();
}



export {
  facultyDirectoryStatus,
  findFacultyContact,
  formatPhoneNumbers,
  groupDutiesByDate,
  buildSearchDirectory,
  parseRosterPdf,
  parseFacultyListPdf,
  searchDirectory,
};
