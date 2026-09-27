export const BAU_SLOTS = ["07:30–09:30", "11:15–12:15", "12:15–01:15", "02:00–03:00", "03:00–04:00", "04:00–05:00"];

export const BAU_COURSES = [
  ["1", "Entrepreneurship Development and Business Communication", "AEcon 211", "3 (2–1)", "Dr. Kerobium Lakra", "Dr. Neetu Kumari; Dr. Poulami Ray"],
  ["2", "Physical Education, First Aid, Yoga Practices and Meditation", "PE 211", "2 (0–2)", "Dr. Shivam Mishra", ""],
  ["3", "Principles of Genetics", "GPB 211", "3 (2–1)", "Dr. Surya Prakash", "Dr. Nutan Verma; Dr. Tajwar Izhar"],
  ["4", "Crop Production Technology - I (Kharif Crops)", "Agron 211", "3 (1–2)", "Dr. C.S. Singh", "Dr. Birendra Kumar; Dr. Shushama Majhi"],
  ["5", "Principles and Practices of Natural Farming", "Agron 212", "3 (2–1)", "Dr. Sudhir Kr. Singh", "Dr. Niketa Tirkey; Mrs. R.K. Lakra"],
  ["6", "Production Technology of Fruit and Plantation Crops", "Hort 211", "2 (1–1)", "Dr. Mahabub Alam", "Dr. S. Sengupta; Dr. A.K. Tiwary"],
  ["7", "Fundamentals of Extension Education", "AEE 211", "2 (1–1)", "Dr. Neetu Kumari", "Dr. Amandeep Ranjan; Dr. B.K. Jha"],
  ["8", "Fundamentals of Nematology", "PP 211", "2 (1–1)", "Dr. Lham Doriee", "Dr. Prity Priya; Dr. H.C. Lal"],
  ["9", "Soil Plant and Water Testing", "SS (SE) 211", "2 (0–2)", "Dr. S.B. Kumar", "Sri Bhupendra Kumar"],
  ["10", "Agriculture Waste Management", "AE (SE) 211", "2 (0–2)", "Er. Gaurav Sahu", "Dr. Asha Kumari Sinha; Dr. Nity Tirkey"],
];

export const BAU_DAYS = [
  {
    day: "Monday",
    cells: [
      { text: "PE 211" },
      { text: "GPB 211" },
      { text: "Agron 211" },
      { text: "AEcon 211" },
      { text: "—" },
      { text: "—" },
    ],
  },
  {
    day: "Tuesday",
    cells: [
      { text: "Agron 212 (A) / Hort 211 (B)" },
      { text: "SS (SE) 211", span: 2 },
      { text: "—" },
      { text: "PP 211 (A) / Agron 211 (B)" },
      { text: "—" },
    ],
  },
  {
    day: "Wednesday",
    cells: [
      { text: "Hort 211 (A) / Agron 212 (B)" },
      { text: "GPB 211" },
      { text: "AEcon 211" },
      { text: "Hort 211" },
      { text: "AEE 211 (P) A&B", span: 2 },
    ],
  },
  {
    day: "Thursday",
    cells: [
      { text: "GPB 211 (A) / Agron 211 (B)" },
      { text: "PP 211" },
      { text: "Agron 212" },
      { text: "—" },
      { text: "AEcon 211 (P) A&B", span: 2 },
    ],
  },
  {
    day: "Friday",
    cells: [
      { text: "GPB 211 (B) / Agron 211 (A)" },
      { text: "Agron 212" },
      { text: "AEE 211" },
      { text: "—" },
      { text: "PP 211 (B) / Agron 211 (A)" },
      { text: "—" },
    ],
  },
  {
    day: "Saturday",
    cells: [
      { text: "PE 211" },
      { text: "SS (SE) 211", span: 2 },
      { text: "—" },
      { text: "—" },
      { text: "—" },
    ],
  },
];

export const MA_SLOTS = [
  "08:00–08:45",
  "09:00–09:45",
  "10:00–10:45",
  "11:00–11:45",
  "01:00–01:45",
  "02:00–02:45",
  "03:00–03:45",
  "04:00–04:45",
];

