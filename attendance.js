const $ = (selector) => document.querySelector(selector);

const ui = {
  status: $("#attendanceStatus"),
  dateSelect: $("#dateSelect"),
  slotSelect: $("#slotSelect"),
  generateButton: $("#generateButton"),
  regenerateButton: $("#regenerateButton"),
  downloadButton: $("#downloadAttendanceButton"),
  downloadDocxButton: $("#downloadAttendanceDocxButton"),
  fileHint: $("#fileHint"),
  errorPanel: $("#attendanceError"),
  errorText: $("#attendanceErrorText"),
  summary: $("#attendanceSummary"),
  seatPlanName: $("#seatPlanName"),
  roomCount: $("#roomCount"),
  studentCount: $("#studentCount"),
  invigilatorCount: $("#invigilatorCount"),
  assignmentPanel: $("#assignmentPanel"),
  assignmentTitle: $("#assignmentTitle"),
  assignmentList: $("#assignmentList"),
  warningList: $("#warningList"),
};

const DEFAULT_TIMES = {
  A: "9:00 AM to 10:30 AM",
  B: "11:30 AM to 01:00 PM",
  C: "2:00 PM to 3:30 PM",
};

const MONTHS = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

let rosterInfo = {
  title: "Invigilator Duty Roster",
  year: new Date().getFullYear(),
  dates: [],
  times: { ...DEFAULT_TIMES },
};
let faculty = [];
let facultyContacts = [];
let currentSheet = null;
let pdfEnginePromise;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

function comparableName(name) {
  return normalize(
    String(name || "")
      .replace(/\([^)]*\)/g, "")
      .replace(/\b(Professor|Dr|Mr|Ms|Mrs|Most|Md|Eng)\.?\b/gi, ""),
  );
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

