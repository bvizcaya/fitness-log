import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc, addDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// ---------------- tabs ----------------
const TABS = [["today", "Today"], ["workouts", "Workouts"], ["weight", "Weight"], ["settings", "Settings"]];
const ICONS = {
  today: '<path d="M7 3v8a3 3 0 0 0 3 3v7M10 3v6M13 3v8a3 3 0 0 1-3 3"/><path d="M17.5 21V3c-1.9 1.2-2.8 3.6-2.8 6.6V13h2.8"/>',
  workouts: '<path d="M6.7 6v12M17.3 6v12M3.6 9v6M20.4 9v6M6.7 12h10.6"/>',
  weight: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 9.5a5.5 5.5 0 0 1 8 0l-2.4 2.6a2.2 2.2 0 0 0-3.2 0z"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
};
const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack"];

// ---------------- appearance ----------------
function applyTheme(choice) {
  if (choice === "light" || choice === "dark") document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem("fit.theme", choice); } catch {}
  document.querySelectorAll("#themeSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.themeChoice === choice)));
}
let themeNow = "system"; try { themeNow = localStorage.getItem("fit.theme") || "system"; } catch {}
applyTheme(themeNow);

// ---------------- helpers ----------------
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const optNum = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const r1 = n => Math.round(n * 10) / 10;
const fmt = (n, d = 0) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtG = n => fmt(Math.round(n)) + "g";
const iso = d => { const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return x.toISOString().slice(0, 10); };
const today = () => iso(new Date());
const parseD = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return iso(d); };
const dayDiff = (a, b) => Math.round((parseD(b) - parseD(a)) / 86400000);
const short = s => parseD(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const longD = s => parseD(s).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
const weekStart = s => { const d = parseD(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); }; // Monday
const uid8 = () => Math.random().toString(36).slice(2, 10);
const KG = 0.45359237;
const conv = (w, from, to) => (from === to || !from) ? w : (to === "kg" ? w * KG : w / KG);
const convD = (d, from, to) => (from === to || !from) ? d : (to === "km" ? d * 1.609344 : d / 1.609344);

let toastT;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2200); }
const fail = er => { console.error(er); toast(er && er.code === "permission-denied" ? "You don't have permission to change that." : "Couldn't save. Check your connection and try again."); };

// ---------------- firebase ----------------
if (!firebaseConfig || firebaseConfig.apiKey === "PASTE_HERE") {
  document.body.innerHTML = `<div class="wrap"><div class="notice" style="margin-top:20vh">Setup isn't finished yet. Paste your Firebase settings into <b>firebase-config.js</b> (see README).</div></div>`;
  throw new Error("Missing Firebase config");
}
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let db;
// Keeps a copy on the phone so logging works at the gym with bad signal; it syncs when back online.
try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch { db = getFirestore(app); }

// ---------------- state ----------------
const DEFAULTS = { unit: "lb", cal: 2200, p: 160, c: 220, f: 70, goalW: null, addBurn: false, steps: 10000 };
const S = {
  uid: null, set: { ...DEFAULTS }, days: {}, steps: {}, weights: [], workouts: [], lib: [],
  day: today(), meal: null, editing: null, range: 90, woKind: "strength", woEditing: null, tab: "today",
};
let unsubs = [];
const U = () => S.set.unit || "lb";
const DU = () => U() === "kg" ? "km" : "mi";
const userDoc = () => doc(db, "fitness", S.uid);
const sub = (...p) => doc(db, "fitness", S.uid, ...p);
const col = name => collection(db, "fitness", S.uid, name);

// ---------------- login ----------------
try { $("email").value = localStorage.getItem("fit.email") || ""; } catch {}
$("loginForm").onsubmit = async e => {
  e.preventDefault();
  const err = $("loginErr"); err.hidden = true;
  $("loginBtn").disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $("email").value.trim(), $("pw").value);
    try { localStorage.setItem("fit.email", $("email").value.trim()); } catch {}
    $("pw").value = "";
  } catch (er) {
    err.textContent = er.code === "auth/too-many-requests" ? "Too many tries. Wait a few minutes and try again." : "That email and password didn't match. Try again.";
    err.hidden = false;
  } finally { $("loginBtn").disabled = false; }
};
$("forgot").onclick = async () => {
  const em = $("email").value.trim();
  if (!em) { $("loginErr").textContent = "Type your email first, then tap Forgot password."; $("loginErr").hidden = false; return; }
  try { await sendPasswordResetEmail(auth, em); toast("Reset email sent"); } catch { toast("Couldn't send the reset email."); }
};

onAuthStateChanged(auth, user => {
  unsubs.forEach(u => u()); unsubs = [];
  if (!user) { $("appView").hidden = true; $("loginView").hidden = false; return; }
  S.uid = user.uid;
  $("loginView").hidden = true; $("appView").hidden = false;
  const em = user.email || "";
  $("meBadge").textContent = (em[0] || "?");
  $("acctEmail").textContent = "Signed in as " + em;
  buildTabs();
  start();
});
$("signOut").onclick = () => signOut(auth);
$("pwForm").onsubmit = async e => {
  e.preventDefault();
  try { await updatePassword(auth.currentUser, $("newPw").value); $("newPw").value = ""; toast("Password changed"); }
  catch (er) { toast(er.code === "auth/requires-recent-login" ? "Sign out and back in, then change your password." : "Couldn't change the password."); }
};

// ---------------- data ----------------
function start() {
  S.days = {}; S.steps = {}; S.weights = []; S.workouts = []; S.lib = []; S.set = { ...DEFAULTS };
  unsubs.push(onSnapshot(col("steps"), snap => { S.steps = {}; snap.forEach(d => S.steps[d.id] = d.data()); renderSteps(); renderHK(); }, fail));
  unsubs.push(onSnapshot(userDoc(), snap => { S.set = { ...DEFAULTS, ...(snap.exists() ? snap.data() : {}) }; fillSettings(); renderAll(); }, fail));
  unsubs.push(onSnapshot(col("days"), snap => { S.days = {}; snap.forEach(d => S.days[d.id] = d.data()); renderToday(); }, fail));
  unsubs.push(onSnapshot(col("weights"), snap => {
    S.weights = []; snap.forEach(d => S.weights.push({ date: d.id, ...d.data() }));
    S.weights.sort((a, b) => a.date < b.date ? -1 : 1); renderWeight(); renderCalc();
  }, fail));
  unsubs.push(onSnapshot(col("workouts"), snap => {
    S.workouts = []; snap.forEach(d => S.workouts.push({ id: d.id, ...d.data() }));
    S.workouts.sort((a, b) => a.date === b.date ? (b.at || 0) - (a.at || 0) : (a.date < b.date ? 1 : -1));
    renderWorkouts(); renderToday();
  }, fail));
  unsubs.push(onSnapshot(sub("meta", "library"), snap => { S.lib = (snap.exists() && snap.data().items) || []; renderLib(); }, fail));
}
const saveSet = patch => setDoc(userDoc(), patch, { merge: true }).catch(fail);

