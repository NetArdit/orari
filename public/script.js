/* ==========================================
   STUDYFLOW
   FRONTEND APPLICATION
========================================== */


/* ==========================================
   STORAGE
========================================== */

const USERS_KEY = "studyflow_users";
const CURRENT_USER_KEY = "studyflow_current_user";


function getUsers() {

    return JSON.parse(
        localStorage.getItem(USERS_KEY)
    ) || [];
}


function saveUsers(users) {

    localStorage.setItem(
        USERS_KEY,
        JSON.stringify(users)
    );
}


function getCurrentUser() {

    return JSON.parse(
        localStorage.getItem(
            CURRENT_USER_KEY
        )
    );
}


function saveCurrentUser(user) {

    localStorage.setItem(
        CURRENT_USER_KEY,
        JSON.stringify(user)
    );
}


function logout() {

    localStorage.removeItem(
        CURRENT_USER_KEY
    );

    location.reload();
}


// Persist a mutated user object back into both the users list and
// "current user" pointer, keeping them in sync.
function persistUser(user) {

    const users = getUsers();

    const index = users.findIndex(
        item => item.id === user.id
    );

    if (index === -1) return;

    users[index] = user;

    saveUsers(users);
    saveCurrentUser(user);
}


/* ==========================================
   AUTH ELEMENTS
========================================== */

const authScreen = document.getElementById("authScreen");
const app = document.getElementById("app");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const showRegister = document.getElementById("showRegister");
const showLogin = document.getElementById("showLogin");
const authError = document.getElementById("authError");


/* ==========================================
   AUTH SWITCH
========================================== */

showRegister.addEventListener("click", () => {

    loginForm.classList.add("hidden");
    showRegister.classList.add("hidden");
    registerForm.classList.remove("hidden");
    showLogin.classList.remove("hidden");
    authError.textContent = "";
});


showLogin.addEventListener("click", () => {

    registerForm.classList.add("hidden");
    showLogin.classList.add("hidden");
    loginForm.classList.remove("hidden");
    showRegister.classList.remove("hidden");
    authError.textContent = "";
});


/* ==========================================
   REGISTER
========================================== */

registerForm.addEventListener("submit", function (event) {

    event.preventDefault();

    const name = document.getElementById("registerName").value.trim();
    const email = document.getElementById("registerEmail").value.trim().toLowerCase();
    const password = document.getElementById("registerPassword").value;
    const educationLevel = document.getElementById("registerEducation").value;
    const school = document.getElementById("registerSchool").value.trim();

    const users = getUsers();

    const exists = users.some(user => user.email === email);

    if (exists) {
        showAuthError("Kjo email tashmë ekziston.");
        return;
    }

    const user = {
        id: crypto.randomUUID(),
        name,
        email,
        password,
        educationLevel,
        school,
        plans: [],
        createdAt: new Date().toISOString()
    };

    users.push(user);
    saveUsers(users);
    saveCurrentUser(user);
    openApp(user);
});


/* ==========================================
   LOGIN
========================================== */

loginForm.addEventListener("submit", function (event) {

    event.preventDefault();

    const email = document.getElementById("loginEmail").value.trim().toLowerCase();
    const password = document.getElementById("loginPassword").value;

    const users = getUsers();

    const user = users.find(
        item => item.email === email && item.password === password
    );

    if (!user) {
        showAuthError("Email ose password i gabuar.");
        return;
    }

    saveCurrentUser(user);
    openApp(user);
});


function showAuthError(message) {
    authError.textContent = message;
}


/* ==========================================
   OPEN APP
========================================== */

function openApp(user) {

    authScreen.classList.add("hidden");
    app.classList.remove("hidden");

    updateUserUI(user);
    buildAvailabilityGrid();
    renderCommitmentRows();
    refreshDashboard();
    showPage("dashboard");
}