function groupItemsIntoLines(items, tolerance = 5) {
  const lines = [];
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

  for (const item of sorted) {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
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

async function pdfLinesFromUrl(url) {
  const pdfjs = await getPdfEngine();
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}refresh=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url.replace("./", "")} returned HTTP ${response.status}.`);
  const document = await pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()) }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
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

function extractSlotTimes(lines, currentTimes) {
  const times = { ...currentTimes };
  const patterns = [
    /Slot\s*([ABC])\s*[-:=]?\s*(\d{1,2}:?\d{0,2}\s*[AP]M\s*(?:to|-)\s*\d{1,2}:?\d{0,2}\s*[AP]M)/i,
    /\b([ABC])\s*[=:-]\s*(\d{1,2}:?\d{0,2}\s*[AP]M\s*(?:to|-)\s*\d{1,2}:?\d{0,2}\s*[AP]M)/i,
  ];
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.text.match(pattern);
      if (match) times[match[1].toUpperCase()] = cleanText(match[2].replace(/\s*-\s*/, " to "));
    }
  }
  return times;
}

function findTitle(lines) {
  return lines.find((line) => /Invigilator'?s Duty (Plan|Roster)/i.test(line.text))?.text || "";
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
    const serialItem = line.items.find((item) => item.x < pageWidth * 0.082 && /^\d+(?:\s+.+)?$/.test(item.text));
    if (!serialItem) continue;

    const serialMatch = serialItem.text.match(/^(\d+)(?:\s+(.+))?$/);
    const leadingName = serialMatch?.[2] || "";
    const remainingItems = line.items.filter((item) => item !== serialItem);
    const name = cleanText([leadingName, textInColumn(remainingItems, pageWidth * 0.08, pageWidth * 0.33)].filter(Boolean).join(" "));
    if (!name) continue;

    const rawInitial = textInColumn(remainingItems, pageWidth * 0.33, pageWidth * 0.396).replace(/\s+/g, "");
    const designation = textInColumn(remainingItems, pageWidth * 0.396, pageWidth * 0.515);
    const dutyStartX = dutyColumnStartX(header, pageWidth);
    const dutyItems = line.items.filter((item) => itemCenter(item) >= dutyStartX && /^[ABC]$/.test(item.text));
    const duties = [];

    for (const item of dutyItems) {
      if (!header?.columns?.length) continue;
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

async function parseRosterPdf() {
  const source = await pdfLinesFromUrl("./duty-roster.pdf");
  const people = [];
  let currentGroup = "";
  let primaryHeader = null;
  let title = "";
  let times = { ...DEFAULT_TIMES };

  for (const page of source.pages) {
    const pageHeader = extractHeader(page.lines, page.width);
    if (!primaryHeader && pageHeader.dates.length && pageHeader.columns.length) primaryHeader = pageHeader;
    if (!title) title = findTitle(page.lines);
    times = extractSlotTimes(page.lines, times);
    const parsed = parseFacultyRows(page.lines, page.pageNumber, page.width, pageHeader.dates.length ? pageHeader : primaryHeader, currentGroup);
    people.push(...parsed.people);
    currentGroup = parsed.group;
  }

  if (!people.length) throw new Error("No faculty rows were detected in duty-roster.pdf.");
  if (!primaryHeader?.dates.length) throw new Error("The exam dates were not detected in duty-roster.pdf.");

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
  const nameText = textInColumn(line.items, pageWidth * 0.045, pageWidth * 0.285).replace(/^\d+\s*/, "").trim();
  const initial = extractInitialFromName(nameText);
  if (!nameText || (!initial && !emailMatches.length)) return null;

  return {
    name: nameText,
    initial,
    designation: textInColumn(line.items, pageWidth * 0.285, pageWidth * 0.46),
    employeeId: textInColumn(line.items, pageWidth * 0.46, pageWidth * 0.57),
    phone: textInColumn(line.items, pageWidth * 0.57, pageWidth * 0.695),
    email: cleanText(emailMatches.join(", ")),
    group,
  };
}

async function parseFacultyListPdf() {
  const source = await pdfLinesFromUrl("./faculty-list.pdf");
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

  return records;
}

function findFacultyContact(person) {
  const nameKey = comparableName(person.name);
  const exactName = facultyContacts.find((record) => comparableName(record.name) === nameKey);
  if (exactName) return exactName;

  if (person.initial) {
    const initialMatches = facultyContacts.filter((record) => record.initial === person.initial);
    if (initialMatches.length === 1) return initialMatches[0];
    if (initialMatches.length > 1) {
      return initialMatches
        .map((record) => ({ record, score: Math.abs(comparableName(record.name).length - nameKey.length) }))
        .sort((a, b) => a.score - b.score)[0].record;
    }
  }
  return null;
}

function dateParts(label) {
  const [day, month] = String(label || "").split("-");
  return { day: String(Number(day) || day), dayPadded: String(Number(day) || day).padStart(2, "0"), month: month || "" };
}

function displayDate(label) {
  const { dayPadded, month } = dateParts(label);
  return `${dayPadded}/${MONTHS[month.toLowerCase()] || "01"}/${rosterInfo.year}`;
}

function seatPlanCandidates(dateLabel, slot) {
  const { day, dayPadded } = dateParts(dateLabel);
  const upperSlot = slot.toUpperCase();
  return [...new Set([
    `${day}${upperSlot}_Seat Plan.pdf`,
    `${dayPadded}${upperSlot}_Seat Plan.pdf`,
    `${day}${upperSlot}_Seat Plan(1).pdf`,
    `${dayPadded}${upperSlot}_Seat Plan(1).pdf`,
    `${day}-${upperSlot}_Seat Plan.pdf`,
    `${dayPadded}-${upperSlot}_Seat Plan.pdf`,
    `${day}${upperSlot} Seat Plan.pdf`,
    `${dayPadded}${upperSlot} Seat Plan.pdf`,
    `seat-plan-${day}-${upperSlot}.pdf`,
    `seat-plan-${dayPadded}-${upperSlot}.pdf`,
    `seat_plan_${day}_${upperSlot}.pdf`,
    `seat_plan_${dayPadded}_${upperSlot}.pdf`,
  ])];
}

async function firstAvailableSeatPlan(dateLabel, slot) {
  const candidates = seatPlanCandidates(dateLabel, slot);
  for (const filename of candidates) {
    const response = await fetch(`./${filename}?refresh=${Date.now()}`, { cache: "no-store" });
    if (response.ok) return { filename, data: new Uint8Array(await response.arrayBuffer()) };
  }
  throw new Error(`No seat-plan PDF found for ${dateLabel}, Slot ${slot}. Tried: ${candidates.join(", ")}`);
}

function parseCountToken(token) {
  const value = String(token || "").trim();
  if (/^\d+\+\d+$/.test(value)) return value.split("+").reduce((sum, part) => sum + Number(part), 0);
  if (/^\d+\/\d+$/.test(value)) return Number(value.split("/")[0]);
  if (/^\d+$/.test(value)) return Number(value);
  return 0;
}

function countLineTotal(text) {
  const tokens = cleanText(text).split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || !tokens.every((token) => /^\d+(?:[+/]\d+)?$/.test(token))) return null;
  return tokens.reduce((sum, token) => sum + parseCountToken(token), 0);
}

function isStudentCountToken(value) {
  return /^\d+(?:[+/]\d+)?$/.test(String(value || "").trim());
}

function isOccupiedColumnText(value) {
  const text = cleanText(value);
  if (!text || /^Col-\d+$/i.test(text)) return false;
  return /^[A-Z]{2,}\d{3}/.test(text) || /^\d{2,}[_A-Z0-9+().-]*/.test(text) || /^[A-Z]{2,}(?:\+[A-Z]{2,})?$/.test(text);
}

function lineCountItems(line) {
  const directItems = line.items.filter((item) => isStudentCountToken(item.text));
  if (directItems.length) return directItems;

  const tokens = cleanText(line.text).split(/\s+/).filter(isStudentCountToken);
  if (tokens.length < 2) return [];
  const minX = Math.min(...line.items.map((item) => item.x));
  const maxX = Math.max(...line.items.map((item) => item.x + item.width));
  const step = tokens.length > 1 ? (maxX - minX) / (tokens.length - 1) : 0;
  return tokens.map((token, index) => ({
    text: token,
    x: minX + step * index,
    width: 1,
    y: line.y,
  }));
}

function roomStudentCount(room) {
  const countLines = room.lines.filter((line) => countLineTotal(line.text) !== null);
  const countLine = countLines.at(-1);
  if (!countLine) return 0;

  const countItems = lineCountItems(countLine);
  if (countItems.length < 2) return countLineTotal(countLine.text) || 0;

  const centers = countItems.map(itemCenter).sort((a, b) => a - b);
  const gaps = centers.slice(1).map((value, index) => value - centers[index]).filter((gap) => gap > 2);
  const minGap = gaps.length ? Math.min(...gaps) : 54;
  const tolerance = Math.max(22, Math.min(70, minGap * 0.48));
  const contentItems = room.lines
    .filter((line) => line.y < countLine.y - 2)
    .flatMap((line) => line.items)
    .filter((item) => isOccupiedColumnText(item.text));

  const occupiedIndexes = new Set();
  for (const item of contentItems) {
    const x = itemCenter(item);
    const index = nearestIndex(x, countItems, itemCenter);
    if (Math.abs(itemCenter(countItems[index]) - x) <= tolerance) occupiedIndexes.add(index);
  }

  let total = 0;
  for (const index of occupiedIndexes) {
    total += parseCountToken(countItems[index].text);
  }

  return occupiedIndexes.size ? total : countLineTotal(countLine.text) || 0;
}

async function parseSeatPlanPdf(dateLabel, slot) {
  const pdfjs = await getPdfEngine();
  const file = await firstAvailableSeatPlan(dateLabel, slot);
  const document = await pdfjs.getDocument({ data: file.data }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
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
    pages.push({ lines: groupItemsIntoLines(items) });
  }

  const allLines = pages.flatMap((page) => page.lines);
  const allText = allLines.map((line) => line.text).join(" ");
  const title = allLines.find((line) => /Examination/i.test(line.text))?.text || "Exam Room Attendance Sheet";
  const dateSlotLine = allLines.find((line) => /Date:\s*\d{1,2}-\d{1,2}-\d{4}.*Slot:/i.test(line.text))?.text || "";
  const timeMatch = dateSlotLine.match(/\(([^)]+)\)/);
  const totalMatch = allText.match(/Total Seat\(s\):\s*(\d+)/i);
  const rooms = [];

  let current = null;
  for (const line of allLines) {
    const roomMatch = line.text.match(/^Room\s+No\.\s*:\s*(.+)$/i);
    if (roomMatch) {
      if (current) rooms.push(current);
      current = { roomNo: cleanText(roomMatch[1]), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) rooms.push(current);

  const parsedRooms = rooms
    .map((room) => {
      const students = roomStudentCount(room);
      return {
        roomNo: room.roomNo,
        students,
        required: invigilatorRequirement(students),
      };
    })
    .filter((room) => room.students > 0);

  return {
    filename: file.filename,
    title,
    dateText: displayDate(dateLabel),
    slot,
    time: timeMatch ? cleanText(timeMatch[1].replace(/\s*-\s*/, " - ")) : rosterInfo.times[slot] || DEFAULT_TIMES[slot],
    totalStudents: totalMatch ? Number(totalMatch[1]) : parsedRooms.reduce((sum, room) => sum + room.students, 0),
    rooms: parsedRooms,
  };
}

function invigilatorRequirement(students) {
  if (students <= 30) return 1;
  if (students <= 55) return 2;
  if (students <= 75) return 3;
  return 4;
}

function facultyCategory(person) {
  const source = `${person.contact?.group || ""} ${person.group || ""}`.toLowerCase();
  if (source.includes("full time")) return "fulltime";
  if (source.includes("contractual")) return "contractual";
  if (source.includes("part-time") || source.includes("adjunct")) return "parttime";
  if (source.includes("other department")) return "other";
  return "unknown";
}

function isLecturerOrSeniorLecturer(person) {
  return /\b(Sr\.?\s*Lecturer|Senior Lecturer|Lecturer)\b/i.test(person.contact?.designation || person.designation || "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function displayTeacherName(name, initial = "") {
  let result = cleanText(name);
  if (initial) {
    result = result.replace(new RegExp(`\\s*\\(\\s*${escapeRegExp(initial)}\\s*\\)`, "gi"), "");
  }
  return cleanText(result.replace(/\s*\(\s*[A-Z]{2,8}\s*\)\s*$/g, ""));
}

function personLabel(person) {
  return displayTeacherName(person.name, person.initial);
}

function buildDutyPool(dateLabel, slot) {
  return faculty
    .filter((person) => person.duties.some((duty) => duty.date === dateLabel && duty.slot === slot))
    .map((person) => {
      const contact = findFacultyContact(person);
      return {
        ...person,
        contact,
        category: facultyCategory({ ...person, contact }),
      };
    });
}

function takeFirst(pool, predicate = () => true) {
  const index = pool.findIndex(predicate);
  if (index < 0) return null;
  return pool.splice(index, 1)[0];
}


function removeFromPool(pool, person) {
  const index = pool.findIndex((candidate) => candidate.id === person.id);
  if (index >= 0) pool.splice(index, 1);
}

function randomSample(items, count) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, Math.max(0, count));
}

function reserveRoomCandidates(pool) {
  const fulltimeLecturers = pool.filter((person) => person.category === "fulltime" && isLecturerOrSeniorLecturer(person));
  if (fulltimeLecturers.length) return fulltimeLecturers;
  return pool.filter((person) => person.category === "fulltime");
}

function assignInvigilators(rooms, dutyPool) {
  const requiredTotal = rooms.reduce((sum, room) => sum + room.required, 0);
  const extraCount = Math.max(0, dutyPool.length - requiredTotal);
  const reserve = [];
  const pool = [...dutyPool];
  const warnings = [];
  const assignments = [];

  if (extraCount > 0) {
    const eligibleReserve = reserveRoomCandidates(pool);
    const selectedReserve = randomSample(eligibleReserve, Math.min(extraCount, eligibleReserve.length));
    selectedReserve.forEach((person) => {
      reserve.push(person);
      removeFromPool(pool, person);
    });

    if (selectedReserve.length < extraCount) {
      warnings.push(`Only ${selectedReserve.length} full-time lecturer/senior lecturer reserve candidate(s) were available for Room 204. Any remaining extra duty faculty will be placed in normal rooms for manual review.`);
    }
  }

  for (const room of rooms) {
    const invigilators = [];

    if (room.required === 1) {
      const single =
        takeFirst(pool, (person) => person.category === "fulltime" && isLecturerOrSeniorLecturer(person)) ||
        takeFirst(pool, (person) => person.category === "fulltime") ||
        takeFirst(pool);
      if (single) invigilators.push(single);
      if (single && single.category !== "fulltime") {
        warnings.push(`Room ${room.roomNo} has only one invigilator and the assigned teacher is not full-time. Please review manually.`);
      }
    } else {
      const lead = takeFirst(pool, (person) => person.category === "fulltime") || takeFirst(pool);
      if (lead) invigilators.push(lead);
      while (invigilators.length < room.required) {
        const next = takeFirst(pool, (person) => person.category !== "fulltime") || takeFirst(pool);
        if (!next) break;
        invigilators.push(next);
      }
      if (!invigilators.some((person) => person.category === "fulltime")) {
        warnings.push(`Room ${room.roomNo} has no full-time faculty member. Please review manually.`);
      }
    }

    if (invigilators.length < room.required) {
      warnings.push(`Room ${room.roomNo} needs ${room.required} invigilator(s), but only ${invigilators.length} could be assigned from the duty roster.`);
    }

    assignments.push({
      ...room,
      invigilators: invigilators.map((person) => ({
        name: personLabel(person),
        initial: person.initial || "",
        category: person.category,
      })),
    });
  }

  if (pool.length) {
    const normalRooms = assignments.filter((room) => !room.isExtraRoom);
    pool.forEach((person, index) => {
      const target = normalRooms.find((room) => room.invigilators.some((teacher) => teacher.category === "fulltime")) || normalRooms[index % Math.max(1, normalRooms.length)];
      if (target) {
        target.invigilators.push({
          name: personLabel(person),
          initial: person.initial || "",
          category: person.category,
        });
      } else {
        reserve.push(person);
      }
    });
    warnings.push(`${pool.length} extra non-reserve invigilator${pool.length > 1 ? "s were" : " was"} added to regular room assignments for manual review instead of Room 204.`);
  }

  if (reserve.length) {
    assignments.push({
      roomNo: "204",
      students: 0,
      required: reserve.length,
      isExtraRoom: true,
      invigilators: reserve.map((person) => ({
        name: personLabel(person),
        initial: person.initial || "",
        category: person.category,
      })),
    });
    warnings.push(`${reserve.length} extra full-time lecturer/senior lecturer invigilator${reserve.length > 1 ? "s were" : " was"} randomly assigned to Room 204 at the end of the attendance sheet.`);
  }

  return { assignments, warnings };
}
function renderOptions() {
  ui.dateSelect.innerHTML = rosterInfo.dates
    .map((date) => `<option value="${escapeHtml(date.label)}">${escapeHtml(date.day ? `${date.day}, ${date.label}` : date.label)}</option>`)
    .join("");
  ui.slotSelect.value = "A";
  ui.dateSelect.disabled = false;
  ui.slotSelect.disabled = false;
  ui.generateButton.disabled = false;
  updateFileHint();
}

function updateFileHint() {
  const date = ui.dateSelect.value;
  const slot = ui.slotSelect.value;
  const candidates = seatPlanCandidates(date, slot).slice(0, 4).join(", ");
  ui.fileHint.innerHTML = `For ${escapeHtml(date)} Slot ${escapeHtml(slot)}, this page will try: <code>${escapeHtml(candidates)}</code>.`;
}

function setStatus(kind, text) {
  ui.status.className = `data-status ${kind === "ready" ? "ready" : kind === "error" ? "error" : ""}`;
  ui.status.innerHTML = `<i></i> ${escapeHtml(text)}`;
}

function showError(error) {
  ui.errorPanel.classList.remove("hidden");
  ui.errorText.textContent = error.message || String(error);
  setStatus("error", "Generator error");
}

function clearError() {
  ui.errorPanel.classList.add("hidden");
  ui.errorText.textContent = "";
}

function renderAssignments(sheet) {
  ui.assignmentTitle.textContent = `${sheet.seatPlan.dateText}, Slot ${sheet.seatPlan.slot} (${sheet.seatPlan.time})`;
  ui.assignmentList.innerHTML = sheet.assignments
    .map((room, roomIndex) => `
      <article class="assignment-room" data-room-index="${roomIndex}">
        <div class="assignment-room-head">
          <div>
            <strong>Room ${escapeHtml(room.roomNo)}</strong>
            <span>${room.isExtraRoom ? `Extra roster invigilator${room.invigilators.length > 1 ? "s" : ""}` : `${room.students} students / ${room.required} invigilator${room.required > 1 ? "s" : ""}`}</span>
          </div>
          <button class="quiet-button add-invigilator" type="button">Add invigilator</button>
        </div>
        <div class="assignment-teachers">
          ${room.invigilators.map((teacher, teacherIndex) => teacherInputRow(roomIndex, teacherIndex, teacher)).join("")}
        </div>
      </article>
    `)
    .join("");

  if (sheet.warnings.length) {
    ui.warningList.innerHTML = sheet.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("");
    ui.warningList.classList.remove("hidden");
  } else {
    ui.warningList.innerHTML = "";
    ui.warningList.classList.add("hidden");
  }

  ui.assignmentPanel.classList.remove("hidden");
}

function teacherInputRow(roomIndex, teacherIndex, teacher) {
  return `
    <div class="assignment-teacher" data-teacher-index="${teacherIndex}">
      <label>
        <span>Teacher name</span>
        <input type="text" value="${escapeHtml(teacher.name || "")}" data-field="name" data-room-index="${roomIndex}" data-teacher-index="${teacherIndex}">
      </label>
      <label>
        <span>Initial</span>
        <input type="text" value="${escapeHtml(teacher.initial || "")}" data-field="initial" data-room-index="${roomIndex}" data-teacher-index="${teacherIndex}">
      </label>
      <button class="quiet-button remove-invigilator" type="button" aria-label="Remove this invigilator">Remove</button>
    </div>
  `;
}

async function generateSheet() {
  clearError();
  setStatus("", "Reading seat plan");
  ui.generateButton.disabled = true;

  try {
    const dateLabel = ui.dateSelect.value;
    const slot = ui.slotSelect.value;
    const seatPlan = await parseSeatPlanPdf(dateLabel, slot);
    const dutyPool = buildDutyPool(dateLabel, slot);
    if (!dutyPool.length) throw new Error(`No duty-roster faculty were found for ${dateLabel}, Slot ${slot}.`);

    const result = assignInvigilators(seatPlan.rooms, dutyPool);
    currentSheet = { seatPlan, dutyPool, assignments: result.assignments, warnings: result.warnings };

    ui.seatPlanName.textContent = seatPlan.filename;
    ui.roomCount.textContent = seatPlan.rooms.length;
    ui.studentCount.textContent = seatPlan.totalStudents;
    ui.invigilatorCount.textContent = seatPlan.rooms.reduce((sum, room) => sum + room.required, 0);
    ui.summary.classList.remove("hidden");
    renderAssignments(currentSheet);
    setStatus("ready", "Sheet ready");
  } catch (error) {
    console.error(error);
    showError(error);
  } finally {
    ui.generateButton.disabled = false;
  }
}

function syncAssignmentsFromInputs() {
  if (!currentSheet) return;
  ui.assignmentList.querySelectorAll("input[data-field]").forEach((input) => {
    const roomIndex = Number(input.dataset.roomIndex);
    const teacherIndex = Number(input.dataset.teacherIndex);
    const field = input.dataset.field;
    if (currentSheet.assignments[roomIndex]?.invigilators[teacherIndex]) {
      currentSheet.assignments[roomIndex].invigilators[teacherIndex][field] = input.value.trim();
    }
  });
}

function cleanExamTitle() {
  return cleanText(rosterInfo.title)
    .replace(/^Invigilator'?s Duty (Plan|Roster) of\s*/i, "")
    .replace(/\s+-\s+/g, "- ")
    .replace(/Mid-term/i, "Midterm") || "Midterm Examination";
}

function parseStartTime(timeText) {
  const match = String(timeText || "").match(/(\d{1,2}):?(\d{2})?\s*([AP]M)/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const suffix = match[3].toUpperCase();
  if (suffix === "PM" && hour < 12) hour += 12;
  if (suffix === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function formatTimeFromMinutes(totalMinutes) {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  let hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  hour %= 12;
  if (hour === 0) hour = 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${suffix}`;
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

function wrapCanvasText(context, text, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
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
  return lines.length ? lines : [""];
}

function drawCellText(context, text, x, y, width, rowHeight, options = {}) {
  context.fillStyle = options.color || "#111111";
  context.font = `${options.weight || 400} ${options.size || 12}px Arial, sans-serif`;
  context.textAlign = options.align || "left";
  context.textBaseline = "top";
  const lines = wrapCanvasText(context, text, width - 8).slice(0, options.maxLines || 3);
  const lineHeight = options.lineHeight || options.size + 3 || 15;
  const startY = y + Math.max(4, (rowHeight - lines.length * lineHeight) / 2);
  lines.forEach((line, index) => {
    const textX = options.align === "center" ? x + width / 2 : x + 4;
    context.fillText(line, textX, startY + index * lineHeight);
  });
}

function sheetRows(assignments) {
  return assignments.flatMap((room) =>
    room.invigilators.map((teacher, index) => ({
      roomNo: index === 0 ? room.roomNo : "",
      roomGroup: room.roomNo,
      name: displayTeacherName(teacher.name, teacher.initial),
      initial: teacher.initial,
    })),
  );
}

function paginateRows(rows) {
  const probe = document.createElement("canvas").getContext("2d");
  const pages = [];
  let current = [];
  let used = 0;
  const maxHeight = 548;

  rows.forEach((row) => {
    probe.font = "400 12px Arial, sans-serif";
    const nameLines = wrapCanvasText(probe, row.name, 182);
    const height = Math.max(28, nameLines.length * 15 + 10);
    let pageRow = { ...row, height };
    if (current.length && used + height > maxHeight) {
      pages.push(current);
      current = [];
      used = 0;
    }
    if (!current.length && !pageRow.roomNo && pageRow.roomGroup) {
      pageRow = { ...pageRow, roomNo: `${pageRow.roomGroup}` };
    }
    current.push(pageRow);
    used += height;
  });

  if (current.length) pages.push(current);
  return pages;
}

function drawAttendancePage(sheet, rows, pageNumber, pageCount) {
  const scale = 2;
  const width = 612;
  const height = 792;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  context.scale(scale, scale);

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#111111";
  context.textAlign = "center";
  context.textBaseline = "top";
  context.font = "700 14px Arial, sans-serif";
  context.fillText("Daffodil International University", width / 2, 24);
  context.font = "700 14px Arial, sans-serif";
  context.fillText("Exam Room Attendance Sheet", width / 2, 43);
  context.font = "700 13px Arial, sans-serif";
  context.fillText(cleanExamTitle(), width / 2, 62);

  context.font = "700 11px Arial, sans-serif";
  context.textAlign = "left";
  context.fillText(`Date: ${sheet.seatPlan.dateText}`, 38, 94);
  context.fillText(`Exam Time: ${sheet.seatPlan.time}`, 180, 94);
  context.fillText(`Slot: ${sheet.seatPlan.slot}`, 415, 94);
  context.fillText("Center: 204 KT", 485, 94);

  const start = parseStartTime(sheet.seatPlan.time);
  const before = start === null ? "Before" : `Before ${formatTimeFromMinutes(start - 20)}`;
  const middle = start === null ? "Middle" : `${formatTimeFromMinutes(start - 20)} - ${formatTimeFromMinutes(start - 10)}`;
  const after = start === null ? "After" : `After ${formatTimeFromMinutes(start - 10)}`;

  const x = [34, 78, 278, 342, 408, 476, 536, 578];
  const headerY = 126;
  const headerHeight = 56;
  const contentTop = headerY + headerHeight;
  const tableEnd = contentTop + rows.reduce((sum, row) => sum + row.height, 0);
  context.strokeStyle = "#222222";
  context.lineWidth = 1;
  context.strokeRect(x[0], headerY, x.at(-1) - x[0], tableEnd - headerY);
  for (let index = 1; index < x.length - 1; index += 1) {
    context.beginPath();
    context.moveTo(x[index], headerY);
    context.lineTo(x[index], tableEnd);
    context.stroke();
  }
  context.beginPath();
  context.moveTo(x[0], contentTop);
  context.lineTo(x.at(-1), contentTop);
  context.stroke();

  drawCellText(context, "Room No.", x[0], headerY, x[1] - x[0], headerHeight, { weight: 700, size: 11, align: "center" });
  drawCellText(context, "Teacher Name", x[1], headerY, x[2] - x[1], headerHeight, { weight: 700, size: 11, align: "center" });
  drawCellText(context, "Teacher Initial", x[2], headerY, x[3] - x[2], headerHeight, { weight: 700, size: 11, align: "center" });
  drawCellText(context, `${before} (Signature)`, x[3], headerY, x[4] - x[3], headerHeight, { weight: 700, size: 9, align: "center" });
  drawCellText(context, `${middle} (Signature)`, x[4], headerY, x[5] - x[4], headerHeight, { weight: 700, size: 9, align: "center" });
  drawCellText(context, `${after} (Signature)`, x[5], headerY, x[6] - x[5], headerHeight, { weight: 700, size: 9, align: "center" });
  drawCellText(context, "Comment (For Exam Committee)", x[6], headerY, x[7] - x[6], headerHeight, { weight: 700, size: 8, align: "center" });

  let y = contentTop;
  let groupStartY = contentTop;

  rows.forEach((row, index) => {
    const rowBottom = y + row.height;
    const roomNo = row.roomGroup || row.roomNo || "";
    const nextRoomNo = rows[index + 1] ? rows[index + 1].roomGroup || rows[index + 1].roomNo || "" : "";
    const isRoomEnd = !rows[index + 1] || nextRoomNo !== roomNo;

    drawCellText(context, row.name, x[1], y, x[2] - x[1], row.height, { size: 11, maxLines: 3 });
    drawCellText(context, row.initial, x[2], y, x[3] - x[2], row.height, { weight: 700, size: 11, align: "center" });

    if (isRoomEnd) {
      drawCellText(context, roomNo, x[0], groupStartY, x[1] - x[0], rowBottom - groupStartY, { weight: 700, size: 11, align: "center" });
    }

    context.beginPath();
    context.moveTo(isRoomEnd ? x[0] : x[1], rowBottom);
    context.lineTo(x.at(-1), rowBottom);
    context.stroke();

    if (isRoomEnd) groupStartY = rowBottom;
    y = rowBottom;
  });

  context.fillStyle = "#ffffff";
  roundedRect(context, 36, 748, 188, 20, 4);
  context.fill();
  context.fillStyle = "#666666";
  context.font = "500 9px Arial, sans-serif";
  context.textAlign = "left";
  context.fillText("Developed by Md. Mahedi Hassan", 40, 754);
  context.textAlign = "right";
  context.fillText(`Page ${pageNumber} of ${pageCount}`, width - 34, 754);
  return canvas;
}

async function downloadAttendancePdf() {
  if (!currentSheet) return;
  syncAssignmentsFromInputs();
  ui.downloadButton.disabled = true;
  ui.downloadButton.textContent = "Preparing PDF";

  try {
    const rows = sheetRows(currentSheet.assignments);
    if (!rows.length) throw new Error("There are no invigilator rows to export.");
    const pages = paginateRows(rows);
    const { PDFDocument } = await import("./pdf-lib.min.js");
    const pdf = await PDFDocument.create();

    for (let index = 0; index < pages.length; index += 1) {
      const canvas = drawAttendancePage(currentSheet, pages[index], index + 1, pages.length);
      const image = await pdf.embedPng(canvas.toDataURL("image/png"));
      const page = pdf.addPage([612, 792]);
      page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
    }

    const bytes = await pdf.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const filenameDate = currentSheet.seatPlan.dateText.replaceAll("/", "-");
    const link = document.createElement("a");
    link.href = url;
    link.download = `attendance-sheet-${filenameDate}-slot-${currentSheet.seatPlan.slot}.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error(error);
    alert(`Could not create attendance PDF: ${error.message}`);
  } finally {
    ui.downloadButton.disabled = false;
    ui.downloadButton.textContent = "Download attendance PDF";
  }
}

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function docxParagraph(text, options = {}) {
  const justify = options.align ? `<w:jc w:val="${options.align}"/>` : "";
  const spacing = options.after !== undefined ? `<w:spacing w:after="${options.after}"/>` : "";
  const paragraphProps = justify || spacing ? `<w:pPr>${justify}${spacing}</w:pPr>` : "";
  const bold = options.bold ? "<w:b/>" : "";
  const size = options.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : "";
  const color = options.color ? `<w:color w:val="${options.color}"/>` : "";
  const runProps = bold || size || color ? `<w:rPr>${bold}${size}${color}</w:rPr>` : "";
  return `<w:p>${paragraphProps}<w:r>${runProps}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function docxCell(content, width, options = {}) {
  const merge = options.merge ? `<w:vMerge w:val="${options.merge}"/>` : "";
  const shade = options.shade ? `<w:shd w:fill="${options.shade}"/>` : "";
  const align = options.align || "left";
  const paragraphs = Array.isArray(content) ? content : [content];
  return `
    <w:tc>
      <w:tcPr>
        <w:tcW w:w="${width}" w:type="dxa"/>
        <w:vAlign w:val="center"/>
        ${merge}
        ${shade}
      </w:tcPr>
      ${paragraphs.map((text) => docxParagraph(text, { align, bold: options.bold, size: options.size || 20, after: 0 })).join("")}
    </w:tc>
  `;
}

function docxAttendanceRows(assignments) {
  const rows = [];
  for (const room of assignments) {
    const invigilators = room.invigilators.length ? room.invigilators : [{ name: "", initial: "" }];
    invigilators.forEach((teacher, index) => {
      rows.push({
        roomNo: room.roomNo,
        showRoom: index === 0,
        merge: invigilators.length > 1 ? (index === 0 ? "restart" : "continue") : "",
        name: displayTeacherName(teacher.name, teacher.initial),
        initial: teacher.initial || "",
      });
    });
  }
  return rows;
}

function docxTimingLabels(sheet) {
  const start = parseStartTime(sheet.seatPlan.time);
  return {
    before: start === null ? "Before" : `Before ${formatTimeFromMinutes(start - 20)}`,
    middle: start === null ? "Middle" : `${formatTimeFromMinutes(start - 20)} - ${formatTimeFromMinutes(start - 10)}`,
    after: start === null ? "After" : `After ${formatTimeFromMinutes(start - 10)}`,
  };
}

function docxHeaderXml(sheet) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  ${docxParagraph("Daffodil International University", { align: "center", bold: true, color: "000000", size: 28, after: 20 })}
  ${docxParagraph("Exam Room Attendance Sheet", { align: "center", bold: true, color: "000000", size: 28, after: 20 })}
  ${docxParagraph(cleanExamTitle(), { align: "center", bold: true, color: "000000", size: 26, after: 120 })}
  ${docxParagraph(`Date: ${sheet.seatPlan.dateText}        Exam Time: ${sheet.seatPlan.time}        Slot: ${sheet.seatPlan.slot}        Center: 204 KT`, { align: "center", bold: true, color: "000000", size: 22, after: 0 })}
</w:hdr>`;
}

function docxFooterXml() {
  const gray = "666666";
  const footerRunProps = `<w:rPr><w:color w:val="${gray}"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:tabs><w:tab w:val="right" w:pos="10800"/></w:tabs>
      <w:spacing w:after="0"/>
    </w:pPr>
    <w:r>${footerRunProps}<w:t>Developed by Md. Mahedi Hassan</w:t></w:r>
    <w:r><w:tab/></w:r>
    <w:r>${footerRunProps}<w:t xml:space="preserve">Page </w:t></w:r>
    <w:r>${footerRunProps}<w:fldChar w:fldCharType="begin"/></w:r>
    <w:r>${footerRunProps}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
    <w:r>${footerRunProps}<w:fldChar w:fldCharType="separate"/></w:r>
    <w:r>${footerRunProps}<w:t>1</w:t></w:r>
    <w:r>${footerRunProps}<w:fldChar w:fldCharType="end"/></w:r>
    <w:r>${footerRunProps}<w:t xml:space="preserve"> of </w:t></w:r>
    <w:r>${footerRunProps}<w:fldChar w:fldCharType="begin"/></w:r>
    <w:r>${footerRunProps}<w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r>
    <w:r>${footerRunProps}<w:fldChar w:fldCharType="separate"/></w:r>
    <w:r>${footerRunProps}<w:t>1</w:t></w:r>
    <w:r>${footerRunProps}<w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
</w:ftr>`;
}

function docxDocumentXml(sheet) {
  const { before, middle, after } = docxTimingLabels(sheet);
  const widths = [760, 3420, 1060, 1420, 1420, 1280, 900];
  const rows = docxAttendanceRows(sheet.assignments);
  const tableRows = rows.map((row) => `
    <w:tr>
      ${docxCell(row.showRoom ? row.roomNo : "", widths[0], { align: "center", bold: true, merge: row.merge })}
      ${docxCell(row.name, widths[1])}
      ${docxCell(row.initial, widths[2], { align: "center", bold: true })}
      ${docxCell("", widths[3])}
      ${docxCell("", widths[4])}
      ${docxCell("", widths[5])}
      ${docxCell("", widths[6])}
    </w:tr>
  `).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="10260" w:type="dxa"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="8" w:space="0" w:color="222222"/>
          <w:left w:val="single" w:sz="8" w:space="0" w:color="222222"/>
          <w:bottom w:val="single" w:sz="8" w:space="0" w:color="222222"/>
          <w:right w:val="single" w:sz="8" w:space="0" w:color="222222"/>
          <w:insideH w:val="single" w:sz="6" w:space="0" w:color="222222"/>
          <w:insideV w:val="single" w:sz="6" w:space="0" w:color="222222"/>
        </w:tblBorders>
        <w:tblCellMar>
          <w:top w:w="90" w:type="dxa"/>
          <w:left w:w="90" w:type="dxa"/>
          <w:bottom w:w="90" w:type="dxa"/>
          <w:right w:w="90" w:type="dxa"/>
        </w:tblCellMar>
      </w:tblPr>
      <w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>
      <w:tr>
        <w:trPr><w:tblHeader/></w:trPr>
        ${docxCell("Room No.", widths[0], { align: "center", bold: true, shade: "F1F3F0" })}
        ${docxCell("Teacher Name", widths[1], { align: "center", bold: true, shade: "F1F3F0" })}
        ${docxCell("Teacher Initial", widths[2], { align: "center", bold: true, shade: "F1F3F0" })}
        ${docxCell(`${before} (Signature)`, widths[3], { align: "center", bold: true, shade: "F1F3F0", size: 18 })}
        ${docxCell(`${middle} (Signature)`, widths[4], { align: "center", bold: true, shade: "F1F3F0", size: 18 })}
        ${docxCell(`${after} (Signature)`, widths[5], { align: "center", bold: true, shade: "F1F3F0", size: 18 })}
        ${docxCell("Comment (For Exam Committee)", widths[6], { align: "center", bold: true, shade: "F1F3F0", size: 18 })}
      </w:tr>
      ${tableRows}
    </w:tbl>
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId3"/>
      <w:footerReference w:type="default" r:id="rId4"/>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1900" w:right="720" w:bottom="900" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function push16(parts, value) {
  parts.push(value & 0xff, (value >>> 8) & 0xff);
}

function push32(parts, value) {
  parts.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function makeZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const stamp = dosDateTime();

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const crc = crc32(data);
    const local = [];
    push32(local, 0x04034b50);
    push16(local, 20);
    push16(local, 0x0800);
    push16(local, 0);
    push16(local, stamp.time);
    push16(local, stamp.day);
    push32(local, crc);
    push32(local, data.length);
    push32(local, data.length);
    push16(local, nameBytes.length);
    push16(local, 0);
    chunks.push(new Uint8Array(local), nameBytes, data);

    const header = [];
    push32(header, 0x02014b50);
    push16(header, 20);
    push16(header, 20);
    push16(header, 0x0800);
    push16(header, 0);
    push16(header, stamp.time);
    push16(header, stamp.day);
    push32(header, crc);
    push32(header, data.length);
    push32(header, data.length);
    push16(header, nameBytes.length);
    push16(header, 0);
    push16(header, 0);
    push16(header, 0);
    push16(header, 0);
    push32(header, 0);
    push32(header, offset);
    central.push(new Uint8Array(header), nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }

  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = [];
  push32(end, 0x06054b50);
  push16(end, 0);
  push16(end, 0);
  push16(end, files.length);
  push16(end, files.length);
  push32(end, centralSize);
  push32(end, offset);
  push16(end, 0);

  return new Blob([...chunks, ...central, new Uint8Array(end)], { type: "application/zip" });
}

function attendanceDocxBlob(sheet) {
  const now = new Date().toISOString();
  return makeZip([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    },
    {
      name: "word/_rels/document.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`,
    },
    {
      name: "word/styles.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/></w:rPr></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`,
    },
    {
      name: "word/settings.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:compat/></w:settings>`,
    },
    {
      name: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Exam Room Attendance Sheet</dc:title><dc:creator>Md. Mahedi Hassan</dc:creator><cp:lastModifiedBy>Invigilation Duty Finder</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
    },
    {
      name: "docProps/app.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Invigilation Duty Finder</Application></Properties>`,
    },
    { name: "word/header1.xml", data: docxHeaderXml(sheet) },
    { name: "word/footer1.xml", data: docxFooterXml(sheet) },
    { name: "word/document.xml", data: docxDocumentXml(sheet) },
  ]);
}