function renderAll() { renderToday(); renderWorkouts(); renderWeight(); renderLib(); renderCalc(); }

// ---------------- tabs ----------------
function buildTabs() {
  $("tabs").innerHTML = TABS.map(([k, t]) => `<button role="tab" data-tab="${k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>${t}</button>`).join("");
  let t = "today"; try { t = localStorage.getItem("fit.tab") || "today"; } catch {}
  showTab(TABS.some(x => x[0] === t) ? t : "today");
}
function showTab(t) {
  S.tab = t;
  document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  document.querySelectorAll("section.panel").forEach(s => s.hidden = s.id !== "tab-" + t);
  $("pageTitle").textContent = TABS.find(x => x[0] === t)[1];
  try { localStorage.setItem("fit.tab", t); } catch {}
  window.scrollTo(0, 0);
}
$("tabs").onclick = e => { const b = e.target.closest("button"); if (b) showTab(b.dataset.tab); };
$("themeSeg").onclick = e => { const b = e.target.closest("[data-theme-choice]"); if (b) applyTheme(b.dataset.themeChoice); };

// =====================================================================
// TODAY: food, calories, macros
// =====================================================================
const foodsOn = d => (S.days[d] && S.days[d].foods) || [];
function totals(list) {
  return list.reduce((t, x) => { const q = num(x.qty) || 0; t.cal += num(x.cal) * q; t.p += num(x.p) * q; t.c += num(x.c) * q; t.f += num(x.f) * q; return t; }, { cal: 0, p: 0, c: 0, f: 0 });
}
const burnedOn = d => S.workouts.filter(w => w.date === d).reduce((s, w) => s + num(w.cal), 0);
const goalOn = d => num(S.set.cal) + (S.set.addBurn ? burnedOn(d) : 0);

