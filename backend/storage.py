import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path


def timestamp():
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.database = self.root / "starwatch.sqlite3"
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute(
                "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, content TEXT NOT NULL)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, content TEXT NOT NULL)"
            )

    def connect(self):
        return sqlite3.connect(self.database, timeout=30)

    def create(self, content):
        item = {
            "id": uuid.uuid4().hex[:12],
            "created_at": timestamp(),
            "progress": 0,
            "stage": "等待分析",
            **content,
        }
        with self.connect() as db:
            db.execute(
                "INSERT INTO tasks VALUES (?,?)",
                (item["id"], json.dumps(item, ensure_ascii=False)),
            )
        return item

    def get(self, task_id):
        with self.connect() as db:
            row = db.execute(
                "SELECT content FROM tasks WHERE id=?", (task_id,)
            ).fetchone()
        if row is None:
            raise KeyError(task_id)
        return json.loads(row[0])

    def update(self, task_id, **changes):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT content FROM tasks WHERE id=?", (task_id,)
            ).fetchone()
            if row is None:
                raise KeyError(task_id)
            content = json.loads(row[0])
            content.update(changes, updated_at=timestamp())
            db.execute(
                "UPDATE tasks SET content=? WHERE id=?",
                (json.dumps(content, ensure_ascii=False), task_id),
            )
        return content

    def list(self):
        with self.connect() as db:
            rows = db.execute(
                "SELECT content FROM tasks ORDER BY rowid DESC"
            ).fetchall()
        return [json.loads(row[0]) for row in rows]

    def add_review(self, task_id, content):
        self.get(task_id)
        review = {
            "id": uuid.uuid4().hex,
            "created_at": timestamp(),
            "active": True,
            **content,
        }
        with self.connect() as db:
            db.execute(
                "INSERT INTO reviews VALUES (?,?,?)",
                (review["id"], task_id, json.dumps(review, ensure_ascii=False)),
            )
        return review

    def reviews(self, task_id, include_inactive=False):
        with self.connect() as db:
            rows = db.execute(
                "SELECT content FROM reviews WHERE task_id=? ORDER BY rowid", (task_id,)
            ).fetchall()
        reviews = [json.loads(row[0]) for row in rows]
        return reviews if include_inactive else [r for r in reviews if r["active"]]

    def undo_review(self, task_id, review_id):
        with self.connect() as db:
            row = db.execute(
                "SELECT content FROM reviews WHERE id=? AND task_id=?",
                (review_id, task_id),
            ).fetchone()
            if row is None:
                raise KeyError(review_id)
            content = json.loads(row[0])
            content["active"] = False
            content["undone_at"] = timestamp()
            db.execute(
                "UPDATE reviews SET content=? WHERE id=?",
                (json.dumps(content, ensure_ascii=False), review_id),
            )