async function downloadAttendanceDocx() {
  if (!currentSheet) return;
  syncAssignmentsFromInputs();
  ui.downloadDocxButton.disabled = true;
  ui.downloadDocxButton.textContent = "Preparing DOCX";

  try {
    const blob = attendanceDocxBlob(currentSheet);
    const docxBlob = new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const url = URL.createObjectURL(docxBlob);
    const filenameDate = currentSheet.seatPlan.dateText.replaceAll("/", "-");
    const link = document.createElement("a");
    link.href = url;
    link.download = `attendance-sheet-${filenameDate}-slot-${currentSheet.seatPlan.slot}.docx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error(error);
    alert(`Could not create attendance DOCX: ${error.message}`);
  } finally {
    ui.downloadDocxButton.disabled = false;
    ui.downloadDocxButton.textContent = "Download attendance DOCX";
  }
}

async function loadInitialData() {
  try {
    setStatus("", "Reading roster");
    const [parsedRoster, contacts] = await Promise.all([parseRosterPdf(), parseFacultyListPdf()]);
    rosterInfo = parsedRoster.info;
    faculty = parsedRoster.people;
    facultyContacts = contacts;
    renderOptions();
    setStatus("ready", "Generator ready");
  } catch (error) {
    console.error(error);
    showError(error);
  }
}

ui.dateSelect.addEventListener("change", updateFileHint);
ui.slotSelect.addEventListener("change", updateFileHint);
ui.generateButton.addEventListener("click", generateSheet);
ui.regenerateButton.addEventListener("click", generateSheet);
ui.downloadButton.addEventListener("click", downloadAttendancePdf);
ui.downloadDocxButton.addEventListener("click", downloadAttendanceDocx);

ui.assignmentList.addEventListener("input", syncAssignmentsFromInputs);
ui.assignmentList.addEventListener("click", (event) => {
  if (!currentSheet) return;
  const roomElement = event.target.closest("[data-room-index]");
  const roomIndex = Number(roomElement?.dataset.roomIndex);
  if (!Number.isFinite(roomIndex)) return;

  if (event.target.closest(".add-invigilator")) {
    syncAssignmentsFromInputs();
    currentSheet.assignments[roomIndex].invigilators.push({ name: "", initial: "", category: "manual" });
    renderAssignments(currentSheet);
  }

  if (event.target.closest(".remove-invigilator")) {
    const teacherElement = event.target.closest("[data-teacher-index]");
    const teacherIndex = Number(teacherElement?.dataset.teacherIndex);
    syncAssignmentsFromInputs();
    currentSheet.assignments[roomIndex].invigilators.splice(teacherIndex, 1);
    renderAssignments(currentSheet);
  }
});

if (!globalThis.__ATTENDANCE_GENERATOR_TEST__) loadInitialData();

export {
  attendanceDocxBlob,
  assignInvigilators,
  countLineTotal,
  displayTeacherName,
  displayDate,
  docxAttendanceRows,
  invigilatorRequirement,
  parseCountToken,
  seatPlanCandidates,
  sheetRows,
};
