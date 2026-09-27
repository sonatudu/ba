function p(name, sex, extra = {}) {
  return { kind: "person", name, sex, locked: false, ...extra };
}

function c(a, b, kids = []) {
  return { kind: "couple", a, b, kids };
}

// Personal seed tree for room BA-OURS
const mandi = c(
  p("Gurucharan Mandi", "M", { locked: true }),
  p("Rani Mandi", "F", { locked: true }),
  [
    c(p("Shyampada Mandi", "M", { locked: true }), p("Saraswati Mandi", "F", { locked: true }), [
      p("Gurucharan Mandi", "M", { locked: true }),
      p("Seema Mandi", "F", { nick: "T2", locked: true }),
      p("Sonamuni Tudu", "F", { nick: "Khu", born: "01/30/2005", link: true, locked: true }),
    ]),
  ]
);

const tudu = c(
  p("Baya Tudu", "M", { locked: true }),
  p("Salma Tudu", "F", { locked: true }),
  [
    c(p("Piru Ram Tudu", "M", { locked: true }), p("Galo Tudu", "F", { born: "01/01/1974", locked: true }), [
      p("Sona Tudu", "M", { nick: "Bhutku", born: "03/15/2004", link: true, locked: true }),
      c(p("Salma Murmu", "F", { nick: "Sabita", locked: true }), p("Kanto Murmu", "M", { locked: true }), [
        p("Anju Murmu", "F", { nick: "Bitimai", born: "01/14/2016", locked: true }),
        p("Anshu Murmu", "F", { nick: "Chhoti", born: "04/07/2019", locked: true }),
      ]),
      c(p("Maino Hansda", "F", { nick: "Saboti", locked: true }), p("Daso Hansda", "M", { locked: true }), [
        p("Semoti Hansda", "F", { nick: "Seema", locked: true }),
        p("Asman Hansda", "M", { nick: "Salkhan", locked: true }),
      ]),
      c(p("Masang Tudu", "M", { nick: "Baya", born: "03/13/1999", locked: true }), p("Duli Tudu", "F", { locked: true }), [
        p("Anushka Tudu", "F", { born: "12/17/2022", locked: true }),
        p("Avinash Tudu", "M", { born: "12/12/2025", locked: true }),
      ]),
      c(p("Sonamuni Mandi", "F", { nick: "Chhita", born: "03/15/2000", locked: true }), p("Ramray Mandi", "M", { locked: true }), [
        p("Riya Mandi", "F", { born: "07/26/2019", locked: true }),
      ]),
    ]),
  ]
);

const union = c(
  p("Sonamuni Tudu", "F", { nick: "Khu", born: "01/30/2005", link: true, locked: true }),
  p("Sona Tudu", "M", { nick: "Bhutku", born: "03/15/2004", link: true, locked: true }),
  [p("Olly Tudu", "F", { link: true, locked: true })]
);

function seedKey(person) {
  return `${String(person?.name || "").trim().toLowerCase()}|${person?.sex || ""}|${String(person?.nick || "").trim().toLowerCase()}`;
}

function collectPeople(node, out = []) {
  if (!node) return out;
  if (node.kind === "person") {
    out.push(node);
    return out;
  }
  collectPeople(node.a, out);
  collectPeople(node.b, out);
  (node.kids || []).forEach((kid) => collectPeople(kid, out));
  return out;
}

const SEED_KEYS = new Set(
  [mandi, tudu, union].flatMap((root) => collectPeople(root).map(seedKey))
);

function withIds(node) {
  if (!node) return null;
  if (node.kind === "person") {
    return { ...node, id: node.id || crypto.randomUUID(), locked: Boolean(node.locked) };
  }
  if (node.kind === "group") return { kind: "group", kids: (node.kids || []).map(withIds) };
  return {
    kind: "couple",
    a: withIds(node.a),
    b: withIds(node.b),
    kids: (node.kids || []).map(withIds),
  };
}