function updateUserUI(user) {

    const firstLetter = user.name.charAt(0).toUpperCase();

    document.getElementById("userName").textContent = user.name;
    document.getElementById("userAvatar").textContent = firstLetter;
    document.getElementById("welcomeName").textContent = user.name;
    document.getElementById("profileName").textContent = user.name;
    document.getElementById("profileEmail").textContent = user.email;
    document.getElementById("profileAvatar").textContent = firstLetter;
    document.getElementById("profileEducation").textContent = educationLabel(user.educationLevel);
    document.getElementById("profileSchool").textContent = user.school || "Nuk është specifikuar";
}


function educationLabel(level) {

    const labels = {
        elementary: "Shkollë fillore",
        highschool: "Shkollë e mesme",
        university: "Universitet",
        other: "Nivel tjetër"
    };

    return labels[level] || level;
}


/* ==========================================
   NAVIGATION
========================================== */

const navItems = document.querySelectorAll(".nav-item");

navItems.forEach(item => {
    item.addEventListener("click", () => showPage(item.dataset.page));
});


function showPage(page) {

    document.querySelectorAll(".page").forEach(
        pageElement => pageElement.classList.remove("active")
    );

    const selected = document.getElementById(`${page}Page`);
    if (selected) selected.classList.add("active");

    navItems.forEach(item => {
        item.classList.toggle("active", item.dataset.page === page);
    });

    const titles = {
        dashboard: "Dashboard",
        planner: "Krijo plan",
        plans: "Planet",
        profile: "Profili"
    };

    document.getElementById("pageTitle").textContent = titles[page];

    if (page === "plans") renderAllPlans();
    if (page === "dashboard") refreshDashboard();
}


document.getElementById("dashboardCreate").addEventListener("click", () => showPage("planner"));
document.getElementById("logoutButton").addEventListener("click", logout);


/* ==========================================
   DATE / TIME HELPERS (client-side, no AI)
========================================== */

const WEEKDAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAY_LABELS = {
    mon: "E hënë", tue: "E martë", wed: "E mërkurë", thu: "E enjte",
    fri: "E premte", sat: "E shtunë", sun: "E diel"
};

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateHuman(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const weekday = WEEKDAY_LABELS[WEEKDAY_ORDER[(date.getUTCDay() + 6) % 7]];
    const months = ["Jan", "Shk", "Mar", "Pri", "Maj", "Qer", "Kor", "Gus", "Sht", "Tet", "Nën", "Dhj"];
    return `${weekday}, ${d} ${months[m - 1]}`;
}

function parseWindowsString(text) {
    // "08:00-10:00, 20:00-21:30" -> [{start,end}]
    if (!text || !text.trim()) return [];
    const timeRe = /^([01]?\d|2[0-3]):([0-5]\d)$/;

    return text.split(",")
        .map(chunk => chunk.trim())
        .filter(Boolean)
        .map(chunk => {
            const [start, end] = chunk.split("-").map(s => s.trim());
            return { start, end };
        })
        .filter(w => w.start && w.end && timeRe.test(w.start) && timeRe.test(w.end));
}


/* ==========================================
   PLANNER MODE TOGGLE
========================================== */

document.getElementById("modeToggleAi").addEventListener("click", () => switchPlannerMode("ai"));
document.getElementById("modeToggleForm").addEventListener("click", () => switchPlannerMode("form"));

function switchPlannerMode(mode) {

    document.getElementById("modeToggleAi").classList.toggle("active", mode === "ai");
    document.getElementById("modeToggleForm").classList.toggle("active", mode === "form");
    document.getElementById("modeAi").classList.toggle("active", mode === "ai");
    document.getElementById("modeForm").classList.toggle("active", mode === "form");
}


/* ==========================================
   GUIDED FORM: AVAILABILITY GRID
========================================== */

function buildAvailabilityGrid() {

    const grid = document.getElementById("availabilityGrid");
    grid.innerHTML = "";

    WEEKDAY_ORDER.forEach(day => {

        const row = document.createElement("div");
        row.className = "availability-row";
        row.dataset.day = day;

        row.innerHTML = `
            <span class="day-label">${WEEKDAY_LABELS[day]}</span>
            <input type="text" class="avail-windows" placeholder="p.sh. 08:00-10:00, 20:00-21:00">
            <label class="off-toggle">
                <input type="checkbox" class="avail-off">
                Off
            </label>
        `;

        grid.appendChild(row);
    });
}


