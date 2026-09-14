const BAU_SLOTS = ["07:30–09:30", "11:15–12:15", "12:15–01:15", "02:00–03:00", "03:00–04:00", "04:00–05:00"];

const BAU_COURSES = [
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

const BAU_DAYS = [
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

const MA_SLOTS = [
  "08:00–08:45",
  "09:00–09:45",
  "10:00–10:45",
  "11:00–11:45",
  "01:00–01:45",
  "02:00–02:45",
  "03:00–03:45",
  "04:00–04:45",
];

const MA_DAYS = [
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

function weekdayName() {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date().getDay()];
}

function slotHead(escapeHtml, slot) {
  const [start, end] = String(slot).split("–");
  if (!end) return escapeHtml(slot);
  return `<span>${escapeHtml(start)}</span><span>${escapeHtml(end)}</span>`;
}

function gridHtml(escapeHtml, slots, days) {
  const today = weekdayName();
  const head = slots.map((slot) => `<th>${slotHead(escapeHtml, slot)}</th>`).join("");
  const body = days
    .map((row) => {
      const cells = row.cells
        .map((cell) => {
          const span = cell.span || 1;
          const free = !cell.text || cell.text === "—";
          const label = String(cell.text || "")
            .split("/")
            .map((part) => escapeHtml(part.trim()))
            .filter(Boolean)
            .join("<br>");
          return `<td colspan="${span}" class="${free ? "tt-free" : "tt-busy"}">${free ? "" : label}</td>`;
        })
        .join("");
      return `<tr class="${row.day === today ? "tt-today" : ""}"><th>${escapeHtml(row.day)}</th>${cells}</tr>`;
    })
    .join("");
  return `<div class="tt-scroll"><table class="tt"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const MESS_HEAD = [
  { name: "Breakfast", times: ["07:00–09:30", "08:00–09:30"] },
  { name: "Lunch", times: ["12:00–14:00"] },
  { name: "Snacks", times: ["16:30–18:00"] },
  { name: "Dinner", times: ["19:30–21:30"] },
];

const MESS_DAYS = [
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

function messHtml(escapeHtml) {
  const today = weekdayName();
  const head = MESS_HEAD.map(
    (col) => `<th>${escapeHtml(col.name)}${col.times.map((time) => `<span>${escapeHtml(time)}</span>`).join("")}</th>`
  ).join("");
  const body = MESS_DAYS.map((row) => {
    const cells = row.cells.map((text) => `<td class="tt-busy">${messCell(escapeHtml, text)}</td>`).join("");
    return `<tr class="${row.day === today ? "tt-today" : ""}"><th>${escapeHtml(row.day)}</th>${cells}</tr>`;
  }).join("");
  return `<div class="tt-scroll"><table class="tt tt-mess"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function routineHtml(escapeHtml, who) {
  if (who === "ma") {
    return `
      <article class="card routine-card">
        <h3>Classes</h3>
        ${gridHtml(escapeHtml, MA_SLOTS, MA_DAYS)}
      </article>
      <article class="card routine-card">
        <h3>Mess</h3>
        ${messHtml(escapeHtml)}
      </article>
    `;
  }
  const courses = BAU_COURSES.map(
    (row) => `
      <tr>
        <td>${escapeHtml(row[0])}</td>
        <td>${escapeHtml(row[1])}</td>
        <td>${escapeHtml(row[2])}</td>
        <td>${escapeHtml(row[3])}</td>
        <td><strong>${escapeHtml(row[4])}</strong>${row[5] ? `<br>${escapeHtml(row[5])}` : ""}</td>
      </tr>`
  ).join("");
  return `
    <article class="card routine-card">
      <h3>Classes</h3>
      ${gridHtml(escapeHtml, BAU_SLOTS, BAU_DAYS)}
    </article>
    <article class="card routine-card">
      <h3>Courses</h3>
      <div class="tt-scroll">
        <table class="tt tt-courses">
          <thead>
            <tr>
              <th>S.No</th>
              <th>Title</th>
              <th>Course No.</th>
              <th>Credits</th>
              <th>Instructors</th>
            </tr>
          </thead>
          <tbody>${courses}</tbody>
        </table>
      </div>
    </article>
  `;
}