function lockSeedPeople(node, isPersonal = false) {
  if (!node) return null;
  if (node.kind === "person") {
    const flagged = node.locked === true || node.locked === false;
    const locked = isPersonal ? (flagged ? Boolean(node.locked) : SEED_KEYS.has(seedKey(node))) : Boolean(node.locked);
    return { ...node, id: node.id || crypto.randomUUID(), locked };
  }
  if (node.kind === "group") return { kind: "group", kids: (node.kids || []).map((k) => lockSeedPeople(k, isPersonal)) };
  return {
    kind: "couple",
    a: lockSeedPeople(node.a, isPersonal),
    b: lockSeedPeople(node.b, isPersonal),
    kids: (node.kids || []).map((k) => lockSeedPeople(k, isPersonal)),
  };
}

export function missingLockFlags(node) {
  if (!node) return false;
  if (node.kind === "person") return node.locked !== true && node.locked !== false;
  return missingLockFlags(node.a) || missingLockFlags(node.b) || (node.kids || []).some(missingLockFlags);
}

export function personalFamilyTree() {
  return {
    mandi: withIds(mandi),
    tudu: withIds(tudu),
    union: withIds(union),
  };
}

export function generalFamilyTree(nameA = "Partner 1", nameB = "Partner 2") {
  const sideA = c(
    p("Grandfather", "M", { nick: "", born: "" }),
    p("Grandmother", "F", { nick: "", born: "" }),
    [
      c(
        p("Father", "M", { nick: "", born: "" }),
        p("Mother", "F", { nick: "", born: "" }),
        [
          p(nameA || "Partner 1", "F", { link: true, nick: "", born: "" }),
        ]
      ),
    ]
  );

  const sideB = c(
    p("Grandfather", "M", { nick: "", born: "" }),
    p("Grandmother", "F", { nick: "", born: "" }),
    [
      c(
        p("Father", "M", { nick: "", born: "" }),
        p("Mother", "F", { nick: "", born: "" }),
        [
          p(nameB || "Partner 2", "M", { link: true, nick: "", born: "" }),
        ]
      ),
    ]
  );

  const unionTree = c(
    p(nameA || "Partner 1", "F", { link: true, nick: "", born: "" }),
    p(nameB || "Partner 2", "M", { link: true, nick: "", born: "" }),
    [p("Child", "F", { link: true, nick: "", born: "" })]
  );

  return {
    mandi: withIds(sideA),
    tudu: withIds(sideB),
    union: withIds(unionTree),
  };
}

export function defaultFamilyTree(isPersonal = false, nameA = "Partner 1", nameB = "Partner 2") {
  if (isPersonal) return personalFamilyTree();
  return generalFamilyTree(nameA, nameB);
}

export function ensureFamilyTree(tree, isPersonal = false, nameA = "Partner 1", nameB = "Partner 2") {
  if (!tree?.mandi && !tree?.tudu && !tree?.union) return defaultFamilyTree(isPersonal, nameA, nameB);
  return {
    mandi: lockSeedPeople(tree.mandi, isPersonal),
    tudu: lockSeedPeople(tree.tudu, isPersonal),
    union: lockSeedPeople(tree.union, isPersonal),
  };
}

export function addSibling(tree, side, personData = {}) {
  const next = JSON.parse(JSON.stringify(tree));
  const branch = side === "mandi" ? next.mandi : next.tudu;
  if (!branch) return next;
  const parentCouple = branch.kids?.[0];
  if (!parentCouple) return next;
  if (!Array.isArray(parentCouple.kids)) parentCouple.kids = [];
  const newPerson = {
    kind: "person",
    id: crypto.randomUUID(),
    name: personData.name || "Sibling",
    sex: personData.sex || (side === "mandi" ? "M" : "F"),
    nick: personData.nick || "",
    born: personData.born || "",
    locked: false,
    ...personData,
  };
  if (side === "mandi") {
    parentCouple.kids.unshift(newPerson);
  } else {
    parentCouple.kids.push(newPerson);
  }
  return next;
}

