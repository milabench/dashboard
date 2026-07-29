"""Application-owned SQLAlchemy engine and context-local sessions."""

from contextlib import contextmanager
from contextvars import ContextVar

import sqlalchemy
from sqlalchemy.orm import Session

from dashboard.server.database.models import from_json, to_json

class Database:
    def __init__(self, uri):
        self.uri = uri
        self._session: ContextVar[Session | None] = ContextVar(
            "db_session", default=None
        )
        kwargs = dict(
            echo=False,
            future=True,
            json_serializer=to_json,
            json_deserializer=from_json,
            pool_pre_ping=True,
            pool_recycle=1800,
        )
        driver = getattr(uri, "drivername", None) or str(uri)
        if not driver.startswith("sqlite"):
            kwargs.update(pool_size=5, max_overflow=5, pool_timeout=30)
        self.engine = sqlalchemy.create_engine(uri, **kwargs)

    def session(self) -> Session:
        sess = self._session.get()
        if sess is None:
            raise RuntimeError("No database session; use `with database.connect():`")
        return sess

    @contextmanager
    def connect(self):
        """Borrow a pooled connection; nested calls reuse the current session."""
        existing = self._session.get()
        if existing is not None:
            yield existing
            return

        sess = Session(self.engine)
        token = self._session.set(sess)
        try:
            yield sess
        except BaseException:
            sess.rollback()
            raise
        finally:
            sess.close()
            self._session.reset(token)

    def close(self):
        self.engine.dispose()