function collectWeeklyAvailability() {

    const rows = document.querySelectorAll("#availabilityGrid .availability-row");
    const result = [];

    rows.forEach(row => {

        const day = row.dataset.day;
        const off = row.querySelector(".avail-off").checked;
        const windows = parseWindowsString(row.querySelector(".avail-windows").value);

        if (off || windows.length > 0) {
            result.push({ day, off, windows });
        }
    });

    return result;
}


/* ==========================================
   GUIDED FORM: COMMITMENTS
========================================== */

const COMMITMENT_TYPE_LABELS = {
    work: "Punë", school: "Shkollë", commute: "Rrugë/komutim", meal: "Ushqim",
    sleep: "Gjumë", family: "Familje", gym: "Palestër", other: "Tjetër"
};

function renderCommitmentRows(prefill) {

    const list = document.getElementById("commitmentsList");
    list.innerHTML = "";

    const rows = prefill && prefill.length ? prefill : [
        { label: "Punë/Shkollë", type: "work", start: "09:00", end: "17:00" }
    ];

    rows.forEach(c => addCommitmentRow(c));
}

function addCommitmentRow(prefill) {

    const list = document.getElementById("commitmentsList");
    const row = document.createElement("div");
    row.className = "commitment-row";

    const typeOptions = Object.entries(COMMITMENT_TYPE_LABELS)
        .map(([value, label]) => `<option value="${value}" ${prefill?.type === value ? "selected" : ""}>${label}</option>`)
        .join("");

    row.innerHTML = `
        <input type="text" class="c-label" placeholder="Emri (p.sh. Puna)" value="${safe(prefill?.label || "")}">
        <select class="c-type">${typeOptions}</select>
        <input type="text" class="c-days" placeholder="mon,tue,wed (bosh = çdo ditë)" value="${safe((prefill?.days || []).join(","))}">
        <input type="time" class="c-start" value="${prefill?.start || ""}">
        <input type="time" class="c-end" value="${prefill?.end || ""}">
        <button type="button" class="remove-row">✕</button>
    `;

    row.querySelector(".remove-row").addEventListener("click", () => row.remove());
    list.appendChild(row);
}

document.getElementById("addCommitmentButton").addEventListener("click", () => addCommitmentRow());


function collectCommitments() {

    const rows = document.querySelectorAll("#commitmentsList .commitment-row");
    const result = [];

    rows.forEach(row => {

        const label = row.querySelector(".c-label").value.trim();
        const start = row.querySelector(".c-start").value;
        const end = row.querySelector(".c-end").value;

        if (!label || !start || !end) return;

        const daysRaw = row.querySelector(".c-days").value.trim();
        const days = daysRaw
            ? daysRaw.split(",").map(d => d.trim().toLowerCase()).filter(d => WEEKDAY_ORDER.includes(d))
            : null;

        result.push({
            label,
            type: row.querySelector(".c-type").value,
            days: days && days.length ? days : null,
            dates: null,
            start,
            end
        });
    });

    return result;
}


/* ==========================================
   GUIDED FORM SUBMIT
========================================== */

document.getElementById("plannerForm").addEventListener("submit", async function (event) {

    event.preventDefault();

    const user = getCurrentUser();
    if (!user) return;

    const structured = {
        startDate: document.getElementById("f_startDate").value,
        endDate: document.getElementById("f_endDate").value,
        subject: document.getElementById("f_subject").value.trim(),
        materialAmount: document.getElementById("f_material").value.trim() || null,
        goal: document.getElementById("f_material").value.trim() || null,
        planMode: document.getElementById("f_planMode").value,
        weeklyAvailability: collectWeeklyAvailability(),
        commitments: collectCommitments(),
        unavailableDates: [],
        sessionPreferenceMinutes: Number(document.getElementById("f_sessionLength").value) || null,
        energy: {
            morning: document.getElementById("f_energyMorning").value || null,
            afternoon: document.getElementById("f_energyAfternoon").value || null,
            evening: document.getElementById("f_energyEvening").value || null
        },
        difficulty: document.getElementById("f_difficulty").value
    };

    await submitCreatePlan(user, structured, {
        button: document.getElementById("createPlanButton"),
        buttonText: document.getElementById("createPlanText"),
        defaultLabel: "Krijo plan me AI"
    });
});


