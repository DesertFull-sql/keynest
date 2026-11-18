"""keynest simple — учебный сервис секретов.

Всё в одном файле:
- FastAPI принимает запросы;
- данные лежат в обычных словарях и списках (после перезапуска исчезают);
- HTML, CSS и JS раздаются из папки static.

Это НЕ production: пароль хешируется простым SHA-256 без соли,
секреты хранятся открыто, базы данных нет.
"""

import hashlib
import secrets
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="keynest simple")

# ---------- данные в памяти ----------

users: dict[str, str] = {}          # имя -> хеш пароля
sessions: dict[str, str] = {}       # токен -> имя
projects: list[dict] = []           # {"id", "owner", "name"}
secrets_list: list[dict] = []       # {"id", "owner", "project", "key", "value"}
audit: list[dict] = []              # {"owner", "time", "action", "detail"}
counter = 0


def new_id() -> int:
    global counter
    counter += 1
    return counter


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def add_audit(owner: str, action: str, detail: str) -> None:
    audit.insert(
        0,
        {
            "owner": owner,
            "time": datetime.now().strftime("%H:%M:%S"),
            "action": action,
            "detail": detail,
        },
    )


def current_user(request: Request) -> str:
    """Достаёт имя пользователя из заголовка Authorization."""
    header = request.headers.get("Authorization", "")
    token = header.removeprefix("Bearer ").strip()
    username = sessions.get(token)
    if username is None:
        raise HTTPException(status_code=401, detail="Нужно войти")
    return username


# ---------- модели запросов ----------

class AuthIn(BaseModel):
    username: str
    password: str


class ProjectIn(BaseModel):
    name: str


class SecretIn(BaseModel):
    project: str
    key: str
    value: str


# ---------- аккаунт ----------

@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/register")
def register(data: AuthIn) -> dict[str, str]:
    username = data.username.strip().lower()
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Имя: минимум 3 символа")
    if len(data.password) < 4:
        raise HTTPException(status_code=400, detail="Пароль: минимум 4 символа")
    if username in users:
        raise HTTPException(status_code=400, detail="Такой пользователь уже есть")

    users[username] = hash_password(data.password)
    add_audit(username, "user.registered", username)
    return {"message": "Аккаунт создан"}


@app.post("/api/login")
def login(data: AuthIn) -> dict[str, str]:
    username = data.username.strip().lower()
    if users.get(username) != hash_password(data.password):
        raise HTTPException(status_code=401, detail="Неверное имя или пароль")

    token = secrets.token_hex(16)
    sessions[token] = username
    add_audit(username, "user.login", username)
    return {"token": token, "username": username}


@app.post("/api/logout")
def logout(request: Request) -> dict[str, str]:
    header = request.headers.get("Authorization", "")
    token = header.removeprefix("Bearer ").strip()
    sessions.pop(token, None)
    return {"message": "Вы вышли"}


@app.get("/api/me")
def me(user: str = Depends(current_user)) -> dict[str, str]:
    return {"username": user}


# ---------- проекты ----------

@app.get("/api/projects")
def list_projects(user: str = Depends(current_user)) -> list[dict]:
    return [p for p in projects if p["owner"] == user]


@app.post("/api/projects")
def create_project(data: ProjectIn, user: str = Depends(current_user)) -> dict:
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Введите название проекта")
    if any(p["owner"] == user and p["name"] == name for p in projects):
        raise HTTPException(status_code=400, detail="Такой проект уже есть")

    project = {"id": new_id(), "owner": user, "name": name}
    projects.append(project)
    add_audit(user, "project.created", name)
    return project


# ---------- секреты ----------

@app.get("/api/secrets")
def list_secrets(user: str = Depends(current_user)) -> list[dict]:
    add_audit(user, "secrets.read", "список секретов")
    return [s for s in secrets_list if s["owner"] == user]


@app.post("/api/secrets")
def create_secret(data: SecretIn, user: str = Depends(current_user)) -> dict:
    project = data.project.strip()
    key = data.key.strip()
    value = data.value.strip()

    if not project or not key or not value:
        raise HTTPException(status_code=400, detail="Заполните проект, ключ и значение")
    if not any(p["owner"] == user and p["name"] == project for p in projects):
        raise HTTPException(status_code=400, detail="Сначала создайте проект")

    secret = {
        "id": new_id(),
        "owner": user,
        "project": project,
        "key": key,
        "value": value,
    }
    secrets_list.append(secret)
    add_audit(user, "secret.created", f"{key} ({project})")
    return secret


# ---------- журнал ----------

@app.get("/api/audit")
def list_audit(user: str = Depends(current_user)) -> list[dict]:
    return [
        {"time": row["time"], "action": row["action"], "detail": row["detail"]}
        for row in audit
        if row["owner"] == user
    ]


# ---------- страница ----------

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