export function addChild(tree, personData = {}) {
  const next = JSON.parse(JSON.stringify(tree));
  if (!next.union) {
    next.union = { kind: "couple", a: null, b: null, kids: [] };
  }
  if (!Array.isArray(next.union.kids)) next.union.kids = [];
  const newChild = {
    kind: "person",
    id: crypto.randomUUID(),
    name: personData.name || "Child",
    sex: personData.sex || "F",
    nick: personData.nick || "",
    born: personData.born || "",
    link: true,
    locked: false,
    ...personData,
  };
  next.union.kids.push(newChild);
  return next;
}

export function addMemberToTree(tree, { side = "mandi", relation = "Relative", name = "", sex = "F", nick = "", born = "" } = {}) {
  const next = JSON.parse(JSON.stringify(tree));
  const relLower = String(relation || "").toLowerCase();
  const person = {
    kind: "person",
    id: crypto.randomUUID(),
    name: name || relation || "Family Member",
    sex: sex || "F",
    nick: nick || "",
    born: born || "",
    relation: relation || "",
    locked: false,
  };

  if (side === "union" || relLower.includes("child") || relLower.includes("daughter") || relLower.includes("son")) {
    if (!next.union) next.union = { kind: "couple", a: null, b: null, kids: [] };
    if (!Array.isArray(next.union.kids)) next.union.kids = [];
    next.union.kids.push({ ...person, link: true });
    return next;
  }

  const branchKey = side === "tudu" ? "tudu" : "mandi";
  const branch = next[branchKey];
  if (!branch) return next;

  if (relLower.includes("grand")) {
    if (!branch.a) branch.a = person;
    else if (!branch.b) branch.b = person;
    else {
      if (!Array.isArray(branch.kids)) branch.kids = [];
      branch.kids.push(person);
    }
    return next;
  }

  if (relLower.includes("parent") || relLower.includes("father") || relLower.includes("mother")) {
    const g2 = branch.kids?.[0];
    if (g2) {
      if (!g2.a) g2.a = person;
      else if (!g2.b) g2.b = person;
      else {
        if (!Array.isArray(branch.kids)) branch.kids = [];
        branch.kids.push(c(person, null, []));
      }
    }
    return next;
  }

  const parentCouple = branch.kids?.[0];
  if (parentCouple) {
    if (!Array.isArray(parentCouple.kids)) parentCouple.kids = [];
    if (relLower.includes("spouse") || relLower.includes("husband") || relLower.includes("wife") || relLower.includes("partner")) {
      const single = parentCouple.kids.find((k) => k && k.kind === "person" && !k.link);
      if (single) {
        const idx = parentCouple.kids.indexOf(single);
        parentCouple.kids[idx] = c(single, person, []);
        return next;
      }
    }
    if (branchKey === "mandi") {
      parentCouple.kids.unshift(person);
    } else {
      parentCouple.kids.push(person);
    }
  }
  return next;
}

export function mapPerson(node, id, patch) {
  if (!node) return node;
  if (node.kind === "person") return node.id === id ? { ...node, ...patch } : node;
  if (node.kind === "group") {
    return { kind: "group", kids: (node.kids || []).map((kid) => mapPerson(kid, id, patch)) };
  }
  return {
    kind: "couple",
    a: mapPerson(node.a, id, patch),
    b: mapPerson(node.b, id, patch),
    kids: (node.kids || []).map((kid) => mapPerson(kid, id, patch)),
  };
}

export function removePerson(node, id) {
  if (!node) return null;
  if (node.kind === "person") return node.id === id && !node.locked ? null : node;
  if (node.kind === "group") {
    const kids = (node.kids || []).map((kid) => removePerson(kid, id)).filter(Boolean);
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0];
    return { kind: "group", kids };
  }
  const a = removePerson(node.a, id);
  const b = removePerson(node.b, id);
  const kids = (node.kids || []).map((kid) => removePerson(kid, id)).filter(Boolean);
  if (!a && !b) {
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0];
    return { kind: "group", kids };
  }
  return { kind: "couple", a, b, kids };
}