/* ==========================================
   NATURAL LANGUAGE FLOW
========================================== */

let lastParsedStructured = null;

document.getElementById("parseButton").addEventListener("click", async () => {

    const text = document.getElementById("nlInput").value.trim();
    const errorBox = document.getElementById("nlError");
    const button = document.getElementById("parseButton");
    const buttonText = document.getElementById("parseButtonText");

    errorBox.classList.add("hidden");
    document.getElementById("clarifyPanel").classList.add("hidden");
    document.getElementById("confirmPanel").classList.add("hidden");

    if (text.length < 3) {
        errorBox.textContent = "Shkruaj një përshkrim më të plotë.";
        errorBox.classList.remove("hidden");
        return;
    }

    button.disabled = true;
    buttonText.textContent = "AI po e analizon...";

    try {

        const response = await fetch("/api/parse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                text,
                // "Today" and "tomorrow" must mean the user's day, not the server's.
                clientDate: todayStr(),
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "Ndodhi një gabim.");
        }

        const parsed = result.parsed;

        if (parsed.clarifyingQuestions && parsed.clarifyingQuestions.length > 0 &&
            !parsed.startDate && !parsed.endDate) {

            const list = document.getElementById("clarifyList");
            list.innerHTML = parsed.clarifyingQuestions.map(q => `<li>${safe(q)}</li>`).join("");
            document.getElementById("clarifyPanel").classList.remove("hidden");
            return;
        }

        showConfirmPanel(parsed);

    } catch (error) {

        errorBox.textContent = error.message;
        errorBox.classList.remove("hidden");

    } finally {

        button.disabled = false;
        buttonText.textContent = "Krijo planin";
    }
});


