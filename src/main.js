const STORAGE_KEY = "ba-ours-v1";

const QUESTIONS = [
  "What made you smile about us this week?",
  "If we had a free Saturday, where would you take me?",
  "What is a tiny habit of mine you secretly love?",
  "Which song should be ours right now?",
  "What is something you want us to try once?",
  "When did you feel closest to me lately?",
  "What should our next comfort dinner be?",
  "If we wrote a postcard from today, what would it say?",
  "What is a dream you want me to take more seriously?",
  "How do you want to be cared for when you are tired?",
  "What memory should we replay out loud tonight?",
  "If we had one hour with no phones, what would we do?",
];

const MOODS = ["soft", "giddy", "tired", "brave", "tender", "spicy", "home"];

const defaultState = () => ({
  you: "",
  them: "",
  startedOn: "",
  nextDate: "",
  notes: [],
  dates: [],
  moods: [],
  memories: [],
  answers: [],
  pokes: [],
});

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultState(), ...JSON.parse(raw) } : defaultState();
  } catch {
    return defaultState();
  }
}

function save(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return crypto.randomUUID();
}

function fmt(date) {
  if (!date) return "";
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysTogether(startedOn) {
  if (!startedOn) return 0;
  const start = new Date(`${startedOn}T12:00:00`);
  const now = new Date();
  return Math.max(0, Math.floor((now - start) / 86400000));
}

const MONTHS = [
  ["01", "January"],
  ["02", "February"],
  ["03", "March"],
  ["04", "April"],
  ["05", "May"],
  ["06", "June"],
  ["07", "July"],
  ["08", "August"],
  ["09", "September"],
  ["10", "October"],
  ["11", "November"],
  ["12", "December"],
];

function datePickerHtml(name, iso = "", { required = false, future = false } = {}) {
  const now = new Date().getFullYear();
  const minYear = 1980;
  const maxYear = future ? now + 8 : now;
  const [year = "", month = "", day = ""] = iso ? iso.split("-") : [];
  const years = [];
  for (let y = maxYear; y >= minYear; y -= 1) years.push(y);
  return `
    <div class="date-picker" data-date-name="${name}">
      <select data-part="y" aria-label="Year"${required ? " required" : ""}>
        <option value="">Year</option>
        ${years.map((y) => `<option value="${y}" ${String(y) === year ? "selected" : ""}>${y}</option>`).join("")}
      </select>
      <select data-part="m" aria-label="Month"${required ? " required" : ""}>
        <option value="">Month</option>
        ${MONTHS.map(([value, label]) => `<option value="${value}" ${value === month ? "selected" : ""}>${label}</option>`).join("")}
      </select>
      <select data-part="d" aria-label="Day"${required ? " required" : ""}>
        <option value="">Day</option>
        ${Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"))
          .map((d) => `<option value="${d}" ${d === day ? "selected" : ""}>${Number(d)}</option>`)
          .join("")}
      </select>
    </div>
  `;
}

function readDatePicker(root, name) {
  const box = root.querySelector(`[data-date-name="${name}"]`);
  const y = box.querySelector('[data-part="y"]').value;
  const m = box.querySelector('[data-part="m"]').value;
  const d = box.querySelector('[data-part="d"]').value;
  if (!y || !m || !d) return "";
  const stamp = new Date(`${y}-${m}-${d}T12:00:00`);
  if (Number.isNaN(stamp.getTime())) return "";
  return `${y}-${m}-${String(stamp.getDate()).padStart(2, "0")}`;
}

function todayQuestion() {
  const day = Math.floor(Date.now() / 86400000);
  return QUESTIONS[day % QUESTIONS.length];
}

function el(html) {
  const wrap = document.createElement("div");
  wrap.innerHTML = html.trim();
  return wrap.firstElementChild;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

let state = load();
let tab = "home";
const root = document.getElementById("app");

function setState(patch) {
  state = { ...state, ...patch };
  save(state);
  render();
}

function setupView() {
  const card = el(`
    <div class="setup">
      <form class="setup-card">
        <p class="kicker">just for two</p>
        <h1>Ba</h1>
        <p class="lede">A private little room for you and your girlfriend — days together, letters, date ideas, and the question of the day. Everything stays on this device.</p>
        <div class="field">
          <label for="you">Your name</label>
          <input id="you" name="you" required placeholder="You" />
        </div>
        <div class="field">
          <label for="them">Her name</label>
          <input id="them" name="them" required placeholder="Her" />
        </div>
        <div class="field">
          <label>When did this start?</label>
          ${datePickerHtml("startedOn", "", { required: true })}
        </div>
        <button class="btn rose" type="submit">Make it ours</button>
      </form>
    </div>
  `);
  card.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const startedOn = readDatePicker(event.target, "startedOn");
    if (!startedOn) return;
    setState({
      you: String(data.get("you")).trim(),
      them: String(data.get("them")).trim(),
      startedOn,
    });
  });
  return card;
}