export const MA_DAYS = [
  {
    day: "Monday",
    cells: [
      { text: "—" },
      { text: "—" },
      { text: "CD" },
      { text: "—" },
      { text: "—" },
      { text: "CN" },
      { text: "EE" },
      { text: "SE" },
    ],
  },
  {
    day: "Tuesday",
    cells: [
      { text: "—" },
      { text: "CN Lab", span: 3 },
      { text: "—" },
      { text: "CN" },
      { text: "CD" },
      { text: "SE" },
    ],
  },
  {
    day: "Wednesday",
    cells: [
      { text: "CN" },
      { text: "CD Lab", span: 3 },
      { text: "—" },
      { text: "—" },
      { text: "—" },
      { text: "SE" },
    ],
  },
  {
    day: "Thursday",
    cells: [
      { text: "—" },
      { text: "—" },
      { text: "OSNT" },
      { text: "EE" },
      { text: "—" },
      { text: "CN" },
      { text: "CD" },
      { text: "SE" },
    ],
  },
  {
    day: "Friday",
    cells: [
      { text: "—" },
      { text: "—" },
      { text: "EE" },
      { text: "OSNT" },
      { text: "—" },
      { text: "OSNT (Hands On)", span: 2 },
      { text: "—" },
    ],
  },
];

export const MESS_HEAD = [
  { name: "Breakfast", times: ["07:00–09:30", "08:00–09:30"] },
  { name: "Lunch", times: ["12:00–14:00"] },
  { name: "Snacks", times: ["16:30–18:00"] },
  { name: "Dinner", times: ["19:30–21:30"] },
];

export const MESS_DAYS = [
  {
    day: "Monday",
    cells: [
      "Idli (3); Vada (2); Chutney; Sambar; Bread; Butter; Jam; Cornflakes; Tea/Coffee; Milk with Bournvita; Boiled Egg (2)",
      "Dal Tadka; Mixed Pulses Gravy; Wheat Chapathi; Rice (White and Boiled); Sambar; Cabbage Dry; Curd; Papad; Salad; Ice Cream (Pista)",
      "Vada Pav (2); Green Chutney; Bread; Butter; Jam; Tea; Coffee",
      "Chicken Sukka; Lemon Rice; Wheat Chapathi; Rice (White and Boiled); Veg Masala; Dal Mixins; Rasam; Curd; Salad",
    ],
  },
  {
    day: "Tuesday",
    cells: [
      "Ragi Dosa; Chutney; Sambar; Bread; Butter; Jam; Tea/Coffee; Milk with Bournvita; Mix Sprouts; Ragiama",
      "Veg Pulao; Gulab Jamun; Wheat Chapathi; Rice (White and Boiled); Yellow Dal; Sambar; Bhindi Dry; Rajma Masala; Raita; Salad",
      "Veg Sevai Upma; Bread; Butter; Jam; Tea; Coffee",
      "Egg Bhurji; Sweet Lassi; Wheat Chapathi; Rice (White and Boiled); Mix Veg Curry; Dal Fry; Rasam; Salad; Curd; Sliced Fruits",
    ],
  },
  {
    day: "Wednesday",
    cells: [
      "Upma-Sheera; Chutney; Bread; Butter; Jam; Oats; Tea/Coffee; Milk with Bournvita; Banana; Sprouts",
      "Methi Poori; Ice Cream (Choc); Rice (White and Boiled); Sambar; Aloo Shimla; Kabuli Chana Masala; Dal Fry; Papad; Chaas; Salad",
      "Veg Cutlet; Sauce; Bread; Butter; Jam; Tea; Coffee",
      "Chicken Kebab / Chilli Chicken; Wheat Chapathi; Rice (White and Boiled); Tomato Rice; Aloo Matar Masala; Rasam; Curd; Salad",
    ],
  },
  {
    day: "Thursday",
    cells: [
      "Onion Uthappam (1); Set Dosa (1); Chutney; Bread; Butter; Jam; Tea/Coffee; Milk with Bournvita; Mix Sprouts; Boiled Egg (1)",
      "Veg Chawali Masala; Wheat Chapathi; Rice (White and Boiled); Mixed Veg Dry; Sambar; Curd; Pickle; Salad",
      "Pani Puri (6) / Sev Puri; Bread; Butter; Jam; Tea; Coffee",
      "Jalebi; Kabuli Chana Masala; Chapathi; Rice (White and Boiled); Gobi Dry; Dal Tadka; Rasam; Curd; Papad; Salad",
    ],
  },
  {
    day: "Friday",
    cells: [
      "Poha-Peanuts; Egg Omelet; Curd; Bread; Butter; Jam; Cornflakes; Tea/Coffee; Milk with Bournvita",
      "Poori (Unlimited); Ice Cream; Jeera Rice; Rice (White and Boiled); Sambar; Veg Kurma; Dal Tadka; Lauki Dry; Buttermilk; Pickle; Papad; Salad",
      "Masala Idli (3); Chutney; Bread; Butter; Jam; Tea; Coffee",
      "Chicken Curry; Sweet Lassi; Wheat Chapathi; Rice (White and Boiled); Tamarind Rice; Toor Dal; Mixed Pulses Dry; Rasam; Salad",
    ],
  },
  {
    day: "Saturday",
    cells: [
      "Bisibele Bath; Khara Boondi; Pickle; Bread; Butter; Jam; Ketchup; Tea/Coffee; Milk with Bournvita; Egg Bhurji",
      "Veg Kolhapuri; Chana Dal Tadka; Wheat Chapathi; Rice (White and Boiled); Seasonal Veg Dry; Sambar; Curd; Salad",
      "Sev Puri; Ketchup/Sauce; Bread; Butter; Jam; Tea; Coffee",
      "Matar Palak Masala; Jeera Rice; Wheat Chapathi; Rice (White and Boiled); Dal Fry; Longbeans Dry; Rasam; Curd; Papad; Salad",
    ],
  },
  {
    day: "Sunday",
    cells: [
      "Masala Dosa (1); Set Dosa (1); Chutney; Sambar; Bread; Butter; Jam; Oats; Tea/Coffee; Milk with Bournvita; Seasonal Fruits",
      "Sewai Kheer; Soyabean Masala; Wheat Chapathi; Rice (White and Boiled); Dal Fry; Tindli Palya; Sambar; Curd; Papad; Salad",
      "Samosa; Chutney; Bread; Butter; Jam; Tea; Coffee",
      "Chicken Biryani; Fruit Custard; Rice (White and Boiled); Dal; Rasam; Raita",
    ],
  },
];