const FACE = `<span class="ft-face" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8.2" r="3.6"/><path d="M5 19.6c.4-3.6 3.2-6 7-6s6.6 2.4 7 6"/></svg></span>`;

function cardHtml(escapeHtml, person, role = "") {
  if (!person) return "";
  const roleClass = role ? ` is-${role}` : "";
  return `
    <article class="ft-card ${person.sex === "F" ? "is-f" : "is-m"}${person.link ? " is-link" : ""}${roleClass}" data-role="${escapeHtml(role)}" data-tree-id="${escapeHtml(person.id)}" data-locked="${person.locked ? "1" : "0"}">
      ${FACE}
      <input data-field="name" value="${escapeHtml(person.name || "")}" placeholder="Name" />
      <input data-field="relation" placeholder="Relation" value="${escapeHtml(person.relation || "")}" />
      <input data-field="nick" placeholder="Nickname" value="${escapeHtml(person.nick || "")}" />
      <input data-field="born" placeholder="Birthday" value="${escapeHtml(person.born || "")}" />
    </article>
  `;
}

function pairHtml(escapeHtml, a, b, key, roles = {}) {
  const people = [
    a && { person: a, role: roles.a || (b ? "" : "blood") },
    b && { person: b, role: roles.b || "" },
  ].filter(Boolean);
  if (!people.length) return "";
  const stem = roles.stem ? " ft-stem" : "";
  const cards = people.map(({ person, role }) => cardHtml(escapeHtml, person, role)).join("");
  return `<div class="ft-pair${stem}" data-pair="${escapeHtml(key)}">${cards}</div>`;
}

function peopleOf(kids) {
  return (kids || []).flatMap((kid) => {
    if (!kid) return [];
    if (kid.kind === "person") return [kid];
    return [kid.a, kid.b].filter(Boolean);
  });
}

function kidUnit(kid, side) {
  if (!kid) return null;
  if (kid.kind === "person") {
    return {
      side,
      a: kid,
      b: null,
      kids: [],
      join: Boolean(kid.link),
    };
  }
  if (kid.a?.link || kid.b?.link) {
    const self = kid.a?.link ? kid.a : kid.b;
    return {
      side,
      a: self,
      b: null,
      kids: [],
      join: true,
    };
  }
  return { side, a: kid.a, b: kid.b, kids: peopleOf(kid.kids), join: false, blood: "a" };
}

function houseUnits(tree) {
  const mandi = (tree.mandi?.kids?.[0]?.kids || []).map((kid) => kidUnit(kid, "mandi")).filter(Boolean);
  const tudu = (tree.tudu?.kids?.[0]?.kids || []).map((kid) => kidUnit(kid, "tudu")).filter(Boolean);
  const children = (tree.union?.kids || []).filter((kid) => kid && (kid.kind === "person" || kid.name));
  return { mandi, tudu, children };
}

function unitHtml(escapeHtml, unit, key) {
  const kids = (unit.kids || []).map((kid) => cardHtml(escapeHtml, kid, "blood")).join("");
  const mark = unit.join ? (unit.side === "mandi" ? " data-khu" : " data-bhutku") : "";
  const roles = unit.b ? { a: "blood", b: "inlaw" } : { a: "blood" };
  return `
    <div class="ft-unit" data-unit="${escapeHtml(key)}" data-side="${unit.side}"${mark}>
      ${pairHtml(escapeHtml, unit.a, unit.b, key, roles)}
      ${kids ? `<div class="ft-kids" data-kids="${escapeHtml(key)}">${kids}</div>` : ""}
    </div>
  `;
}