function nav() {
  const items = [
    ["home", "Home"],
    ["letters", "Letters"],
    ["dates", "Dates"],
    ["ask", "Ask"],
    ["memories", "Memories"],
    ["settings", "Settings"],
  ];
  const bar = el(`<nav class="nav">${items.map(([id, label]) => `<button data-tab="${id}">${label}</button>`).join("")}</nav>`);
  bar.querySelectorAll("button").forEach((button) => {
    if (button.dataset.tab === tab) button.classList.add("active");
    button.addEventListener("click", () => {
      tab = button.dataset.tab;
      render();
    });
  });
  return bar;
}

function homeView() {
  const days = daysTogether(state.startedOn);
  const lastPoke = state.pokes[0];
  const latestMood = state.moods[0];
  const wrap = el(`
    <div>
      <section class="hero-card">
        <div>
          <p class="kicker">${escapeHtml(state.you)} + ${escapeHtml(state.them)}</p>
          <p class="days">${days}<span>days in this story</span></p>
        </div>
        <div class="poke">
          <div>
            <strong>Thinking of you</strong>
            <p class="muted tiny">${lastPoke ? `Last poke: ${new Date(lastPoke.at).toLocaleString()} from ${escapeHtml(lastPoke.from)}` : "Send a little pulse across the day."}</p>
          </div>
          <button class="btn rose" data-poke>Poke</button>
        </div>
      </section>
      <div class="grid">
        <article class="card">
          <h3>How is the air today?</h3>
          <p class="muted">Leave a mood for the other person to find later.</p>
          <div class="moods"></div>
        </article>
        <article class="card">
          <h3>Next date</h3>
          <p class="muted">${state.nextDate ? fmt(state.nextDate) : "Set a night that is already yours."}</p>
          <div class="field">
            <label>When</label>
            ${datePickerHtml("nextDate", state.nextDate || "", { future: true })}
          </div>
        </article>
        <article class="card">
          <h3>Today’s question</h3>
          <p class="question">${todayQuestion()}</p>
          <p class="muted tiny">Answer it in Ask. Keep a trail of how you two talk.</p>
        </article>
      </div>
      ${latestMood ? `<article class="card" style="margin-top:16px"><h3>Latest mood</h3><p>${escapeHtml(latestMood.who)} feels ${escapeHtml(latestMood.mood)}</p><p class="muted tiny">${new Date(latestMood.at).toLocaleString()}</p></article>` : ""}
    </div>
  `);
  const moods = wrap.querySelector(".moods");
  MOODS.forEach((mood) => {
    const chip = el(`<button class="mood" type="button">${mood}</button>`);
    chip.addEventListener("click", () => {
      setState({
        moods: [{ id: uid(), who: state.you, mood, at: Date.now() }, ...state.moods].slice(0, 40),
      });
    });
    moods.append(chip);
  });
  wrap.querySelector("[data-poke]").addEventListener("click", () => {
    setState({
      pokes: [{ id: uid(), from: state.you, at: Date.now() }, ...state.pokes].slice(0, 20),
    });
  });
  wrap.querySelector('[data-date-name="nextDate"]').addEventListener("change", () => {
    setState({ nextDate: readDatePicker(wrap, "nextDate") });
  });
  return wrap;
}

