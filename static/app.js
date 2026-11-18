// keynest simple — весь клиентский код в одном файле.

const TOKEN_KEY = "keynest_simple_token";

let token = localStorage.getItem(TOKEN_KEY);
let mode = "login";

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "Проверьте поля";
    throw new Error(detail);
  }
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showAuthError(message) {
  $("auth-error").textContent = message;
  $("auth-error").classList.toggle("hidden", !message);
}

function showAppError(message) {
  $("global-error").textContent = message;
  $("global-error").classList.toggle("hidden", !message);
}

function setMode(next) {
  mode = next;
  $("auth-submit").textContent = mode === "login" ? "Войти" : "Зарегистрироваться";
  $("toggle-mode").textContent = mode === "login" ? "Создать аккаунт" : "У меня есть аккаунт";
  showAuthError("");
  $("auth-info").classList.add("hidden");
}

function showAuth() {
  $("app-screen").classList.add("hidden");
  $("auth-screen").classList.remove("hidden");
  $("user-box").classList.add("hidden");
}

async function enterApp(username) {
  $("auth-screen").classList.add("hidden");
  $("app-screen").classList.remove("hidden");
  $("user-box").classList.remove("hidden");
  $("who").textContent = username;
  try {
    await loadAll();
  } catch (error) {
    showAppError(error.message);
  }
}

async function loadAll() {
  const projectsData = await api("/api/projects");
  const secretsData = await api("/api/secrets");
  const auditData = await api("/api/audit");

  renderProjects(projectsData);
  renderSecrets(secretsData);
  renderAudit(auditData);
}

function renderProjects(items) {
  $("projects").innerHTML = items
    .map(
      (project) =>
        `<li><span>${escapeHtml(project.name)}</span><span class="muted">#${project.id}</span></li>`,
    )
    .join("");
  $("projects-empty").classList.toggle("hidden", items.length > 0);

  const select = $("secret-project");
  select.innerHTML = items.length
    ? items
        .map(
          (project) =>
            `<option value="${escapeHtml(project.name)}">${escapeHtml(project.name)}</option>`,
        )
        .join("")
    : '<option value="">Сначала создайте проект</option>';
}

function renderSecrets(items) {
  $("secrets").innerHTML = items
    .map(
      (secret) => `
        <li>
          <div>
            <div class="secret-key">${escapeHtml(secret.key)}</div>
            <div class="secret-meta">${escapeHtml(secret.project)}</div>
          </div>
          <details>
            <summary>показать</summary>
            <code>${escapeHtml(secret.value)}</code>
          </details>
        </li>`,
    )
    .join("");
  $("secrets-empty").classList.toggle("hidden", items.length > 0);
}

function renderAudit(rows) {
  $("audit").innerHTML = rows
    .map(
      (row) => `
        <li>
          <span>${escapeHtml(row.time)}</span>
          <span>${escapeHtml(row.action)}</span>
          <span>${escapeHtml(row.detail)}</span>
        </li>`,
    )
    .join("");
  $("audit-empty").classList.toggle("hidden", rows.length > 0);
}

$("toggle-mode").addEventListener("click", () => {
  setMode(mode === "login" ? "register" : "login");
});

$("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showAuthError("");

  const username = $("username").value.trim();
  const password = $("password").value;

  try {
    if (mode === "register") {
      await api("/api/register", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setMode("login");
      $("password").value = "";
      $("auth-info").textContent = "Аккаунт создан. Теперь войдите.";
      $("auth-info").classList.remove("hidden");
      return;
    }

    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    token = data.token;
    localStorage.setItem(TOKEN_KEY, token);
    $("password").value = "";
    await enterApp(data.username);
  } catch (error) {
    showAuthError(error.message);
  }
});

$("project-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showAppError("");
  const name = $("project-name").value.trim();
  if (!name) return;

  try {
    await api("/api/projects", { method: "POST", body: JSON.stringify({ name }) });
    $("project-name").value = "";
    await loadAll();
  } catch (error) {
    showAppError(error.message);
  }
});

$("secret-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showAppError("");

  const body = JSON.stringify({
    project: $("secret-project").value,
    key: $("secret-key").value,
    value: $("secret-value").value,
  });

  try {
    await api("/api/secrets", { method: "POST", body });
    $("secret-key").value = "";
    $("secret-value").value = "";
    await loadAll();
  } catch (error) {
    showAppError(error.message);
  }
});

$("logout").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } catch {
    // даже если сервер не ответил, локально выходим
  }
  token = null;
  localStorage.removeItem(TOKEN_KEY);
  $("username").value = "";
  $("password").value = "";
  showAuth();
});

async function boot() {
  if (!token) {
    showAuth();
    return;
  }

  try {
    const me = await api("/api/me");
    await enterApp(me.username);
  } catch {
    token = null;
    localStorage.removeItem(TOKEN_KEY);
    showAuth();
  }
}

boot();
