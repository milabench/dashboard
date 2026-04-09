from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    DateTime,
    ForeignKey,
    Table,
    Text,
    UniqueConstraint,
    JSON,
    create_engine,
    select,
    Boolean,
    Index,
)
from sqlalchemy.orm import relationship, sessionmaker, declarative_base
from sqlalchemy.orm import declarative_base

Base = declarative_base()


@dataclass
class Executor:
    pass


@dataclass
class Environment:
    pass


@dataclass
class Work:
    pass


@dataclass
class Work:
    executor: Executor
    environment: Environment
    work: Work
    verification: Work


class WorkItem(Base):
    __tablename__ = "work_queue"

    _id = Column(Integer, primary_key=True, autoincrement=True)

    # How the workload is going to be executed
    # The environment in which it will be executed
    # The work to be executed
    specification = Column(JSON)

    # Work priority
    priority = Column(Integer)

    # Work resource
    resource = Column(JSON)

    # The work status
    meta = Column(JSON)
    status = Column(Integer)
    result = Column(JSON)

    created_time = Column(DateTime, default=datetime.utcnow)
    modified_time = Column(DateTime, default=datetime.utcnow)

    # Dependencies / Work tree
    root_id  = Column(Integer, ForeignKey("work_queue._id"), nullable=True)
    parent_id = Column(Integer, ForeignKey("work_queue._id"), nullable=True)


class Worker(Base):
    __tablename__ = "worker"

    _id: Column(Integer, primary_key=True, autoincrement=True)

    last_activity = Column(DateTime, default=datetime.utcnow)

    meta = Column(JSON)


@dataclass
class Future:
    def __init__(self, work_id):
        self.work_id = work_id

    def is_done(self):
        """"""
    
    def get(self):
        pass

    def value(self):
        pass

    def wait(self):
        pass


def submit_work(work: Work) -> Future:
    """Insert work into the work queue"""

def pop_work(w: Worker) -> Work:
    """Pop the work from the work queue"""
    # Needs to be an atomic transaction to prevent same work being popped

def push_result(w: Worker, work: Work):
    """Push resilt from the work queue"""
    # Not as critical as the work is already reserved

def push_error(w: Worker, work: Work):
    """Push resilt from the work queue"""
    # Not as critical as the work is already reserved