export const GENERAL_SLOTS = [
  "08:00–09:00",
  "09:00–10:00",
  "10:00–11:00",
  "11:00–12:00",
  "01:00–02:00",
  "02:00–03:00",
  "03:00–04:00",
];

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function emptyDays(slotsCount) {
  return WEEKDAYS.map((day) => ({
    day,
    cells: Array.from({ length: slotsCount }, () => ({ text: "—", span: 1 })),
  }));
}

export function personalRoutine() {
  return {
    ba: {
      title: "Weekly Schedule",
      slots: [...BAU_SLOTS],
      days: JSON.parse(JSON.stringify(BAU_DAYS)),
      courses: JSON.parse(JSON.stringify(BAU_COURSES)),
      notes: "",
    },
    ma: {
      title: "Weekly Schedule",
      slots: [...MA_SLOTS],
      days: JSON.parse(JSON.stringify(MA_DAYS)),
      messHead: JSON.parse(JSON.stringify(MESS_HEAD)),
      messDays: JSON.parse(JSON.stringify(MESS_DAYS)),
      notes: "",
    },
  };
}

export function generalRoutine() {
  return {
    ba: {
      title: "Weekly Schedule",
      slots: [...GENERAL_SLOTS],
      days: emptyDays(GENERAL_SLOTS.length),
      notes: "",
    },
    ma: {
      title: "Weekly Schedule",
      slots: [...GENERAL_SLOTS],
      days: emptyDays(GENERAL_SLOTS.length),
      notes: "",
    },
  };
}

export function defaultRoutine(isPersonal = false) {
  return isPersonal ? personalRoutine() : generalRoutine();
}