function showConfirmPanel(parsed) {

    lastParsedStructured = parsed;

    document.getElementById("confirmSubject").value = parsed.subject || "";
    document.getElementById("confirmPlanMode").value = parsed.planMode || "general";
    document.getElementById("confirmStartDate").value = parsed.startDate || "";
    document.getElementById("confirmEndDate").value = parsed.endDate || "";
    document.getElementById("confirmDifficulty").value = parsed.difficulty || "medium";
    document.getElementById("confirmSessionLength").value = parsed.sessionPreferenceMinutes || "";
    document.getElementById("confirmGoal").value = parsed.goal || parsed.materialAmount || "";

    const summaryParts = [];

    if (parsed.weeklyAvailability && parsed.weeklyAvailability.length > 0) {
        const availLines = parsed.weeklyAvailability.map(d => {
            if (d.off) return `${WEEKDAY_LABELS[d.day]}: pushim`;
            return `${WEEKDAY_LABELS[d.day]}: ${d.windows.map(w => `${w.start}-${w.end}`).join(", ")}`;
        });
        summaryParts.push(`<strong>Disponueshmëria:</strong><br>${availLines.join("<br>")}`);
    }

    if (parsed.commitments && parsed.commitments.length > 0) {
        const commLines = parsed.commitments.map(c => {
            const days = c.days && c.days.length ? c.days.map(d => WEEKDAY_LABELS[d]).join(", ") : "çdo ditë";
            return `${c.label} (${COMMITMENT_TYPE_LABELS[c.type] || c.type}): ${c.start}-${c.end}, ${days}`;
        });
        summaryParts.push(`<strong>Angazhimet:</strong><br>${commLines.join("<br>")}`);
    }

    if (parsed.energy) {
        const e = parsed.energy;
        if (e.morning || e.afternoon || e.evening) {
            summaryParts.push(`<strong>Energjia:</strong> mëngjes ${e.morning || "—"}, pasdite ${e.afternoon || "—"}, mbrëmje ${e.evening || "—"}`);
        }
    }

    document.getElementById("confirmSummary").innerHTML = summaryParts.length
        ? summaryParts.join("<br><br>")
        : "<em>AI nuk gjeti disponueshmëri apo angazhime specifike - do të përdorë orar të balancuar 06:00-23:30.</em>";

    document.getElementById("confirmPanel").classList.remove("hidden");
    document.getElementById("confirmPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}


document.getElementById("confirmBackButton").addEventListener("click", () => {
    document.getElementById("confirmPanel").classList.add("hidden");
    document.getElementById("nlInput").focus();
});


document.getElementById("confirmCreateButton").addEventListener("click", async () => {

    const user = getCurrentUser();
    if (!user || !lastParsedStructured) return;

    const startDate = document.getElementById("confirmStartDate").value;
    const endDate = document.getElementById("confirmEndDate").value;
    const subject = document.getElementById("confirmSubject").value.trim();

    if (!startDate || !endDate || !subject) {
        alert("Data e fillimit, data e mbarimit dhe lënda janë të detyrueshme.");
        return;
    }

    const structured = {
        startDate,
        endDate,
        subject,
        materialAmount: lastParsedStructured.materialAmount || null,
        goal: document.getElementById("confirmGoal").value.trim() || null,
        planMode: document.getElementById("confirmPlanMode").value,
        weeklyAvailability: lastParsedStructured.weeklyAvailability || [],
        commitments: lastParsedStructured.commitments || [],
        unavailableDates: [],
        sessionPreferenceMinutes: Number(document.getElementById("confirmSessionLength").value) || null,
        energy: lastParsedStructured.energy || null,
        difficulty: document.getElementById("confirmDifficulty").value
    };

    await submitCreatePlan(user, structured, {
        button: document.getElementById("confirmCreateButton"),
        buttonText: document.getElementById("confirmCreateText"),
        defaultLabel: "Konfirmo planin"
    });
});


/* ==========================================
   SHARED: CREATE PLAN CALL
========================================== */

async function submitCreatePlan(user, structured, ui) {

    ui.button.disabled = true;
    ui.buttonText.textContent = "AI po e ndërton planin...";

    try {

        const response = await fetch("/api/create-plan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                profile: { name: user.name, educationLevel: user.educationLevel },
                structured
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "Ndodhi një gabim.");
        }

        const savedPlan = savePlan(result, structured);
        renderAIPlan(savedPlan);
        refreshDashboard();

    } catch (error) {

        alert(error.message);

    } finally {

        ui.button.disabled = false;
        ui.buttonText.textContent = ui.defaultLabel;
    }
}


/* ==========================================
   SAVE / LOAD PLANS
========================================== */

function savePlan(planResponse, structured) {

    const freshUser = getCurrentUser();

    const savedPlan = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        structured,
        ...planResponse,
        sessions: planResponse.sessions.map(s => ({ ...s, status: s.status || "pending" }))
    };

    freshUser.plans = freshUser.plans || [];
    freshUser.plans.push(savedPlan);

    persistUser(freshUser);

    return savedPlan;
}


function findPlan(planId) {
    const user = getCurrentUser();
    return (user.plans || []).find(p => p.id === planId);
}


function updateSessionStatus(planId, sessionId, status) {

    const user = getCurrentUser();
    const plan = (user.plans || []).find(p => p.id === planId);
    if (!plan) return;

    const session = plan.sessions.find(s => s.id === sessionId);
    if (!session) return;

    session.status = session.status === status ? "pending" : status;

    persistUser(user);
    refreshDashboard();
}


/* ==========================================
   RENDER: SCHEDULE / SESSION CARDS
========================================== */

const SESSION_TYPE_LABELS = {
    learning: "Mësim", practice: "Praktikë", recall: "Rikujtim",
    revision: "Përsëritje", assessment: "Vlerësim", project: "Projekt"
};

const DIFFICULTY_LABELS = { easy: "E lehtë", medium: "Mesatare", hard: "E vështirë" };