function lettersView() {
  const wrap = el(`
    <div>
      <article class="card" style="margin-bottom:16px">
        <h3>Leave a letter</h3>
        <form>
          <div class="field">
            <label for="from">From</label>
            <select id="from">
              <option>${escapeHtml(state.you)}</option>
              <option>${escapeHtml(state.them)}</option>
            </select>
          </div>
          <div class="field">
            <label for="letter">Note</label>
            <textarea id="letter" required placeholder="Something true, even if it is small."></textarea>
          </div>
          <button class="btn" type="submit">Tuck it in</button>
        </form>
      </article>
      <div class="list"></div>
    </div>
  `);
  const list = wrap.querySelector(".list");
  if (!state.notes.length) {
    list.append(el(`<div class="empty card">No letters yet. Write the first one.</div>`));
  } else {
    state.notes.forEach((note) => {
      list.append(
        el(`
          <article class="note">
            <div class="meta"><span>from ${escapeHtml(note.from)}</span><span>${new Date(note.at).toLocaleString()}</span></div>
            <div>${escapeHtml(note.text)}</div>
          </article>
        `)
      );
    });
  }
  wrap.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const from = wrap.querySelector("#from").value;
    const text = wrap.querySelector("#letter").value.trim();
    if (!text) return;
    setState({ notes: [{ id: uid(), from, text, at: Date.now() }, ...state.notes] });
  });
  return wrap;
}

function datesView() {
  const wrap = el(`
    <div>
      <article class="card" style="margin-bottom:16px">
        <h3>Date ideas</h3>
        <form>
          <div class="field">
            <label for="idea">What should we do?</label>
            <input id="idea" required placeholder="Night market, long walk, terrible karaoke..." />
          </div>
          <button class="btn" type="submit">Add to the list</button>
        </form>
      </article>
      <div class="list"></div>
    </div>
  `);
  const list = wrap.querySelector(".list");
  if (!state.dates.length) {
    list.append(el(`<div class="empty card">Your shared list is empty. Put a wish on it.</div>`));
  } else {
    state.dates.forEach((item) => {
      const row = el(`
        <article class="item">
          <div class="meta">
            <span>${item.done ? "done" : "someday"}</span>
            <span></span>
          </div>
          <div class="${item.done ? "done" : ""}">${escapeHtml(item.title)}</div>
          <div class="btn-row" style="margin-top:12px">
            <button class="btn ghost" data-toggle>Mark ${item.done ? "undone" : "done"}</button>
            <button class="btn ghost" data-remove>Remove</button>
          </div>
        </article>
      `);
      row.querySelector("[data-toggle]").addEventListener("click", () => {
        setState({
          dates: state.dates.map((d) => (d.id === item.id ? { ...d, done: !d.done } : d)),
        });
      });
      row.querySelector("[data-remove]").addEventListener("click", () => {
        setState({ dates: state.dates.filter((d) => d.id !== item.id) });
      });
      list.append(row);
    });
  }
  wrap.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = wrap.querySelector("#idea").value.trim();
    if (!title) return;
    setState({ dates: [{ id: uid(), title, done: false, at: Date.now() }, ...state.dates] });
  });
  return wrap;
}

function askView() {
  const q = todayQuestion();
  const wrap = el(`
    <div>
      <article class="card" style="margin-bottom:16px">
        <p class="kicker">today</p>
        <p class="question">${q}</p>
        <form>
          <div class="field">
            <label for="who">Who is answering</label>
            <select id="who">
              <option>${escapeHtml(state.you)}</option>
              <option>${escapeHtml(state.them)}</option>
            </select>
          </div>
          <div class="field">
            <label for="answer">Your answer</label>
            <textarea id="answer" required></textarea>
          </div>
          <button class="btn rose" type="submit">Keep this</button>
        </form>
      </article>
      <div class="list"></div>
    </div>
  `);
  const list = wrap.querySelector(".list");
  if (!state.answers.length) {
    list.append(el(`<div class="empty card">Answers will stack into a tiny archive of you two.</div>`));
  } else {
    state.answers.forEach((item) => {
      list.append(
        el(`
          <article class="note">
            <div class="meta"><span>${escapeHtml(item.who)}</span><span>${new Date(item.at).toLocaleString()}</span></div>
            <p class="muted">${escapeHtml(item.question)}</p>
            <div>${escapeHtml(item.text)}</div>
          </article>
        `)
      );
    });
  }
  wrap.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const who = wrap.querySelector("#who").value;
    const text = wrap.querySelector("#answer").value.trim();
    if (!text) return;
    setState({
      answers: [{ id: uid(), who, question: q, text, at: Date.now() }, ...state.answers],
    });
  });
  return wrap;
}