function normalizePersonRoutine(cur, fallback) {
  if (!cur || typeof cur !== "object") return JSON.parse(JSON.stringify(fallback));
  const slots = Array.isArray(cur.slots) && cur.slots.length ? [...cur.slots] : [...fallback.slots];
  const days = Array.isArray(cur.days) && cur.days.length
    ? cur.days.map((d) => ({
        day: String(d.day || "Day"),
        cells: Array.isArray(d.cells)
          ? d.cells.map((c) => ({
              text: String(c.text ?? (c.cell || "—")),
              ...(c.span && Number(c.span) > 1 ? { span: Number(c.span) } : {}),
            }))
          : Array.from({ length: slots.length }, () => ({ text: "—", span: 1 })),
      }))
    : JSON.parse(JSON.stringify(fallback.days));

  const res = {
    title: String(cur.title || fallback.title || "Weekly Schedule"),
    slots,
    days,
    notes: String(cur.notes || ""),
  };

  if (cur.courses || fallback.courses) {
    res.courses = Array.isArray(cur.courses)
      ? JSON.parse(JSON.stringify(cur.courses))
      : (fallback.courses ? JSON.parse(JSON.stringify(fallback.courses)) : []);
  }

  if (cur.messDays || fallback.messDays) {
    res.messHead = Array.isArray(cur.messHead)
      ? JSON.parse(JSON.stringify(cur.messHead))
      : (fallback.messHead ? JSON.parse(JSON.stringify(fallback.messHead)) : []);
    res.messDays = Array.isArray(cur.messDays)
      ? JSON.parse(JSON.stringify(cur.messDays))
      : (fallback.messDays ? JSON.parse(JSON.stringify(fallback.messDays)) : []);
  }

  return res;
}

export function ensureRoutine(raw, isPersonal = false) {
  const fallback = defaultRoutine(isPersonal);
  if (!raw || typeof raw !== "object") return fallback;
  return {
    ba: normalizePersonRoutine(raw.ba, fallback.ba),
    ma: normalizePersonRoutine(raw.ma, fallback.ma),
  };
}

export function updateRoutineCell(personData, dayIdx, cellIdx, newText, newSpan = 1) {
  if (!personData?.days?.[dayIdx]?.cells?.[cellIdx]) return;
  const row = personData.days[dayIdx];
  const cell = row.cells[cellIdx];
  const curSpan = cell.span || 1;
  const span = Math.max(1, Math.min(Number(newSpan) || 1, 4));
  const text = String(newText || "").trim() || "—";

  if (span === curSpan) {
    cell.text = text;
    return;
  }

  if (span > curSpan) {
    const diff = span - curSpan;
    let available = 0;
    for (let i = cellIdx + 1; i < row.cells.length; i++) {
      available += (row.cells[i].span || 1);
    }
    const canAbsorb = Math.min(diff, available);
    if (canAbsorb > 0) {
      cell.span = curSpan + canAbsorb;
      cell.text = text;
      let needToRemove = canAbsorb;
      while (needToRemove > 0 && cellIdx + 1 < row.cells.length) {
        const nextSpan = row.cells[cellIdx + 1].span || 1;
        if (nextSpan <= needToRemove) {
          row.cells.splice(cellIdx + 1, 1);
          needToRemove -= nextSpan;
        } else {
          row.cells[cellIdx + 1].span = nextSpan - needToRemove;
          needToRemove = 0;
        }
      }
    } else {
      cell.text = text;
    }
  } else {
    const diff = curSpan - span;
    cell.span = span;
    cell.text = text;
    for (let i = 0; i < diff; i++) {
      row.cells.splice(cellIdx + 1 + i, 0, { text: "—", span: 1 });
    }
  }
}

export function clearRoutineCell(personData, dayIdx, cellIdx) {
  if (!personData?.days?.[dayIdx]?.cells?.[cellIdx]) return;
  personData.days[dayIdx].cells[cellIdx].text = "—";
}

export function updateRoutineSlots(personData, newSlots) {
  if (!personData || !Array.isArray(newSlots) || !newSlots.length) return;
  personData.slots = newSlots.map((s) => String(s || "").trim()).filter(Boolean);
  const targetLen = personData.slots.length;
  if (!Array.isArray(personData.days)) return;

  for (const row of personData.days) {
    if (!Array.isArray(row.cells)) row.cells = [];
    let totalSpan = row.cells.reduce((sum, c) => sum + (c.span || 1), 0);
    if (totalSpan < targetLen) {
      const needed = targetLen - totalSpan;
      for (let i = 0; i < needed; i++) {
        row.cells.push({ text: "—", span: 1 });
      }
    } else if (totalSpan > targetLen) {
      while (totalSpan > targetLen && row.cells.length > 0) {
        const last = row.cells[row.cells.length - 1];
        const lastSpan = last.span || 1;
        if (totalSpan - lastSpan >= targetLen) {
          row.cells.pop();
          totalSpan -= lastSpan;
        } else {
          last.span = targetLen - (totalSpan - lastSpan);
          totalSpan = targetLen;
        }
      }
    }
  }
}

export function updateRoutineNotes(personData, notes) {
  if (personData) {
    personData.notes = String(notes || "");
  }
}