export function familyTreeHtml(escapeHtml, tree) {
  const source = tree || defaultFamilyTree();
  const mandiG1 = source.mandi;
  const mandiG2 = mandiG1?.kids?.[0];
  const tuduG1 = source.tudu;
  const tuduG2 = tuduG1?.kids?.[0];
  const houses = houseUnits(source);
  return `
    <div class="chart-scroll">
      <div class="chart" data-chart>
        <svg class="chart-lines" data-tree-lines></svg>
        <div class="chart-row chart-g1">
          <div class="chart-house">${pairHtml(escapeHtml, mandiG1?.a, mandiG1?.b, "mandi-g1")}</div>
          <div class="chart-house">${pairHtml(escapeHtml, tuduG1?.a, tuduG1?.b, "tudu-g1")}</div>
        </div>
        <div class="chart-row chart-g2">
          <div class="chart-house">${pairHtml(escapeHtml, mandiG2?.a, mandiG2?.b, "mandi-g2", { a: "blood", b: "inlaw", stem: true })}</div>
          <div class="chart-house">${pairHtml(escapeHtml, tuduG2?.a, tuduG2?.b, "tudu-g2", { a: "blood", b: "inlaw", stem: true })}</div>
        </div>
        <div class="chart-row chart-g3">
          <div class="chart-house chart-g3-house" data-g3-mandi>
            ${houses.mandi.map((unit, index) => unitHtml(escapeHtml, unit, `mandi-g3-${index}`)).join("")}
          </div>
          <div class="chart-house chart-g3-house" data-g3-tudu>
            ${houses.tudu.map((unit, index) => unitHtml(escapeHtml, unit, `tudu-g3-${index}`)).join("")}
          </div>
        </div>
        ${(houses.children || []).map((child, idx) => `
          <div class="ft-olly" data-child-idx="${idx}" data-olly-id="${escapeHtml(child.id)}">
            ${cardHtml(escapeHtml, child, "blood")}
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function rel(chart, node) {
  const box = chart.getBoundingClientRect();
  const face = node.querySelector(".ft-face") || node;
  const r = face.getBoundingClientRect();
  return {
    x: r.left - box.left + r.width / 2,
    y: r.top - box.top + r.height / 2,
    top: r.top - box.top,
    bottom: r.bottom - box.top,
  };
}

function bloodCard(pair) {
  return pair?.querySelector(".ft-card.is-blood") || pair?.querySelector(".ft-card");
}

function pairPoints(chart, pair) {
  if (!pair) return null;
  const cards = [...pair.querySelectorAll(".ft-card")];
  if (!cards.length) return null;
  const pts = cards.map((card) => rel(chart, card));
  const midX = pts.reduce((sum, pt) => sum + pt.x, 0) / pts.length;
  const blood = bloodCard(pair);
  const bloodPt = blood ? rel(chart, blood) : pts[0];
  return {
    pts,
    midX,
    bloodX: bloodPt.x,
    bloodY: bloodPt.y,
    y: pts[0].y,
    top: Math.min(...pts.map((pt) => pt.top)),
    bottom: Math.max(...pts.map((pt) => pt.bottom)),
  };
}

function pinFace(chart, node, x, top) {
  node.style.transform = "none";
  node.style.left = "0px";
  node.style.top = "0px";
  const box = chart.getBoundingClientRect();
  const wrapTop = node.getBoundingClientRect().top - box.top;
  node.style.top = `${top - wrapTop}px`;
  for (let i = 0; i < 4; i += 1) {
    const now = rel(chart, node);
    const left = parseFloat(node.style.left) || 0;
    node.style.left = `${left + (x - now.x)}px`;
    if (Math.abs(rel(chart, node).x - x) < 0.25) break;
  }
}

export function drawFamilyLines(root) {
  const chart = root.querySelector("[data-chart]");
  const svg = root.querySelector("[data-tree-lines]");
  if (!chart || !svg) return;
  const khu = chart.querySelector("[data-khu] .ft-card");
  const bhutku = chart.querySelector("[data-bhutku] .ft-card");
  const childCards = [...chart.querySelectorAll(".ft-olly")];
  if (khu && bhutku && childCards.length) {
    const a = rel(chart, khu);
    const b = rel(chart, bhutku);
    const midX = (a.x + b.x) / 2;
    const chartBox = chart.getBoundingClientRect();
    const below = Math.max(khu.getBoundingClientRect().bottom, bhutku.getBoundingClientRect().bottom) - chartBox.top + 28;
    const cardW = childCards[0]?.offsetWidth || 92;
    const spacing = cardW + 20;
    const totalW = (childCards.length - 1) * spacing;
    const startX = midX - totalW / 2;
    childCards.forEach((childEl, i) => {
      pinFace(chart, childEl, startX + i * spacing, below);
    });
  }
  const w = Math.max(chart.scrollWidth, chart.clientWidth);
  const h = Math.max(chart.scrollHeight, chart.clientHeight);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  const lines = [];
  const add = (x1, y1, x2, y2) => {
    if (Math.hypot(x2 - x1, y2 - y1) < 0.5) return;
    lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`);
  };
  const join = (pair) => {
    if (!pair) return null;
    const info = pairPoints(chart, pair);
    if (!info) return null;
    if (info.pts.length >= 2) add(info.pts[0].x, info.pts[0].y, info.pts[1].x, info.pts[1].y);
    return info;
  };
  const fork = (originX, originY, targets, gap = 28) => {
    const kids = targets.filter((pt) => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y));
    if (!kids.length || !Number.isFinite(originX) || !Number.isFinite(originY)) return;
    const barY = Math.min(...kids.map((pt) => pt.top ?? pt.y)) - gap;
    add(originX, originY, originX, barY);
    const xs = [originX, ...kids.map((pt) => pt.x)];
    add(Math.min(...xs), barY, Math.max(...xs), barY);
    kids.forEach((pt) => add(pt.x, barY, pt.x, pt.y));
  };
  const mandi1 = join(chart.querySelector('[data-pair="mandi-g1"]'));
  const tudu1 = join(chart.querySelector('[data-pair="tudu-g1"]'));
  const mandi2 = join(chart.querySelector('[data-pair="mandi-g2"]'));
  const tudu2 = join(chart.querySelector('[data-pair="tudu-g2"]'));
  if (mandi1 && mandi2) fork(mandi1.midX, mandi1.y, [{ x: mandi2.bloodX, y: mandi2.bloodY, top: mandi2.top }]);
  if (tudu1 && tudu2) fork(tudu1.midX, tudu1.y, [{ x: tudu2.bloodX, y: tudu2.bloodY, top: tudu2.top }]);
  const hang = (parent, units) => {
    const infos = units
      .map((unit) => join(unit.querySelector("[data-pair]")))
      .filter(Boolean);
    if (!parent || !infos.length) return;
    fork(
      parent.midX,
      parent.y,
      infos.map((info) => ({ x: info.bloodX, y: info.bloodY ?? info.y, top: info.top }))
    );
  };
  hang(mandi2, [...chart.querySelectorAll('[data-side="mandi"]')]);
  hang(tudu2, [...chart.querySelectorAll('[data-side="tudu"]')]);
  if (khu && bhutku) {
    const a = rel(chart, khu);
    const b = rel(chart, bhutku);
    const midX = (a.x + b.x) / 2;
    add(a.x, a.y, b.x, b.y);
    if (childCards.length) {
      const childPts = childCards.map((card) => rel(chart, card));
      fork(midX, a.y, childPts);
    }
  }
  [...chart.querySelectorAll("[data-unit]")].forEach((unit) => {
    const pair = unit.querySelector("[data-pair]");
    const kids = unit.querySelector("[data-kids]");
    const parent = pair ? pairPoints(chart, pair) : null;
    if (!parent || !kids) return;
    const childPts = [...kids.querySelectorAll(".ft-card")].map((card) => rel(chart, card));
    fork(parent.midX, parent.y, childPts, 18);
  });
  svg.innerHTML = lines.join("");
}