function memoriesView() {
  const wrap = el(`
    <div>
      <article class="card" style="margin-bottom:16px">
        <h3>Pin a memory</h3>
        <form>
          <div class="field">
            <label>When</label>
            ${datePickerHtml("mdate", "", { required: true })}
          </div>
          <div class="field">
            <label for="mtitle">Title</label>
            <input id="mtitle" required placeholder="The night the rain would not stop" />
          </div>
          <div class="field">
            <label for="mtext">What we keep</label>
            <textarea id="mtext" required></textarea>
          </div>
          <button class="btn" type="submit">Save it</button>
        </form>
      </article>
      <div class="list"></div>
    </div>
  `);
  const list = wrap.querySelector(".list");
  const memories = [...state.memories].sort((a, b) => b.date.localeCompare(a.date));
  if (!memories.length) {
    list.append(el(`<div class="empty card">The scrapbook is waiting.</div>`));
  } else {
    memories.forEach((item) => {
      list.append(
        el(`
          <article class="note">
            <div class="meta"><span>${escapeHtml(item.title)}</span><span>${fmt(item.date)}</span></div>
            <div>${escapeHtml(item.text)}</div>
          </article>
        `)
      );
    });
  }
  wrap.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    setState({
      memories: [
        {
          id: uid(),
          date: readDatePicker(wrap, "mdate"),
          title: wrap.querySelector("#mtitle").value.trim(),
          text: wrap.querySelector("#mtext").value.trim(),
        },
        ...state.memories,
      ],
    });
  });
  return wrap;
}

function settingsView() {
  const wrap = el(`
    <article class="card">
      <h3>This space</h3>
      <form>
        <div class="field">
          <label for="you">Your name</label>
          <input id="you" value="${escapeHtml(state.you)}" required />
        </div>
        <div class="field">
          <label for="them">Her name</label>
          <input id="them" value="${escapeHtml(state.them)}" required />
        </div>
        <div class="field">
          <label>Start date</label>
          ${datePickerHtml("startedOn", state.startedOn, { required: true })}
        </div>
        <div class="btn-row">
          <button class="btn" type="submit">Save</button>
          <button class="btn ghost" type="button" data-export>Export backup</button>
          <button class="btn ghost" type="button" data-import>Import backup</button>
        </div>
        <input type="file" accept="application/json" hidden data-file />
        <p class="muted tiny" style="margin-top:16px">Data lives in this browser. Export a backup if you want to move it to her phone, or keep a copy somewhere safe.</p>
      </form>
    </article>
  `);
  wrap.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const startedOn = readDatePicker(wrap, "startedOn");
    if (!startedOn) return;
    setState({
      you: wrap.querySelector("#you").value.trim(),
      them: wrap.querySelector("#them").value.trim(),
      startedOn,
    });
  });
  wrap.querySelector("[data-export]").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ba-ours.json";
    a.click();
    URL.revokeObjectURL(url);
  });
  const file = wrap.querySelector("[data-file]");
  wrap.querySelector("[data-import]").addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const picked = file.files?.[0];
    if (!picked) return;
    const parsed = JSON.parse(await picked.text());
    setState({ ...defaultState(), ...parsed });
  });
  return wrap;
}

function appView() {
  const shell = el(`
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="kicker">private</p>
          <h1 class="wordmark">Ba</h1>
          <p class="who">${escapeHtml(state.you)} & ${escapeHtml(state.them)}</p>
        </div>
      </header>
    </div>
  `);
  shell.append(nav());
  const views = {
    home: homeView,
    letters: lettersView,
    dates: datesView,
    ask: askView,
    memories: memoriesView,
    settings: settingsView,
  };
  shell.append((views[tab] || homeView)());
  return shell;
}

function render() {
  root.replaceChildren(state.you && state.them && state.startedOn ? appView() : setupView());
}

render();