function defaultMeal() { const h = new Date().getHours(); return h < 10.5 ? "Breakfast" : h < 15 ? "Lunch" : h < 21 ? "Dinner" : "Snack"; }
function setMeal(m) {
  S.meal = m;
  document.querySelectorAll("#mealSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.meal === m)));
  $("fSubmit").textContent = S.editing ? "Save Changes" : "Add to " + m;
}
setMeal(defaultMeal());
$("mealSeg").onclick = e => { const b = e.target.closest("[data-meal]"); if (b) setMeal(b.dataset.meal); };

document.querySelectorAll("[data-day]").forEach(b => b.onclick = () => {
  const n = addDays(S.day, +b.dataset.day);
  if (n > today()) return;
  S.day = n; cancelEdit(); renderToday();
});

function renderToday() {
  const d = S.day, t = today();
  $("dayDate").textContent = d === t ? "Today" : d === addDays(t, -1) ? "Yesterday" : parseD(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  document.querySelector('[data-day="1"]').disabled = d >= t;
  document.querySelector('[data-day="1"]').style.opacity = d >= t ? .3 : 1;

  const list = foodsOn(d), tot = totals(list), goal = goalOn(d), burn = burnedOn(d);
  const left = Math.round(goal - tot.cal);
  $("calLeft").textContent = goal ? fmt(Math.abs(left)) : fmt(tot.cal);
  $("calLeftLabel").textContent = !goal ? "calories" : left >= 0 ? "cal left" : "cal over";
  $("calRing").classList.toggle("over", goal > 0 && left < 0);
  const C = 2 * Math.PI * 56, frac = goal ? Math.min(1, tot.cal / goal) : 0;
  $("calArc").setAttribute("stroke-dashoffset", String(C * (1 - frac)));
  $("calEaten").textContent = fmt(tot.cal);
  $("calGoal").textContent = goal ? fmt(goal) : "—";
  $("calBurn").textContent = fmt(burn);
  for (const [k, id] of [["p", "mP"], ["c", "mC"], ["f", "mF"]]) {
    const g = num(S.set[k]);
    $(id).textContent = g ? `${fmt(Math.round(tot[k]))} / ${fmt(g)}g` : fmtG(tot[k]);
    $(id + "Bar").style.width = (g ? Math.min(100, tot[k] / g * 100) : 0) + "%";
  }

  // meals
  const html = MEALS.map(m => {
    const items = list.map((x, i) => ({ ...x, i })).filter(x => (x.meal || "Snack") === m);
    if (!items.length) return "";
    const mt = totals(items);
    return `<div class="meal"><div class="mealhead"><h3>${m}</h3><span class="foot num">${fmt(mt.cal)} cal</span></div>
      <ul class="list">${items.map(x => {
        const q = num(x.qty);
        return `<li class="tap" data-edit="${x.i}"><div class="grow"><div>${esc(x.name)}</div>
          <div class="sub">${q !== 1 ? r1(q) + " × · " : ""}<span class="dot p"></span> ${fmt(x.p * q)}g &nbsp;<span class="dot c"></span> ${fmt(x.c * q)}g &nbsp;<span class="dot f"></span> ${fmt(x.f * q)}g</div></div>
          <span class="amt">${fmt(x.cal * q)}</span><button class="x" data-del="${x.i}" aria-label="Remove ${esc(x.name)}">×</button></li>`;
      }).join("")}</ul></div>`;
  }).join("");
  $("mealList").innerHTML = html || `<div class="empty">Nothing logged ${d === t ? "yet today" : "this day"}. Add food below, or tap + in My Foods.</div>`;
  $("copyYesterday").hidden = list.length > 0 || foodsOn(addDays(d, -1)).length === 0;

  renderWeekChart();
  renderSteps();
}

$("mealList").onclick = e => {
  const del = e.target.closest("[data-del]");
  if (del) { e.stopPropagation(); removeFood(+del.dataset.del); return; }
  const li = e.target.closest("[data-edit]");
  if (li) startEdit(+li.dataset.edit);
};

function saveDay(d, foods) { return setDoc(sub("days", d), { foods }).catch(fail); }
async function removeFood(i) {
  const list = foodsOn(S.day).slice(); const [gone] = list.splice(i, 1);
  if (S.editing === i) cancelEdit();
  await saveDay(S.day, list); toast(`Removed ${gone ? gone.name : "food"}`);
}
$("copyYesterday").onclick = async () => {
  const y = foodsOn(addDays(S.day, -1)); if (!y.length) return;
  await saveDay(S.day, y.map(x => ({ ...x, id: uid8() }))); toast(`Copied ${y.length} item${y.length > 1 ? "s" : ""}`);
};

// food form
function startEdit(i) {
  const x = foodsOn(S.day)[i]; if (!x) return;
  S.editing = i;
  $("fName").value = x.name; $("fQty").value = x.qty; $("fCal").value = x.cal || ""; $("fP").value = x.p || ""; $("fC").value = x.c || ""; $("fF").value = x.f || "";
  $("foodFormTitle").textContent = "Edit food"; $("fCancel").hidden = false; $("fSuggest").hidden = true;
  setMeal(x.meal || "Snack");
  $("foodCard").scrollIntoView({ behavior: "smooth", block: "start" });
}
function cancelEdit() {
  S.editing = null; $("foodForm").reset(); $("fQty").value = 1; $("fSave").checked = true;
  $("foodFormTitle").textContent = "Add food"; $("fCancel").hidden = true; setMeal(S.meal);
}
$("fCancel").onclick = cancelEdit;

$("fName").oninput = () => {
  const q = $("fName").value.trim().toLowerCase();
  if (!q || S.editing !== null) { $("fSuggest").hidden = true; return; }
  const hits = S.lib.filter(x => x.name.toLowerCase().includes(q)).slice(0, 5);
  $("fSuggest").innerHTML = hits.map(x => `<button type="button" data-pick="${esc(x.name)}"><span>${esc(x.name)}</span><span>${fmt(x.cal)} cal · ${fmt(x.p)}P ${fmt(x.c)}C ${fmt(x.f)}F</span></button>`).join("");
  $("fSuggest").hidden = !hits.length;
};
$("fSuggest").onclick = e => {
  const b = e.target.closest("[data-pick]"); if (!b) return;
  const x = S.lib.find(y => y.name === b.dataset.pick); if (!x) return;
  $("fName").value = x.name; $("fCal").value = x.cal || ""; $("fP").value = x.p || ""; $("fC").value = x.c || ""; $("fF").value = x.f || "";
  $("fSuggest").hidden = true; $("fQty").focus(); $("fQty").select();
};

$("foodForm").onsubmit = async e => {
  e.preventDefault();
  const p = num($("fP").value), c = num($("fC").value), f = num($("fF").value);
  let cal = optNum($("fCal").value);
  if (cal === null) cal = Math.round(p * 4 + c * 4 + f * 9);
  const item = { id: uid8(), name: $("fName").value.trim(), meal: S.meal, qty: num($("fQty").value) || 1, cal, p, c, f };
  if (!item.name) return;
  const list = foodsOn(S.day).slice();
  if (S.editing !== null && list[S.editing]) { item.id = list[S.editing].id || item.id; list[S.editing] = item; }
  else list.push(item);
  const wasEditing = S.editing !== null;
  await saveDay(S.day, list);
  if ($("fSave").checked && !wasEditing) await saveToLib(item);
  toast(wasEditing ? "Saved" : `Added to ${item.meal}`);
  cancelEdit(); $("fSuggest").hidden = true;
};

// My Foods library
async function saveToLib(x) {
  const items = S.lib.filter(y => y.name.toLowerCase() !== x.name.toLowerCase());
  items.unshift({ name: x.name, cal: x.cal, p: x.p, c: x.c, f: x.f });
  await setDoc(sub("meta", "library"), { items: items.slice(0, 300) }).catch(fail);
}
function renderLib() {
  const q = $("libSearch").value.trim().toLowerCase();
  const items = S.lib.map((x, i) => ({ ...x, i })).filter(x => !q || x.name.toLowerCase().includes(q));
  $("libCount").textContent = S.lib.length ? `${S.lib.length} saved` : "";
  $("libList").innerHTML = items.slice(0, q ? 50 : 12).map(x => `<li><div class="grow"><div>${esc(x.name)}</div>
    <div class="sub">${fmt(x.cal)} cal · <span class="dot p"></span> ${fmt(x.p)}g <span class="dot c"></span> ${fmt(x.c)}g <span class="dot f"></span> ${fmt(x.f)}g</div></div>
    <button class="plus" data-quick="${x.i}" aria-label="Add ${esc(x.name)}">+</button><button class="x" data-unlib="${x.i}" aria-label="Delete ${esc(x.name)} from My Foods">×</button></li>`).join("")
    || `<li class="empty">${S.lib.length ? "No matches." : "Foods you add are saved here, so next time it's one tap."}</li>`;
}
$("libSearch").oninput = renderLib;
$("libList").onclick = async e => {
  const qb = e.target.closest("[data-quick]");
  if (qb) {
    const x = S.lib[+qb.dataset.quick]; if (!x) return;
    const list = foodsOn(S.day).slice(); list.push({ id: uid8(), name: x.name, meal: S.meal, qty: 1, cal: x.cal, p: x.p, c: x.c, f: x.f });
    await saveDay(S.day, list); toast(`Added ${x.name} to ${S.meal}`); return;
  }
  const ub = e.target.closest("[data-unlib]");
  if (ub) {
    const x = S.lib[+ub.dataset.unlib]; if (!x || !confirm(`Remove "${x.name}" from My Foods? Days you already logged stay the same.`)) return;
    await setDoc(sub("meta", "library"), { items: S.lib.filter((_, i) => i !== +ub.dataset.unlib) }).catch(fail);
  }
};

// 7-day chart
function renderWeekChart() {
  const end = S.day, days = [...Array(7)].map((_, i) => addDays(end, i - 6));
  const vals = days.map(d => totals(foodsOn(d)));
  const goal = num(S.set.cal);
  const W = 600, H = 170, padL = 52, padB = 26, top = 10;
  const max = Math.max(goal * 1.15, ...vals.map(v => v.cal), 500);
  const y = v => top + (H - padB - top) * (1 - v / max);
  const bw = (W - padL) / 7;
  let s = "";
  for (const g of [0, max / 2, max]) s += `<text x="0" y="${y(g) + 4}">${fmt(Math.round(g / 100) * 100)}</text>`;
  days.forEach((d, i) => {
    const v = vals[i].cal, x = padL + i * bw + bw * .2, w = bw * .6;
    const color = !goal || !v ? "var(--accent)" : Math.abs(v - goal) <= goal * .1 ? "var(--good)" : v > goal ? "var(--bad)" : "var(--accent)";
    if (v) s += `<rect x="${x}" y="${y(v)}" width="${w}" height="${y(0) - y(v)}" rx="6" fill="${color}" opacity="${d === S.day ? 1 : .75}"><title>${short(d)}: ${fmt(v)} cal</title></rect>`;
    else s += `<rect x="${x}" y="${y(0) - 3}" width="${w}" height="3" rx="1.5" fill="var(--sunk)"/>`;
    s += `<text x="${x + w / 2}" y="${H - 4}" text-anchor="middle" ${d === S.day ? 'style="fill:var(--ink);font-weight:600"' : ""}>${parseD(d).toLocaleDateString("en-US", { weekday: "narrow" })}</text>`;
  });
  if (goal) s += `<line x1="${padL}" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" stroke="var(--ink)" stroke-opacity=".35" stroke-dasharray="4 4"/><text x="${W}" y="${y(goal) - 5}" text-anchor="end">goal</text>`;
  $("weekChart").innerHTML = s;
  const logged = vals.filter(v => v.cal > 0);
  $("avgCal").textContent = logged.length ? fmt(logged.reduce((a, v) => a + v.cal, 0) / logged.length) : "—";
  $("avgP").textContent = logged.length ? fmtG(logged.reduce((a, v) => a + v.p, 0) / logged.length) : "—";
  $("daysOn").textContent = goal ? `${logged.filter(v => Math.abs(v.cal - goal) <= goal * .1).length} of 7` : "—";
}

// =====================================================================
// WORKOUTS
// =====================================================================
function setKind(k) {
  S.woKind = k;
  document.querySelectorAll("#woKind button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.kind === k)));
  $("strengthBox").hidden = k !== "strength"; $("cardioBox").hidden = k !== "cardio";
  if (k === "strength" && !$("exList").children.length) addExercise();
}
$("woKind").onclick = e => { const b = e.target.closest("[data-kind]"); if (b) setKind(b.dataset.kind); };

function setRow(n, set = {}) {
  return `<div class="setrow"><span class="n">${n}</span>
    <input type="number" min="0" step="1" inputmode="numeric" placeholder="reps" aria-label="Reps" data-r value="${set.r ?? ""}">
    <input type="number" min="0" step="0.5" inputmode="decimal" placeholder="${U()}" aria-label="Weight" data-w value="${set.w ?? ""}">
    <button type="button" class="x" data-rmset aria-label="Remove set">×</button></div>`;
}
function addExercise(ex = { name: "", sets: [{}, {}, {}] }) {
  const div = document.createElement("div");
  div.className = "ex";
  div.innerHTML = `<div class="row" style="flex-wrap:nowrap"><input type="text" maxlength="60" placeholder="Exercise (e.g. Bench press)" aria-label="Exercise name" list="exNames" data-name value="${esc(ex.name)}"><button type="button" class="x" data-rmex aria-label="Remove exercise">×</button></div>
    <div class="hint" data-hint></div>
    <div class="sethead"><span>Set</span><span>Reps</span><span>${U()}</span><span></span></div>
    <div data-sets style="display:flex;flex-direction:column;gap:6px">${(ex.sets.length ? ex.sets : [{}]).map((s, i) => setRow(i + 1, s)).join("")}</div>
    <button type="button" class="ghost" data-addset style="align-self:flex-start">+ Set</button>`;
  $("exList").appendChild(div);
  showHint(div);
  return div;
}
function renumber(ex) { ex.querySelectorAll(".setrow .n").forEach((n, i) => n.textContent = i + 1); }
$("addEx").onclick = () => addExercise().querySelector("[data-name]").focus();
$("exList").onclick = e => {
  const ex = e.target.closest(".ex"); if (!ex) return;
  if (e.target.closest("[data-rmex]")) { ex.remove(); if (!$("exList").children.length) addExercise(); return; }
  if (e.target.closest("[data-addset]")) {
    const sets = ex.querySelector("[data-sets]"), last = sets.lastElementChild;
    const prev = last ? { r: last.querySelector("[data-r]").value, w: last.querySelector("[data-w]").value } : {};
    sets.insertAdjacentHTML("beforeend", setRow(sets.children.length + 1, prev)); return;
  }
  if (e.target.closest("[data-rmset]")) { const sets = ex.querySelector("[data-sets]"); if (sets.children.length > 1) { e.target.closest(".setrow").remove(); renumber(ex); } }
};
$("exList").oninput = e => { if (e.target.matches("[data-name]")) showHint(e.target.closest(".ex")); };

function lastTime(name) {
  const n = name.trim().toLowerCase(); if (!n) return null;
  for (const w of S.workouts) {
    if (S.woEditing && w.id === S.woEditing) continue;
    const ex = (w.exercises || []).find(x => x.name.trim().toLowerCase() === n);
    if (ex) return { w, ex };
  }
  return null;
}
const setsText = (sets, u) => {
  const groups = []; for (const s of sets) { const k = `${s.r || 0}×${r1(conv(num(s.w), u, U()))}`; const g = groups[groups.length - 1]; if (g && g.k === k) g.n++; else groups.push({ k, n: 1, s }); }
  return groups.map(g => { const w = r1(conv(num(g.s.w), u, U())); return `${g.n > 1 ? g.n + "×" : ""}${g.s.r || 0}${w ? " @ " + fmt(w, w % 1 ? 1 : 0) : ""}`; }).join(", ");
};
function showHint(ex) {
  const lt = lastTime(ex.querySelector("[data-name]").value);
  ex.querySelector("[data-hint]").textContent = lt ? `Last time (${short(lt.w.date)}): ${setsText(lt.ex.sets, lt.w.u)}${U() === "lb" ? " lb" : " kg"}` : "";
}

function fillTitles() {
  const titles = [...new Set(S.workouts.map(w => w.title).filter(Boolean))].slice(0, 30);
  $("woTitles").innerHTML = titles.map(t => `<option value="${esc(t)}">`).join("");
  const names = [...new Set(S.workouts.flatMap(w => (w.exercises || []).map(x => x.name)).filter(Boolean))];
  $("exNames").innerHTML = names.map(t => `<option value="${esc(t)}">`).join("");
}

function resetWoForm() {
  S.woEditing = null; $("woForm").reset(); $("woDate").value = today(); $("exList").innerHTML = "";
  $("woFormTitle").textContent = "Log a workout"; $("woSubmit").textContent = "Save Workout"; $("woClear").hidden = true;
  setKind(S.woKind);
}
$("woClear").onclick = resetWoForm;

function loadWorkout(w, asCopy) {
  resetWoForm();
  S.woEditing = asCopy ? null : w.id;
  $("woDate").value = asCopy ? today() : w.date; $("woTitle").value = w.title || ""; $("woNote").value = asCopy ? "" : (w.note || ""); $("woCal").value = w.cal || "";
  setKind(w.kind || "strength");
  if ((w.kind || "strength") === "strength") {
    $("exList").innerHTML = "";
    (w.exercises || []).forEach(ex => addExercise({ name: ex.name, sets: ex.sets.map(s => ({ r: s.r, w: s.w ? r1(conv(num(s.w), w.u, U())) : "" })) }));
    if (!$("exList").children.length) addExercise();
  } else {
    $("cAct").value = w.activity || "Run"; $("cMin").value = w.min || "";
    $("cDist").value = w.dist ? r1(convD(w.dist, w.du, DU())) : "";
  }
  $("woFormTitle").textContent = asCopy ? "Repeat workout" : "Edit workout";
  $("woSubmit").textContent = asCopy ? "Save Workout" : "Save Changes";
  $("woClear").hidden = false;
  $("woCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("woForm").onsubmit = async e => {
  e.preventDefault();
  const w = { date: $("woDate").value || today(), title: $("woTitle").value.trim(), kind: S.woKind, note: $("woNote").value.trim(), cal: optNum($("woCal").value), u: U(), at: Date.now() };
  if (S.woKind === "strength") {
    w.exercises = [...$("exList").querySelectorAll(".ex")].map(ex => ({
      name: ex.querySelector("[data-name]").value.trim(),
      sets: [...ex.querySelectorAll(".setrow")].map(r => ({ r: num(r.querySelector("[data-r]").value), w: num(r.querySelector("[data-w]").value) })).filter(s => s.r > 0 || s.w > 0),
    })).filter(x => x.name && x.sets.length);
    if (!w.exercises.length) { toast("Add at least one exercise with a set"); return; }
    if (!w.title) w.title = "Strength";
  } else {
    w.activity = $("cAct").value; w.min = optNum($("cMin").value); w.dist = optNum($("cDist").value); w.du = DU();
    if (!w.min && !w.dist) { toast("Add minutes or distance"); return; }
    if (!w.title) w.title = w.activity;
  }
  try {
    if (S.woEditing) await setDoc(sub("workouts", S.woEditing), w);
    else await addDoc(col("workouts"), w);
    toast(S.woEditing ? "Workout updated" : "Workout saved");
    resetWoForm();
  } catch (er) { fail(er); }
};

const vol = w => (w.exercises || []).reduce((s, ex) => s + ex.sets.reduce((a, x) => a + num(x.r) * conv(num(x.w), w.u, U()), 0), 0);
const nSets = w => (w.exercises || []).reduce((s, ex) => s + ex.sets.length, 0);
const ICON_STR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6.7 6v12M17.3 6v12M3.6 9v6M20.4 9v6M6.7 12h10.6"/></svg>';
const ICON_CAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="14" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2v5M6 11l3-3h4l2 3 3 1M11 15l1.5-5"/></svg>';

function woSummary(w) {
  if ((w.kind || "strength") === "strength") {
    const v = vol(w);
    return `${(w.exercises || []).length} exercise${(w.exercises || []).length === 1 ? "" : "s"} · ${nSets(w)} sets${v ? ` · ${fmt(v)} ${U()} lifted` : ""}`;
  }
  const parts = [];
  if (w.min) parts.push(`${fmt(w.min)} min`);
  if (w.dist) parts.push(`${fmt(r1(convD(w.dist, w.du, DU())), 1)} ${DU()}`);
  if (w.min && w.dist) { const pace = w.min / convD(w.dist, w.du, DU()); parts.push(`${Math.floor(pace)}:${String(Math.round((pace % 1) * 60)).padStart(2, "0")} /${DU()}`); }
  return parts.join(" · ");
}

function renderWorkouts() {
  fillTitles();
  const t = today(), ws = weekStart(t);
  const week = S.workouts.filter(w => w.date >= ws && w.date <= t);
  $("woWeek").textContent = week.length;
  $("woSets").textContent = fmt(week.reduce((s, w) => s + nSets(w), 0));
  $("woMin").textContent = fmt(week.reduce((s, w) => s + (w.kind === "cardio" ? num(w.min) : 0), 0));

  // weekly streak: consecutive weeks (ending this week or last) with at least one workout
  const weeks = new Set(S.workouts.map(w => weekStart(w.date)));
  let streak = 0, k = weeks.has(ws) ? ws : addDays(ws, -7);
  while (weeks.has(k)) { streak++; k = addDays(k, -7); }
  $("woStreak").textContent = streak ? `${streak}-week streak` : "Start a streak";

  // 8-week bars
  const W = 600, H = 124, bw = W / 8, wk = [...Array(8)].map((_, i) => addDays(ws, (i - 7) * 7));
  const counts = wk.map(s => S.workouts.filter(w => weekStart(w.date) === s).length);
  const mx = Math.max(4, ...counts);
  $("woChart").innerHTML = wk.map((s, i) => {
    const h = (H - 34) * counts[i] / mx, x = i * bw + bw * .22, w = bw * .56;
    return `${counts[i] ? `<rect x="${x}" y="${H - 20 - h}" width="${w}" height="${h}" rx="6" fill="var(--accent)" opacity="${i === 7 ? 1 : .55}"/><text x="${x + w / 2}" y="${H - 26 - h}" text-anchor="middle" style="fill:var(--ink);font-weight:600">${counts[i]}</text>` : `<rect x="${x}" y="${H - 23}" width="${w}" height="3" rx="1.5" fill="var(--sunk)"/>`}
      <text x="${x + w / 2}" y="${H - 4}" text-anchor="middle">${i === 7 ? "This wk" : short(s)}</text>`;
  }).join("");

  // personal bests: heaviest set per exercise (ties → more reps)
  const best = {};
  for (const w of S.workouts) for (const ex of (w.exercises || [])) for (const s of ex.sets) {
    const kg = conv(num(s.w), w.u, "kg"), key = ex.name.trim().toLowerCase();
    if (!kg) continue;
    const b = best[key];
    if (!b || kg > b.kg + 1e-6 || (Math.abs(kg - b.kg) < 1e-6 && num(s.r) > b.r)) best[key] = { name: ex.name, kg, r: num(s.r), date: w.date };
  }
  const prs = Object.values(best).sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 8);
  $("prCard").hidden = !prs.length;
  $("prList").innerHTML = prs.map(p => { const v = r1(conv(p.kg, "kg", U())); return `<li><div class="grow"><div>${esc(p.name)}</div><div class="sub">${short(p.date)}</div></div><span class="amt">${fmt(v, v % 1 ? 1 : 0)} ${U()} × ${p.r}</span></li>`; }).join("");

  // history grouped by week
  if (!S.workouts.length) { $("woList").innerHTML = `<div class="empty">No workouts yet. Log your first one above.</div>`; return; }
  let html = "", lastWk = "";
  for (const w of S.workouts.slice(0, 60)) {
    const wkS = weekStart(w.date);
    if (wkS !== lastWk) { html += `<div class="weekhead">${wkS === ws ? "This week" : wkS === addDays(ws, -7) ? "Last week" : "Week of " + short(wkS)}</div>`; lastWk = wkS; }
    const isS = (w.kind || "strength") === "strength";
    const body = isS
      ? `<table>${(w.exercises || []).map(ex => `<tr><td>${esc(ex.name)}</td><td>${setsText(ex.sets, w.u)}</td></tr>`).join("")}</table>`
      : `<div>${esc(w.activity || "")} · ${woSummary(w)}</div>`;
    html += `<details class="wo"><summary><span class="icon ${isS ? "" : "cardio"}">${isS ? ICON_STR : ICON_CAR}</span>
      <div class="grow"><div style="font-weight:600">${esc(w.title || (isS ? "Strength" : w.activity))}</div><div class="sub">${parseD(w.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${woSummary(w)}</div></div>
      <svg class="chev" width="9" height="14" viewBox="0 0 9 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1.5 1.5 7 7l-5.5 5.5"/></svg></summary>
      <div class="body">${body}${w.cal ? `<div class="foot">${fmt(w.cal)} calories burned</div>` : ""}${w.note ? `<div class="foot">${esc(w.note)}</div>` : ""}
      <div class="row"><button class="ghost" type="button" data-repeat="${w.id}">Repeat</button><button class="ghost" type="button" data-woedit="${w.id}">Edit</button><button class="ghost destructive" type="button" data-wodel="${w.id}">Delete</button></div></div></details>`;
  }
  $("woList").innerHTML = html;
}
$("woList").onclick = async e => {
  const get = a => S.workouts.find(w => w.id === e.target.closest(`[${a}]`).getAttribute(a));
  if (e.target.closest("[data-repeat]")) loadWorkout(get("data-repeat"), true);
  else if (e.target.closest("[data-woedit]")) loadWorkout(get("data-woedit"), false);
  else if (e.target.closest("[data-wodel]")) {
    const w = get("data-wodel"); if (!w || !confirm(`Delete "${w.title}" from ${short(w.date)}?`)) return;
    try { await deleteDoc(sub("workouts", w.id)); toast("Workout deleted"); if (S.woEditing === w.id) resetWoForm(); } catch (er) { fail(er); }
  }
};

// =====================================================================
// WEIGHT
// =====================================================================
const wIn = x => conv(num(x.w), x.u, U());
const goalW = () => S.set.goalW ? conv(num(S.set.goalW), S.set.goalWu || "lb", U()) : null;
document.querySelectorAll("#wRange button").forEach(b => b.onclick = () => {
  S.range = +b.dataset.range;
  document.querySelectorAll("#wRange button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  renderWeight();
});

function avg7(list) {
  // trailing 7-day average of weigh-ins, by calendar days
  return list.map((x, i) => { let s = 0, n = 0; for (let j = i; j >= 0 && dayDiff(list[j].date, x.date) < 7; j--) { s += wIn(list[j]); n++; } return { date: x.date, v: s / n }; });
}

function renderWeight() {
  const L = S.weights, u = U();
  document.querySelectorAll(".wUnit").forEach(s => s.textContent = u);
  document.querySelectorAll(".distUnit").forEach(s => s.textContent = DU());
  const goal = goalW();
  if (!L.length) {
    $("wNow").innerHTML = `—<small>${u}</small>`; $("wStart").textContent = "—"; $("wChange").textContent = "—";
    $("wToGoal").textContent = goal ? `${fmt(goal, 1)}` : "—"; $("wTrend").textContent = "No weigh-ins yet"; $("wTrend").className = "pill";
    $("wGoalBarWrap").hidden = true;
    $("wChart").innerHTML = `<text x="300" y="110" text-anchor="middle" style="font-size:14px">Log your weight below to start the chart</text>`;
    $("wList").innerHTML = `<li class="empty">No weigh-ins yet.</li>`;
    return;
  }
  const now = wIn(L[L.length - 1]);
  const start = wIn(L[0]);
  $("wNow").innerHTML = `${fmt(now, 1)}<small>${u}</small>`;
  $("wStart").textContent = fmt(start, 1);
  const ch = now - start;
  $("wChange").textContent = (ch > 0 ? "+" : ch < 0 ? "−" : "") + fmt(Math.abs(ch), 1);
  if (goal) {
    const togo = goal - now;
    $("wToGoal").textContent = Math.abs(togo) < .05 ? "There!" : (togo > 0 ? "+" : "−") + fmt(Math.abs(togo), 1);
    const total = Math.abs(goal - start), done = Math.abs(now - start);
    const right = (goal - start) * (now - start) >= 0;
    const pct = total ? Math.max(0, Math.min(100, right ? done / total * 100 : 0)) : 100;
    $("wGoalBar").style.width = pct + "%"; $("wGoalBarWrap").hidden = false;
    $("wGoalText").textContent = `${Math.round(pct)}% of the way from ${fmt(start, 1)} to your goal of ${fmt(goal, 1)} ${u}`;
  } else { $("wToGoal").textContent = "—"; $("wGoalBarWrap").hidden = true; }

  // trend: compare 7-day average now vs ~30 days ago
  const A = avg7(L), last = A[A.length - 1];
  const ref = [...A].reverse().find(a => dayDiff(a.date, last.date) >= 28);
  if (ref) {
    const d = last.v - ref.v, perWk = d / (dayDiff(ref.date, last.date) / 7);
    const losing = goal ? goal < start : true;
    const good = Math.abs(perWk) < .1 ? "" : (perWk < 0) === losing ? "good" : "warn";
    $("wTrend").className = "pill " + good;
    $("wTrend").textContent = Math.abs(perWk) < .1 ? "Steady this month" : `${perWk < 0 ? "↓" : "↑"} ${fmt(Math.abs(perWk), 1)} ${u}/week`;
  } else { $("wTrend").className = "pill"; $("wTrend").textContent = `${L.length} weigh-in${L.length > 1 ? "s" : ""}`; }

  drawWeightChart(L, A, goal);

  // history
  $("wMore").hidden = S.wAll || L.length <= 14;
  $("wList").innerHTML = L.slice().reverse().slice(0, S.wAll ? 1e9 : 14).map((x, i, arr) => {
    const prev = arr[i + 1], v = wIn(x), d = prev ? v - wIn(prev) : null;
    return `<li><div class="grow"><div>${longD(x.date)}</div>${d !== null && Math.abs(d) >= .05 ? `<div class="sub">${d > 0 ? "+" : "−"}${fmt(Math.abs(d), 1)} since ${short(prev.date)}</div>` : ""}</div>
      <span class="amt">${fmt(v, 1)} ${u}</span><button class="x" data-wdel="${x.date}" aria-label="Delete weigh-in on ${short(x.date)}">×</button></li>`;
  }).join("");
}

function drawWeightChart(L, A, goal) {
  const W = 600, H = 220, padL = 46, padR = 8, top = 12, padB = 28;
  const endD = L[L.length - 1].date > today() ? L[L.length - 1].date : today();
  const startD = S.range ? addDays(endD, -S.range) : L[0].date;
  const pts = L.filter(x => x.date >= startD), avg = A.filter(x => x.date >= startD);
  if (!pts.length) { $("wChart").innerHTML = `<text x="300" y="110" text-anchor="middle" style="font-size:14px">No weigh-ins in this range</text>`; return; }
  const span = Math.max(1, dayDiff(S.range ? startD : pts[0].date, endD));
  const x0 = S.range ? startD : pts[0].date;
  const vals = pts.map(wIn).concat(avg.map(a => a.v));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const showGoal = goal && goal >= lo - (hi - lo + 4) && goal <= hi + (hi - lo + 4);
  if (showGoal) { lo = Math.min(lo, goal); hi = Math.max(hi, goal); }
  const pad = Math.max(1, (hi - lo) * .12); lo -= pad; hi += pad;
  const X = d => padL + (W - padL - padR) * dayDiff(x0, d) / span;
  const Y = v => top + (H - top - padB) * (1 - (v - lo) / (hi - lo));
  let s = "";
  for (let i = 0; i <= 3; i++) {
    const v = lo + (hi - lo) * i / 3;
    s += `<line x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width=".7"/><text x="${padL - 6}" y="${Y(v) + 4}" text-anchor="end">${fmt(v, 0)}</text>`;
  }
  if (showGoal) s += `<line x1="${padL}" x2="${W - padR}" y1="${Y(goal)}" y2="${Y(goal)}" stroke="var(--good)" stroke-width="1.6" stroke-dasharray="5 5"/>`;
  $("wGoalLegend").hidden = !showGoal;
  s += pts.map(x => `<circle cx="${X(x.date)}" cy="${Y(wIn(x))}" r="3" fill="var(--faint)"><title>${short(x.date)}: ${fmt(wIn(x), 1)}</title></circle>`).join("");
  if (avg.length > 1) s += `<path d="${avg.map((a, i) => `${i ? "L" : "M"}${X(a.date).toFixed(1)} ${Y(a.v).toFixed(1)}`).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
  const la = avg[avg.length - 1];
  s += `<circle cx="${X(la.date)}" cy="${Y(la.v)}" r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>`;
  s += `<text x="${padL}" y="${H - 4}">${short(x0)}</text><text x="${W - padR}" y="${H - 4}" text-anchor="end">${short(endD)}</text>`;
  $("wChart").innerHTML = s;
}

$("wDate").value = today();
$("wMore").onclick = () => { S.wAll = true; renderWeight(); };
$("wForm").onsubmit = async e => {
  e.preventDefault();
  const w = num($("wVal").value), d = $("wDate").value || today();
  if (!w) return;
  try { await setDoc(sub("weights", d), { w, u: U() }); $("wVal").value = ""; $("wDate").value = today();
$("wMore").onclick = () => { S.wAll = true; renderWeight(); }; toast("Weight saved"); } catch (er) { fail(er); }
};
$("wList").onclick = async e => {
  const b = e.target.closest("[data-wdel]"); if (!b || !confirm(`Delete the weigh-in from ${short(b.dataset.wdel)}?`)) return;
  try { await deleteDoc(sub("weights", b.dataset.wdel)); toast("Deleted"); } catch (er) { fail(er); }
};


// =====================================================================
// STEPS (typed in, or sent from Apple Health by an iPhone Shortcut)
// =====================================================================
const atMs = v => v && v.at ? (new Date(v.at).getTime() || 0) : 0;
// The Shortcut may send "6843", "6,843" or "6843 steps"; keep just the number.
const stepNum = v => typeof v === "number" ? v : num(String(v ?? "").replace(/[^0-9.]/g, ""));
const stepsOn = d => S.steps[d] ? Math.round(stepNum(S.steps[d].n)) : 0;
function renderSteps() {
  const d = S.day, goal = num(S.set.steps) || 10000, n = stepsOn(d), rec = S.steps[d];
  $("stepNow").textContent = fmt(n);
  $("stepBar").style.width = Math.min(100, n / goal * 100) + "%";
  $("stepGoalText").textContent = n >= goal ? `Goal reached · ${fmt(goal)}` : `${fmt(goal - n)} to go · goal ${fmt(goal)}`;
  $("stepSrc").className = "pill" + (rec && rec.src === "health" ? " good" : "");
  $("stepSrc").textContent = !rec ? "No steps yet" : rec.src === "health" ? (atMs(rec) ? `Health · ${new Date(atMs(rec)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "From Health") : "Typed in";
  $("stepIn").placeholder = n ? "Change steps for this day" : "Enter steps for this day";

  const days = [...Array(7)].map((_, i) => addDays(d, i - 6)), vals = days.map(stepsOn);
  const W = 600, H = 124, bw = W / 7, mx = Math.max(goal * 1.15, ...vals);
  const y = v => 8 + (H - 34) * (1 - v / mx);
  let s = days.map((x, i) => {
    const v = vals[i], bx = i * bw + bw * .2, w = bw * .6;
    return (v ? `<rect x="${bx}" y="${y(v)}" width="${w}" height="${y(0) - y(v)}" rx="6" fill="${v >= goal ? "var(--good)" : "var(--accent)"}" opacity="${x === d ? 1 : .7}"><title>${short(x)}: ${fmt(v)} steps</title></rect>`
      : `<rect x="${bx}" y="${y(0) - 3}" width="${w}" height="3" rx="1.5" fill="var(--sunk)"/>`)
      + `<text x="${bx + w / 2}" y="${H - 4}" text-anchor="middle" ${x === d ? 'style="fill:var(--ink);font-weight:600"' : ""}>${parseD(x).toLocaleDateString("en-US", { weekday: "narrow" })}</text>`;
  }).join("");
  s += `<line x1="0" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" stroke="var(--ink)" stroke-opacity=".35" stroke-dasharray="4 4"/>`;
  $("stepChart").innerHTML = s;
  const logged = vals.filter(v => v > 0);
  $("stepAvg").textContent = logged.length ? fmt(logged.reduce((a, v) => a + v, 0) / logged.length) : "—";
  $("stepHit").textContent = `${vals.filter(v => v >= goal).length} of 7`;
  const best = Object.keys(S.steps).reduce((b, k) => stepsOn(k) > (b ? stepsOn(b) : 0) ? k : b, null);
  $("stepBest").textContent = best ? fmt(stepsOn(best)) : "—";
  $("stepBest").title = best ? short(best) : "";
}
$("stepForm").onsubmit = async e => {
  e.preventDefault();
  const v = optNum($("stepIn").value); if (v === null) return;
  try { await setDoc(sub("steps", S.day), { n: Math.round(v), src: "manual", at: Date.now() }); $("stepIn").value = ""; toast("Steps saved"); } catch (er) { fail(er); }
};

// Apple Health connection info
function renderHK() {
  $("hkKey").textContent = firebaseConfig.apiKey;
  $("hkProj").textContent = firebaseConfig.projectId;
  const last = Object.entries(S.steps).filter(([, v]) => v.src === "health").sort((a, b) => atMs(b[1]) - atMs(a[1]))[0];
  $("hkStatus").className = "pill" + (last ? " good" : "");
  $("hkStatus").textContent = last ? `Last sync ${atMs(last[1]) ? new Date(atMs(last[1])).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : short(last[0])}` : "Not set up";
}
document.querySelectorAll("[data-copy]").forEach(b => b.onclick = async () => {
  const k = b.dataset.copy;
  const text = k === "key" ? firebaseConfig.apiKey : k === "proj" ? firebaseConfig.projectId : (auth.currentUser && auth.currentUser.refreshToken);
  if (!text) { toast("Sign out and back in, then try again"); return; }
  try { await navigator.clipboard.writeText(text); toast("Copied"); }
  catch { prompt("Copy this:", text); }
});

// =====================================================================
// SETTINGS
// =====================================================================
function fillSettings() {
  $("gCal").value = S.set.cal ?? ""; $("gP").value = S.set.p ?? ""; $("gC").value = S.set.c ?? ""; $("gF").value = S.set.f ?? "";
  $("gW").value = goalW() ? r1(goalW()) : ""; $("gSteps").value = S.set.steps || ""; $("gBurn").checked = !!S.set.addBurn;
  document.querySelectorAll("#unitSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.unit === U())));
  $("cHtLabel").hidden = U() === "kg"; $("cCmLabel").hidden = U() !== "kg";
  macroCheck();
}
function macroCheck() {
  const cal = num($("gCal").value), m = num($("gP").value) * 4 + num($("gC").value) * 4 + num($("gF").value) * 9;
  $("macroCheck").textContent = m ? `Your macros add up to ${fmt(m)} calories${cal ? (Math.abs(m - cal) <= cal * .05 ? ", which matches your goal." : ` (goal is ${fmt(cal)}).`) : "."}` : "";
}
["gCal", "gP", "gC", "gF"].forEach(id => $(id).addEventListener("input", macroCheck));
$("goalForm").onsubmit = async e => {
  e.preventDefault();
  await saveSet({ cal: num($("gCal").value), p: num($("gP").value), c: num($("gC").value), f: num($("gF").value), goalW: optNum($("gW").value), goalWu: U(), addBurn: $("gBurn").checked, steps: num($("gSteps").value) || 10000 });
  toast("Goals saved");
};
$("unitSeg").onclick = async e => {
  const b = e.target.closest("[data-unit]"); if (!b || b.dataset.unit === U()) return;
  const to = b.dataset.unit, from = U();
  await saveSet({ unit: to }); resetWoForm(); toast(to === "kg" ? "Using kilograms" : "Using pounds");
};

// goal calculator
let sex = "m";
$("cSex").onclick = e => { const b = e.target.closest("[data-sex]"); if (!b) return; sex = b.dataset.sex; document.querySelectorAll("#cSex button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); };
$("calcToggle").onclick = () => { const h = $("calcBox").hidden; $("calcBox").hidden = !h; $("calcToggle").textContent = h ? "Close" : "Open"; };
let calcWTyped = false;
$("cWeight").addEventListener("input", () => calcWTyped = true);
function renderCalc() { if (!calcWTyped && S.weights.length) $("cWeight").value = r1(wIn(S.weights[S.weights.length - 1])); }
$("calcRun").onclick = () => {
  const age = num($("cAge").value), wt = num($("cWeight").value);
  const cm = U() === "kg" ? num($("cCm").value) : (num($("cFt").value) * 12 + num($("cIn").value)) * 2.54;
  if (!age || !wt || !cm) { toast("Fill in age, weight and height"); return; }
  const kg = conv(wt, U(), "kg"), lb = conv(wt, U(), "lb");
  const bmr = 10 * kg + 6.25 * cm - 5 * age + (sex === "m" ? 5 : -161);
  const tdee = bmr * num($("cActv").value);
  const floor = sex === "m" ? 1500 : 1200;
  let cal = Math.round((tdee + num($("cPace").value)) / 10) * 10;
  const floored = cal < floor; if (floored) cal = floor;
  const p = Math.round(lb * (num($("cPace").value) < 0 ? 0.9 : 0.8));
  const f = Math.round(cal * 0.27 / 9);
  const c = Math.max(0, Math.round((cal - p * 4 - f * 9) / 4));
  $("calcOut").hidden = false;
  $("calcOut").innerHTML = `<div>You burn about <b>${fmt(Math.round(tdee / 10) * 10)}</b> calories a day. Suggested goal: <b>${fmt(cal)} cal</b> · ${p}g protein · ${c}g carbs · ${f}g fat.</div>
    ${floored ? `<div class="foot" style="margin-top:6px">Raised to ${fmt(floor)}, the usual minimum without a doctor's guidance.</div>` : ""}
    <button class="primary" type="button" id="calcUse" style="margin-top:10px;width:100%">Use These Goals</button>`;
  $("calcUse").onclick = async () => {
    await saveSet({ cal, p, c, f });
    toast("Goals updated"); $("calcBox").hidden = true; $("calcToggle").textContent = "Open";
  };
};

// backup
$("exportBtn").onclick = () => {
  const data = { app: "fitness-log", version: 1, exported: new Date().toISOString(), settings: S.set, days: S.days, steps: S.steps, weights: S.weights, workouts: S.workouts, library: S.lib };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
  a.download = `fitness-backup-${today()}.json`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
$("importBtn").onclick = () => $("importFile").click();
$("importFile").onchange = async () => {
  const f = $("importFile").files[0]; $("importFile").value = ""; if (!f) return;
  let data; try { data = JSON.parse(await f.text()); } catch { toast("That file isn't a backup"); return; }
  if (data.app !== "fitness-log") { toast("That file isn't a Fitness Log backup"); return; }
  if (!confirm("Restore this backup? Entries with the same day or workout are replaced; everything else stays.")) return;
  try {
    const ops = [];
    if (data.settings) ops.push([userDoc(), data.settings]);
    for (const [d, v] of Object.entries(data.days || {})) ops.push([sub("days", d), v]);
    for (const w of data.weights || []) { const { date, ...rest } = w; ops.push([sub("weights", date), rest]); }
    for (const w of data.workouts || []) { const { id, ...rest } = w; ops.push([sub("workouts", id || uid8()), rest]); }
    for (const [d, v] of Object.entries(data.steps || {})) ops.push([sub("steps", d), v]);
    if (data.library) ops.push([sub("meta", "library"), { items: data.library }]);
    for (let i = 0; i < ops.length; i += 400) {
      const b = writeBatch(db); ops.slice(i, i + 400).forEach(([ref, v]) => b.set(ref, v)); await b.commit();
    }
    toast("Backup restored");
  } catch (er) { fail(er); }
};

// init
resetWoForm();