export function updateMessCell(personData, dayIdx, cellIdx, text) {
  if (personData?.messDays?.[dayIdx]?.cells && cellIdx in personData.messDays[dayIdx].cells) {
    personData.messDays[dayIdx].cells[cellIdx] = String(text || "").trim();
  }
}

export function addCourse(personData, course) {
  if (!personData) return;
  if (!Array.isArray(personData.courses)) personData.courses = [];
  personData.courses.push(course);
}

export function getRoutineSubjects(personData) {
  const set = new Set();
  if (Array.isArray(personData?.courses)) {
    for (const c of personData.courses) {
      if (c[1]) set.add(c[1]);
      if (c[2]) set.add(c[2]);
    }
  }
  if (Array.isArray(personData?.days)) {
    for (const d of personData.days) {
      if (Array.isArray(d?.cells)) {
        for (const cell of d.cells) {
          const t = String(cell.text || "").trim();
          if (t && t !== "—") set.add(t);
        }
      }
    }
  }
  return Array.from(set);
}

export function updateRoutineDays(personData, activeDayNames) {
  if (!personData || !Array.isArray(activeDayNames) || !activeDayNames.length) return;
  const currentMap = new Map();
  if (Array.isArray(personData.days)) {
    for (const d of personData.days) {
      if (d && d.day) currentMap.set(d.day, d.cells);
    }
  }
  const slotsCount = Array.isArray(personData.slots) ? personData.slots.length : GENERAL_SLOTS.length;
  const activeSet = new Set(activeDayNames);
  const newDays = [];
  for (const day of WEEKDAYS) {
    if (activeSet.has(day)) {
      if (currentMap.has(day)) {
        newDays.push({ day, cells: currentMap.get(day) });
      } else {
        newDays.push({
          day,
          cells: Array.from({ length: slotsCount }, () => ({ text: "—", span: 1 })),
        });
      }
    }
  }
  if (newDays.length) {
    personData.days = newDays;
  }
}

export function removeCourse(personData, index) {
  if (!personData || !Array.isArray(personData.courses)) return;
  personData.courses.splice(index, 1);
}

export function weekdayName() {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date().getDay()];
}

function slotHead(escapeHtml, slot) {
  const [start, end] = String(slot).split("–");
  if (!end) return escapeHtml(slot);
  return `<span>${escapeHtml(start)}</span><span>${escapeHtml(end)}</span>`;
}