function renderAIPlan(plan) {

    const result = document.getElementById("aiResult");

    document.getElementById("resultSubjectTitle").textContent = `Orari yt - ${plan.subject}`;

    document.getElementById("resultStats").innerHTML = `
        <div><strong>${plan.sessions.length}</strong>sesione</div>
        <div><strong>${plan.stats.totalHours}h</strong>gjithsej</div>
        <div><strong>${formatDateHuman(plan.startDate)}</strong>fillimi</div>
        <div><strong>${formatDateHuman(plan.endDate)}</strong>mbarimi</div>
    `;

    const strategyBox = document.getElementById("strategyBox");
    let strategyHtml = safe(plan.strategy || "");
    if (plan.explanations && plan.explanations.length) {
        strategyHtml += `<ul>${plan.explanations.map(e => `<li>${safe(e)}</li>`).join("")}</ul>`;
    }
    strategyBox.innerHTML = strategyHtml;
    strategyBox.style.display = strategyHtml ? "block" : "none";

    const warningsBox = document.getElementById("warningsBox");
    if (plan.warnings && plan.warnings.length) {
        warningsBox.innerHTML = plan.warnings.map(w => `⚠ ${safe(w)}`).join("<br>");
        warningsBox.classList.remove("hidden");
    } else {
        warningsBox.classList.add("hidden");
    }

    renderScheduleList(document.getElementById("schedule"), plan);

    result.classList.remove("hidden");
    result.scrollIntoView({ behavior: "smooth" });
}


function renderScheduleList(container, plan) {

    container.innerHTML = "";

    const sessionsByDate = {};
    plan.sessions.forEach(s => {
        (sessionsByDate[s.date] = sessionsByDate[s.date] || []).push(s);
    });

    Object.keys(sessionsByDate).sort().forEach(date => {

        const heading = document.createElement("div");
        heading.className = "schedule-date-heading";
        heading.textContent = formatDateHuman(date);
        container.appendChild(heading);

        sessionsByDate[date]
            .sort((a, b) => a.startTime.localeCompare(b.startTime))
            .forEach(session => container.appendChild(createSessionCard(plan.id, session)));
    });
}


function createSessionCard(planId, session) {

    const card = document.createElement("article");
    card.className = "schedule-card";

    const tasks = (session.tasks || []).map(t => `<li>${safe(t)}</li>`).join("");
    const typeClass = `badge-${session.type}`;

    card.innerHTML = `
        <div class="schedule-head">
            <span class="session-type-badge ${typeClass}">${SESSION_TYPE_LABELS[session.type] || session.type}</span>
            <span class="schedule-time">${safe(session.startTime)} – ${safe(session.endTime)}</span>
        </div>

        <div class="schedule-title">${safe(session.title)}</div>

        ${session.goal ? `<div class="session-goal">${safe(session.goal)}</div>` : ""}

        ${session.material ? `<div class="schedule-material">Materiali: ${safe(session.material)}</div>` : ""}

        ${tasks ? `<ul class="schedule-tasks">${tasks}</ul>` : ""}

        <div class="session-footer">
            <span class="session-difficulty">Vështirësia: ${DIFFICULTY_LABELS[session.difficulty] || session.difficulty}</span>
            <div class="session-status-buttons">
                <button type="button" class="status-btn done" data-status="completed">✓ Kryer</button>
                <button type="button" class="status-btn partial" data-status="partial">◐ Pjesërisht</button>
                <button type="button" class="status-btn skipped" data-status="skipped">✕ Anashkaluar</button>
            </div>
        </div>
    `;

    card.querySelectorAll(".status-btn").forEach(btn => {
        if (session.status === btn.dataset.status) btn.classList.add("selected");

        btn.addEventListener("click", () => {
            updateSessionStatus(planId, session.id, btn.dataset.status);
            const updated = findPlan(planId).sessions.find(s => s.id === session.id);
            card.querySelectorAll(".status-btn").forEach(b => b.classList.toggle("selected", b.dataset.status === updated.status));
        });
    });

    return card;
}


/* ==========================================
   DASHBOARD
========================================== */

