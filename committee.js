const status = document.querySelector("#committeeStatus");
const grid = document.querySelector("#committeeGrid");
const count = document.querySelector("#committeeCount");
const errorPanel = document.querySelector("#committeeError");
const errorText = document.querySelector("#committeeErrorText");

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

function center(item) {
  return item.x + item.width / 2;
}

function columnText(items, minX, maxX) {
  return clean(items.filter((item) => center(item) >= minX && center(item) < maxX).map((item) => item.text).join(" "));
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

function initials(name) {
  const match = name.match(/\(\s*([A-Za-z]{2,8})\s*\)/);
  if (match) return match[1].toUpperCase();
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function photoCandidates(initial) {
  const raw = String(initial || "").trim();
  const bases = [...new Set([raw, raw.toUpperCase(), raw.toLowerCase()].filter(Boolean))];
  const folders = ["./", "./images/", "./image/", "./img/", "./photos/", "./photo/", "./committee-photos/", "./committee_photos/", "./assets/", "./assets/images/"];
  const extensions = ["", ".jpeg", ".jpg", ".png", ".gif", ".gpeg", ".webp", ".jfif", ".JPEG", ".JPG", ".PNG", ".GIF", ".GPEG", ".WEBP", ".JFIF"];
  const candidates = [];
  for (const folder of folders) {
    for (const base of bases) {
      for (const ext of extensions) {
        candidates.push(`${folder}${encodeURIComponent(base)}${ext}?v=24`);
      }
    }
  }
  return [...new Set(candidates.map((value) => value.replaceAll("%2F", "/")))];
}

function installCommitteePhoto(image) {
  const holder = image.closest(".committee-photo");
  const candidates = photoCandidates(holder?.dataset.initial || "");
  let index = 0;

  const showFallback = () => {
    holder?.classList.remove("image-ready");
    holder?.classList.add("image-missing");
  };
  const showImage = () => {
    holder?.classList.remove("image-missing");
    holder?.classList.add("image-ready");
  };
  const tryNext = () => {
    if (index >= candidates.length) {
      showFallback();
      return;
    }
    image.src = candidates[index];
    index += 1;
  };

  image.addEventListener("load", () => {
    if (image.naturalWidth > 0) showImage();
    else tryNext();
  });
  image.addEventListener("error", tryNext);
  tryNext();
}

function findHeaderColumns(lines, pageWidth) {
  const headerItems = lines
    .filter((line) => line.y < 115)
    .flatMap((line) => line.items);
  const groups = [
    { key: "name", pattern: /\b(Name|Initial)\b/i },
    { key: "designation", pattern: /\bDesignation\b/i },
    { key: "employeeId", pattern: /\b(Employee|Employee\s+ID)\b/i },
    { key: "role", pattern: /\b(Role|Committee)\b/i },
    { key: "room", pattern: /\bRoom\b/i },
    { key: "phone", pattern: /\b(Cell|Phone|Mobile)\b/i },
    { key: "email", pattern: /\bEmail\b/i },
  ];

  const anchors = groups
    .map((group) => {
      const matches = headerItems.filter((item) => group.pattern.test(item.text));
      if (!matches.length) return null;
      return {
        key: group.key,
        x: matches.reduce((sum, item) => sum + center(item), 0) / matches.length,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.x - b.x);

  if (!anchors.some((anchor) => anchor.key === "name") || !anchors.some((anchor) => anchor.key === "email")) {
    return null;
  }

  return Object.fromEntries(
    anchors.map((anchor, index) => {
      const previous = anchors[index - 1];
      const next = anchors[index + 1];
      return [
        anchor.key,
        {
          min: previous ? (previous.x + anchor.x) / 2 : pageWidth * 0.05,
          max: next ? (anchor.x + next.x) / 2 : pageWidth,
        },
      ];
    }),
  );
}

async function parseCommittee() {
  const pdfjs = await import("./pdf.min.js");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.js", import.meta.url).href;
  const response = await fetch(`./exam-committee.pdf?refresh=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`exam-committee.pdf returned HTTP ${response.status}.`);
  const document = await pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()) }).promise;
  const members = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items
      .filter((item) => item.str?.trim())
      .map((item) => ({
        text: clean(item.str),
        x: item.transform[4],
        y: viewport.height - item.transform[5],
        width: Math.max(item.width || 0, item.str.length * 2.5),
      }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const item of items) {
      let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 4);
      if (!line) {
        line = { y: item.y, items: [] };
        lines.push(line);
      }
      line.items.push(item);
    }

    const columns = findHeaderColumns(lines, viewport.width);
    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);
      const serialItem = line.items.find((item) => item.x < viewport.width * .055 && /^\d+$/.test(item.text));
      if (!serialItem) continue;
      const readColumn = (key, fallbackMin, fallbackMax) => {
        const range = columns?.[key];
        return columnText(
          line.items,
          range?.min ?? viewport.width * fallbackMin,
          range?.max ?? viewport.width * fallbackMax,
        );
      };
      const name = readColumn("name", .055, .26);
      const designation = readColumn("designation", .26, .42);
      const employeeId = readColumn("employeeId", .42, .51);
      const role = readColumn("role", .51, .60);
      const room = columns?.room ? readColumn("room", .60, .66) : "";
      const phone = readColumn("phone", columns?.room ? .66 : .60, .725);
      const emailMatches = line.items.map((item) => item.text).join(" ").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
      if (name) members.push({
        serial: Number(serialItem.text),
        name,
        designation,
        employeeId,
        role,
        room,
        phone,
        email: clean(emailMatches.join(", ")),
      });
    }
  }
  return members;
}

async function loadCommittee() {
  try {
    const members = await parseCommittee();
    if (!members.length) throw new Error("No committee-member rows were detected.");
    count.textContent = `${members.length} committee members`;
    grid.innerHTML = members.map((member) => {
      const memberInitial = initials(member.name);
      const displayPhone = formatPhoneNumbers(member.phone);
      return `
      <article class="committee-card ${/Convener|Contact Point/i.test(member.role) ? "lead" : ""}">
        <div class="committee-card-head">
          <span class="committee-photo" data-initial="${escapeHtml(memberInitial)}">
            <img
              alt="${escapeHtml(member.name)}"
              width="48"
              height="48"
              loading="lazy"
              decoding="async"
            >
            <b>${escapeHtml(memberInitial)}</b>
          </span>
          <div><h2>${escapeHtml(member.name)}</h2><p>${escapeHtml(member.designation)}</p></div>
        </div>
        <span class="role-pill">${escapeHtml(member.role)}</span>
        <dl>
          <div><dt>Room</dt><dd>${escapeHtml(member.room || "Not listed")}</dd></div>
          <div><dt>Phone</dt><dd>${member.phone ? `<a href="${primaryPhoneHref(member.phone)}">${escapeHtml(displayPhone)}</a>` : "Not listed"}</dd></div>
          <div><dt>Email</dt><dd>${member.email ? member.email.split(",").map((email) => `<a href="mailto:${escapeHtml(email.trim())}">${escapeHtml(email.trim())}</a>`).join("<br>") : "Not listed"}</dd></div>
          <div><dt>Employee ID</dt><dd>${escapeHtml(member.employeeId || "Not listed")}</dd></div>
        </dl>
      </article>
    `;
    }).join("");
    grid.querySelectorAll(".committee-photo img").forEach(installCommitteePhoto);
    status.className = "data-status ready";
    status.innerHTML = "<i></i> Contacts ready";
  } catch (error) {
    console.error(error);
    grid.classList.add("hidden");
    errorPanel.classList.remove("hidden");
    errorText.textContent = error.message;
    status.className = "data-status error";
    status.innerHTML = "<i></i> Contact error";
  }
}

if (!globalThis.__COMMITTEE_PARSER_TEST__) loadCommittee();

export { formatPhoneNumbers, parseCommittee };