function gridHtml(escapeHtml, slots, days, who) {
  const today = weekdayName();
  const head = slots.map((slot) => `<th>${slotHead(escapeHtml, slot)}</th>`).join("");
  const body = days
    .map((row, dayIdx) => {
      const cells = row.cells
        .map((cell, cellIdx) => {
          const span = cell.span || 1;
          const free = !cell.text || cell.text === "—";
          const label = String(cell.text || "")
            .split("/")
            .map((part) => escapeHtml(part.trim()))
            .filter(Boolean)
            .join("<br>");
          return `<td colspan="${span}" class="tt-cell-interactive ${free ? "tt-free" : "tt-busy"}" data-routine-cell="true" data-who="${who}" data-day-idx="${dayIdx}" data-cell-idx="${cellIdx}">${free ? "—" : label}</td>`;
        })
        .join("");
      return `<tr class="${row.day === today ? "tt-today" : ""}"><th>${escapeHtml(row.day)}</th>${cells}</tr>`;
    })
    .join("");
  return `<div class="tt-scroll"><table class="tt"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function messItem(escapeHtml, value) {
  return String(value || "")
    .split(" / ")
    .map((part) => escapeHtml(part.trim()))
    .filter(Boolean)
    .join("<br>");
}

function messCell(escapeHtml, text) {
  const items = String(text || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!items.length) return "";
  const rest = items.slice(1).map((item) => messItem(escapeHtml, item)).join("; ");
  return `<strong>${messItem(escapeHtml, items[0])}</strong>${rest ? `<br>${rest}` : ""}`;
}

function messHtml(escapeHtml, messHead, messDays, who) {
  const today = weekdayName();
  const head = messHead.map(
    (col) => `<th>${escapeHtml(col.name)}${Array.isArray(col.times) ? col.times.map((time) => `<span>${escapeHtml(time)}</span>`).join("") : ""}</th>`
  ).join("");
  const body = messDays.map((row, dayIdx) => {
    const cells = row.cells.map((text, cellIdx) => {
      const content = messCell(escapeHtml, text);
      return `<td class="tt-cell-interactive tt-busy" data-mess-cell="true" data-who="${who}" data-day-idx="${dayIdx}" data-cell-idx="${cellIdx}">${content || "—"}</td>`;
    }).join("");
    return `<tr class="${row.day === today ? "tt-today" : ""}"><th>${escapeHtml(row.day)}</th>${cells}</tr>`;
  }).join("");
  return `<div class="tt-scroll"><table class="tt tt-mess"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function routineHtml(escapeHtml, who, routineState, displayName = "") {
  const person = routineState?.[who] || (who === "ma" ? generalRoutine().ma : generalRoutine().ba);
  const title = displayName ? `${displayName}’s Schedule` : (person.title || "Weekly Schedule");
  const slots = Array.isArray(person.slots) ? person.slots : GENERAL_SLOTS;
  const days = Array.isArray(person.days) ? person.days : emptyDays(slots.length);
  const notes = String(person.notes || "");

  let coursesSection = "";
  const coursesList = Array.isArray(person.courses) ? person.courses : [];
  if (coursesList.length > 0) {
    const rows = coursesList.map(
      (row, idx) => `
        <tr data-course-idx="${idx}">
          <td>${escapeHtml(row[0] || String(idx + 1))}</td>
          <td>${escapeHtml(row[1] || "")}</td>
          <td>${escapeHtml(row[2] || "")}</td>
          <td>${escapeHtml(row[3] || "")}</td>
          <td><strong>${escapeHtml(row[4] || "")}</strong>${row[5] ? `<br>${escapeHtml(row[5])}` : ""}</td>
          <td style="text-align:right; width:44px;"><button type="button" class="routine-icon-btn is-danger" data-remove-course="${idx}" aria-label="Delete course" title="Delete course">×</button></td>
        </tr>`
    ).join("");

    coursesSection = `
      <article class="card routine-card">
        <div class="routine-card-bar">
          <h3>Subjects & Courses</h3>
          <button type="button" class="routine-action-btn" data-act="add-course">+ Add Subject</button>
        </div>
        <div class="tt-scroll">
          <table class="tt tt-courses">
            <thead>
              <tr>
                <th>S.No</th>
                <th>Title</th>
                <th>Course / Subj</th>
                <th>Credits</th>
                <th>Instructors</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </article>
    `;
  } else {
    coursesSection = `
      <article class="card routine-card">
        <div class="routine-card-bar">
          <h3>Subjects & Courses</h3>
          <button type="button" class="routine-action-btn" data-act="add-course">+ Add Subject</button>
        </div>
        <p class="routine-hint" style="margin-top:6px;">No subjects added yet. Tap <strong>+ Add Subject</strong> to list your subjects/courses and quickly pick them in your weekly schedule.</p>
      </article>
    `;
  }

  let messSection = "";
  if (Array.isArray(person.messDays) && person.messDays.length > 0 && Array.isArray(person.messHead)) {
    messSection = `
      <article class="card routine-card">
        <div class="routine-card-bar">
          <h3>Mess & Meals</h3>
          <span class="routine-subtle-hint">Tap any meal to edit menu</span>
        </div>
        ${messHtml(escapeHtml, person.messHead, person.messDays, who)}
      </article>
    `;
  }

  return `
    <article class="card routine-card">
      <div class="routine-card-bar">
        <h3>${escapeHtml(title)}</h3>
        <div style="display:flex; gap:8px;">
          <button type="button" class="routine-action-btn" data-act="edit-days">Edit Days</button>
          <button type="button" class="routine-action-btn" data-act="edit-slots">Edit Slots</button>
        </div>
      </div>
      <p class="routine-hint">Tap any cell to add or change class/subject, or slot span.</p>
      ${gridHtml(escapeHtml, slots, days, who)}
    </article>

    <article class="card routine-card routine-notes-card">
      <div class="routine-card-bar">
        <h3>Weekly Notes</h3>
        <button type="button" class="routine-action-btn" data-act="save-notes">Save Notes</button>
      </div>
      <textarea class="routine-notes-area" data-routine-notes placeholder="Reminders, study goals, exam dates, or weekly notes...">${escapeHtml(notes)}</textarea>
    </article>

    ${coursesSection}
    ${messSection}
  `;
}