function refreshDashboard() {

    const user = getCurrentUser();
    if (!user) return;

    const plans = user.plans || [];
    const today = todayStr();

    const allSessions = plans.flatMap(p => p.sessions.map(s => ({ ...s, planId: p.id, subject: p.subject })));

    let completed = 0, missed = 0, minutes = 0;
    const completedDates = new Set();

    allSessions.forEach(s => {

        const duration = timeDiffMinutes(s.startTime, s.endTime);

        if (s.status === "completed") {
            completed++;
            minutes += duration;
            completedDates.add(s.date);
        } else if (s.status === "partial") {
            completed++;
            minutes += Math.round(duration / 2);
            completedDates.add(s.date);
        } else if (s.status === "skipped" || (s.status === "pending" && s.date < today)) {
            missed++;
        }
    });

    document.getElementById("totalPlans").textContent = plans.length;
    document.getElementById("completedSessions").textContent = completed;
    document.getElementById("missedSessions").textContent = missed;
    document.getElementById("totalHours").textContent = (minutes / 60).toFixed(1);
    document.getElementById("studyStreak").textContent = computeStreak(completedDates, today);

    renderTodaySessions(allSessions.filter(s => s.date === today));
    renderNextSession(allSessions, today);
    renderPlanHealth(plans, today);
    renderRecentPlans(plans);
}


function timeDiffMinutes(start, end) {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
}


function computeStreak(completedDates, today) {

    let streak = 0;
    let cursor = new Date(today + "T00:00:00Z");

    // A streak counts consecutive days (ending today or yesterday) with
    // at least one completed/partial session.
    if (!completedDates.has(today)) {
        cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    let guard = 0;
    while (guard < 400) {
        const dateStr = cursor.toISOString().slice(0, 10);
        if (!completedDates.has(dateStr)) break;
        streak++;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
        guard++;
    }

    return streak;
}


function renderTodaySessions(sessions) {

    const container = document.getElementById("todaySessions");

    if (!sessions.length) {
        container.innerHTML = `<p class="empty-inline">Nuk ke sesione të planifikuara sot.</p>`;
        return;
    }

    container.innerHTML = "";

    sessions
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .forEach(s => {
            const row = document.createElement("div");
            row.className = "mini-session";
            row.innerHTML = `
                <span>${safe(s.title)}</span>
                <span class="mini-session-time">${safe(s.startTime)}–${safe(s.endTime)}</span>
            `;
            container.appendChild(row);
        });
}


function renderNextSession(allSessions, today) {

    const box = document.getElementById("nextSession");
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const upcoming = allSessions
        .filter(s => s.status === "pending")
        .filter(s => s.date > today || (s.date === today && timeToMinutes(s.startTime) >= nowMinutes))
        .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))[0];

    if (!upcoming) {
        box.innerHTML = "Nuk ka sesione të ardhshme. Krijo një plan të ri!";
        return;
    }

    box.innerHTML = `
        <strong>${safe(upcoming.title)}</strong><br>
        ${formatDateHuman(upcoming.date)} · ${safe(upcoming.startTime)}–${safe(upcoming.endTime)}<br>
        ${safe(upcoming.subject)}
    `;
}


function timeToMinutes(t) {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
}


function renderPlanHealth(plans, today) {

    const panel = document.getElementById("planHealthPanel");

    const activePlan = plans
        .filter(p => p.endDate >= today)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

    if (!activePlan) {
        panel.classList.add("hidden");
        return;
    }

    const missedCount = activePlan.sessions.filter(
        s => s.status === "pending" && s.date < today
    ).length;

    if (missedCount === 0) {
        panel.classList.add("hidden");
        return;
    }

    document.getElementById("planHealthText").textContent =
        `Ke ${missedCount} sesion${missedCount > 1 ? "e" : ""} të humbura te "${activePlan.subject}". AI mund ta rregullojë pjesën e mbetur të planit.`;

    panel.classList.remove("hidden");
    panel.dataset.planId = activePlan.id;
}


document.getElementById("adjustPlanButton").addEventListener("click", async () => {

    const planId = document.getElementById("planHealthPanel").dataset.planId;

    // The plan must be the one inside the user object that gets saved below.
    // Looking it up separately gives a second copy, and changes to it are lost.
    const user = getCurrentUser();
    const plan = (user?.plans || []).find(p => p.id === planId);
    if (!plan) return;

    const button = document.getElementById("adjustPlanButton");
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Duke rregulluar...";

    const today = todayStr();

    const completedSessionSummaries = plan.sessions
        .filter(s => s.status === "completed" || s.status === "partial")
        .map(s => `${s.date} ${s.title} (${s.status})`);

    const missedSessionSummaries = plan.sessions
        .filter(s => (s.status === "pending" && s.date < today) || s.status === "skipped")
        .map(s => `${s.date} ${s.title}`);

    try {

        const response = await fetch("/api/adjust-plan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                profile: { name: user.name, educationLevel: user.educationLevel },
                structured: plan.structured,
                progress: {
                    today,
                    // Only the rest of today is free: without this, new sessions could be placed in hours already gone.
                    now: new Date().toTimeString().slice(0, 5),
                    completedSessionSummaries,
                    missedSessionSummaries,
                    remainingMaterialNote: null
                }
            })
        });

        const result = await response.json();

        if (!response.ok) throw new Error(result.error || "Ndodhi një gabim.");

        // Keep the past, and keep every session the user has already marked
        // (done, partly done, skipped) whatever its date. Only sessions still
        // pending from today onward are replaced by the new ones.
        const keptSessions = plan.sessions.filter(s => s.date < today || s.status !== "pending");
        const newSessions = result.sessions.map(s => ({ ...s, status: "pending" }));

        plan.sessions = [...keptSessions, ...newSessions];
        plan.strategy = result.strategy;
        plan.explanations = result.explanations;
        plan.warnings = result.warnings;
        plan.stats = result.stats;

        persistUser(user);
        refreshDashboard();

        alert("Plani u rregullua. Shiko seancat e reja te faqja \"Planet\".");

    } catch (error) {

        alert(error.message);

    } finally {

        button.disabled = false;
        button.textContent = originalLabel;
    }
});


/* ==========================================
   PLANS PAGES
========================================== */

function renderRecentPlans(plans) {
    renderPlanList(document.getElementById("recentPlans"), plans.slice(-5).reverse());
}

function renderAllPlans() {
    const user = getCurrentUser();
    if (!user) return;
    renderPlanList(document.getElementById("allPlans"), (user.plans || []).slice().reverse());
}

function renderPlanList(container, plans) {

    if (!plans.length) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>Ende nuk ke plane</h3>
                <p>Krijo planin tënd të parë me AI.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = "";

    plans.forEach(plan => container.appendChild(createPlanCard(plan)));
}


function createPlanCard(plan) {

    const card = document.createElement("article");
    card.className = "plan-card";
    card.style.cursor = "pointer";
    card.style.flexDirection = "column";
    card.style.alignItems = "stretch";

    const done = plan.sessions.filter(s => s.status === "completed").length;

    card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:20px; margin-bottom: 12px;">
            <div>
                <h3>${safe(plan.subject)}</h3>
                <p>${formatDateHuman(plan.startDate)} → ${formatDateHuman(plan.endDate)} · ${done}/${plan.sessions.length} kryer</p>
            </div>
            <span class="plan-meta">${safe(plan.planMode || "")}</span>
        </div>
        <div class="plan-card-schedule hidden"></div>
    `;

    const scheduleBox = card.querySelector(".plan-card-schedule");

    card.addEventListener("click", () => {
        const isHidden = scheduleBox.classList.contains("hidden");
        if (isHidden && !scheduleBox.dataset.rendered) {
            renderScheduleList(scheduleBox, plan);
            scheduleBox.dataset.rendered = "true";
        }
        scheduleBox.classList.toggle("hidden");
    });

    return card;
}


/* ==========================================
   SAFE HTML
========================================== */

function safe(value) {

    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


/* ==========================================
   START APPLICATION
========================================== */

const existingUser = getCurrentUser();

if (existingUser) {
    openApp(existingUser);
}
