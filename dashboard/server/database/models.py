from datetime import datetime

import sqlalchemy
from bson.json_util import dumps as to_json, loads as from_json
from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
    Computed,
    Boolean,
    UniqueConstraint,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, declarative_base, declared_attr

Base = declarative_base()


def _register_extra_models():
    """Import sibling model modules so they register on Base.metadata."""
    try:
        from . import gpu as _gpu  # noqa: F401
        from . import scheduled_job as _scheduled_job  # noqa: F401
    except ImportError:
        pass


class Exec(Base):
    __tablename__ = "execs"

    _id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(256))
    namespace = Column(String(256))
    created_time = Column(DateTime, default=datetime.utcnow)
    meta = Column(JSON)
    status = Column(String(256))

    # Visibility works as a level, this way we can do show all runs <= 2
    #  0= public
    #  1= private
    # We could also have a moving "public" visibility as time move older results become available
    visibility = Column(Integer, default=0)
    share_token = Column(String(64), nullable=True, unique=True)
    release_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("exec_name", "name"),
        Index("exec_visibility", "visibility"),
        Index("exec_share_token", "share_token", unique=True),
        Index(
            'execs_meta_gpus_0_product_idx',
            text("(meta -> 'accelerators' -> 'gpus' -> '0' ->> 'product')"),
            postgresql_using='btree'
        ),
        # Pivot query optimization indexes
        Index(
            'idx_exec_meta_pytorch_version',
            text("(meta -> 'pytorch' ->> 'version')"),
            postgresql_using='btree'
        ),
        Index(
            'idx_exec_meta_pytorch_torch',
            text("(meta -> 'pytorch' ->> 'torch')"),
            postgresql_using='btree'
        ),
        # Index(
        #     'idx_exec_meta_accelerators_gin',
        #     text("meta -> 'accelerators'"),
        #     postgresql_using='gin'
        # ),
        # Index(
        #     'idx_exec_meta_pytorch_gin',
        #     text("meta -> 'pytorch'"),
        #     postgresql_using='gin'
        # )
    )

    def as_dict(self, *, include_private_fields=False):
        data = {
            "_id": self._id,
            "name": self.name,
            "namespace": self.namespace,
            "created_time": self.created_time,
            "meta": self.meta,
            "status": self.status,
        }
        if include_private_fields:
            data["visibility"] = self.visibility
            data["release_at"] = (
                self.release_at.isoformat() if self.release_at is not None else None
            )
        return data


class Pack(Base):
    __tablename__ = "packs"

    _id = Column(Integer, primary_key=True, autoincrement=True)
    exec_id = Column(Integer, ForeignKey("execs._id"), nullable=False)
    created_time = Column(DateTime, default=datetime.utcnow)
    name = Column(String(256))
    tag = Column(String(256))
    config = Column(JSON)
    command = Column(JSON)
    status = Column(String(256))

    __mapper_args__ = {"exclude_properties": ["ngpu"]}

    #
    @declared_attr
    def ngpu(cls):
        try:
            if Base.metadata.bind and Base.metadata.bind.dialect.name != 'sqlite':
                return Column(Integer, Computed("((config->>'num_machines')::int * json_array_length(config->'devices'))"), name="ngpu")
            else:
                return Column(Integer, name="ngpu")  # Empty placeholder
        except:
            return Column(Integer, name="ngpu")  # Empty placeholder


    # @property
    # def gpu_count(self):
    #     return len(self.config.get("devices", [1])) if self.config else 1

    # @property
    # def node_count(self):
    #     return self.config.get("num_machines", 1) if self.config else 1

    # @property
    # def ngpu(self):
    #     return self.gpu_count * self.node_count

    __table_args__ = (
        Index("exec_pack_query", "exec_id"),
        Index("pack_query", "name", "exec_id"),
        Index("pack_tag", "tag"),
        Index("idx_pack_name", "name"),
        Index("idx_pack_status", "status"),
        Index("idx_pack_exec_status", "exec_id", "status"),
        Index("idx_pack_exec_name_status", "exec_id", "name", "status"),
    )

    def as_dict(self):
        return {
            "_id": self._id,
            "exec_id": self.exec_id,
            "name": self.name,
            "tag": self.tag,
            "created_time": self.created_time,
            "config": self.config,
            "command": self.command,
            "status": self.status
        }


class Metric(Base):
    __tablename__ = "metrics"

    _id = Column(Integer, primary_key=True, autoincrement=True)
    exec_id = Column(Integer, ForeignKey("execs._id"), nullable=False)
    pack_id = Column(Integer, ForeignKey("packs._id"), nullable=False)

    # Insert Time
    order = Column(Integer)

    name = Column(String(256))
    namespace = Column(String(256))
    value = Column(Float)
    unit = Column(String(128))

    job_id = Column(Integer)  # Job ID
    gpu_id = Column(String(36))  # GPU id

    __table_args__ = (
        Index("metric_query", "exec_id", "pack_id"),
        Index("metric_name", "name"),
        # Pivot query optimization indexes
        Index("idx_metric_name_value", "name", "value"),  # For DISTINCT queries with filtering
        Index("idx_metric_exec_pack_name", "exec_id", "pack_id", "name"),  # For base_report_view joins
        Index("idx_metric_pack_name", "pack_id", "name"),  # For faster pack-metric joins
        Index("idx_metric_exec_name", "exec_id", "name"),  # For exec-metric aggregations
    )

    def as_dict(self):
        return {
            "_id": self._id,
            "exec_id": self.exec_id,
            "pack_id": self.pack_id,
            "order": self.order,
            "name": self.name,
            "namespace": self.namespace,
            "value": self.value,
            "unit": self.unit,
            "job_id": self.job_id,
            "gpu_id": self.gpu_id,
        }


class SavedQuery(Base):
    """Save queries to easy access"""
    __tablename__ = "saved_queries"

    _id = Column(Integer, primary_key=True, autoincrement=True)

    name = Column(String(256))
    query = Column(JSON)
    created_time = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("saved_queries_name", "name"),
    )

    def as_dict(self):
        return {
            "_id": self._id,
            "name": self.name,
            "query": self.query,
            "created_time": self.created_time,
        }


class PushKey(Base):
    __tablename__ = "push_keys"

    _id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(256), nullable=False, unique=True)
    key = Column(String(64), nullable=False, unique=True)
    created_time = Column(DateTime, default=datetime.utcnow)
    metadata_ = Column("metadata", JSON, nullable=False, default=dict)

    __table_args__ = (
        Index("push_keys_key", "key"),
        Index("push_keys_name", "name"),
    )

    def __repr__(self):
        return f"PushKey(name={self.name})"

    def as_dict(self):
        return {
            "_id": self._id,
            "name": self.name,
            "created_time": self.created_time,
            "metadata": self.metadata_ or {},
        }


class Weight(Base):
    """Save queries to easy access"""
    __tablename__ = "weights"

    _id = Column(Integer, primary_key=True, autoincrement=True)

    profile = Column(String(256), nullable=False)
    pack = Column(String(256), nullable=False)
    weight = Column(Integer, default=0, nullable=False)
    # 1XXX: Synthetic
    # 2XXX: CV
    # 3XXX: NLP
    # 4XXX: RL
    # 5XXX: Graphs

    # 1XX: Transformer
    # 2XX: Convnets
    # 3XX: MLP
    priority = Column(Integer, default=0, nullable=False)
    enabled = Column(Boolean, default=False, nullable=False)
    group1 = Column(String(256), nullable=True)
    group2 = Column(String(256), nullable=True)
    group3 = Column(String(256), nullable=True)
    group4 = Column(String(256), nullable=True)

    __table_args__ = (
        UniqueConstraint("profile", "pack", name="uq_profile_pack"),
        Index("weight_profile_pack", "profile", "pack"),
        # Pivot query optimization indexes
        Index("idx_weight_profile_enabled", "profile", "enabled"),  # For enabled weight filtering
        Index("idx_weight_pack", "pack"),  # For pack name lookups
        Index("idx_weight_profile_priority", "profile", "priority"),  # For ordered results
    )

    def __repr__(self):
        return f"Weight({self.as_dict()})"

    def as_dict(self):
        return {
            "_id": self._id,
            "profile": self.profile,
            "pack": self.pack,
            "weight": self.weight,
            "priority": self.priority,
            "enabled": self.enabled,
            "group1": self.group1,
            "group2": self.group2,
            "group3": self.group3,
            "group4": self.group4,
        }


class ReportCache(Base):
    """Cached report rows keyed by (exec_id, profile, bench).

    Populated lazily on first report request for a given exec_id,
    and evicted when new data is pushed or by a periodic cleanup job.
    """
    __tablename__ = "report_cache"

    _id = Column(Integer, primary_key=True, autoincrement=True)
    exec_id = Column(Integer, ForeignKey("execs._id"), nullable=False)
    profile = Column(String(256), nullable=False)
    bench = Column(String(256), nullable=False)

    fail = Column(Integer, default=0)
    n = Column(Float)
    ngpu = Column(Float)
    perf = Column(Float)
    sem = Column(Float)
    std = Column(Float)
    score = Column(Float)
    log_score = Column(Float)
    weight = Column(Float)
    enabled = Column(Float)
    order = Column(Float)
    weight_total = Column(Float)

    created_at = Column(DateTime, default=datetime.utcnow)
    last_accessed = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_report_cache_exec_profile", "exec_id", "profile"),
        Index("idx_report_cache_created", "created_at"),
        Index("idx_report_cache_last_accessed", "last_accessed"),
        UniqueConstraint("exec_id", "profile", "bench", name="uq_report_cache_row"),
    )

    def as_dict(self):
        return {
            "exec_id": self.exec_id,
            "bench": self.bench,
            "fail": self.fail,
            "n": self.n,
            "ngpu": self.ngpu,
            "perf": self.perf,
            "sem": self.sem,
            "std": self.std,
            "score": self.score,
            "log_score": self.log_score,
            "weight": self.weight,
            "enabled": self.enabled,
            "order": self.order,
            "weight_total": self.weight_total,
        }

def generate_database_sql_setup(uri=None):
    """Users usally do not have create table permission.
    We generate the code to create the table so someone with permission can execute the script.
    """
    import os

    _register_extra_models()

    dummy = "sqlite:///sqlite.db"
    if uri is None:
        uri = dummy

    filename = os.path.join(os.path.dirname(__file__), "..", "..", "..", "scripts", "tables.sql")
    os.makedirs(os.path.dirname(filename), exist_ok=True)

    with open(filename, "w") as file:
        file.write("--\n")
        file.write("-- Generated using:\n")
        file.write("--\n")
        file.write("--      python -m dashboard.server.database.models\n")
        file.write("--\n")

        def metadata_dump(sql, *multiparams, **params):
            sql = str(sql.compile(dialect=postgresql.dialect()))
            sql = sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS")
            sql = sql.replace("CREATE INDEX", "CREATE INDEX IF NOT EXISTS")

            file.write(f"{sql};")
            file.write("-- \n")

        engine = sqlalchemy.create_mock_engine(
            uri, strategy="mock", executor=metadata_dump
        )
        Base.metadata.create_all(engine)


        file.write(base_weight_profile().replace("        ", ""))
        file.write("-- \n")



def base_weight_profile():
    return """
        INSERT INTO
            weights (profile, weight, priority, pack, enabled, group1, group2)
        VALUES
            ('default', 0, 1000, 'fp16', TRUE, 'SYNTHETIC', 'FLOPS'),
            ('default', 0, 1001, 'bf16', TRUE, 'SYNTHETIC', 'FLOPS'),
            ('default', 0, 1002, 'tf32', TRUE, 'SYNTHETIC', 'FLOPS'),
            ('default', 0, 1003, 'fp32', TRUE, 'SYNTHETIC', 'FLOPS'),
            ('default', 0, 2201, 'convnext_large-fp32', TRUE, 'CV', 'CONVNET'),
            ('default', 0, 2202, 'convnext_large-fp16', TRUE, 'CV', 'CONVNET'),
            ('default', 0, 2203, 'convnext_large-tf32', TRUE, 'CV', 'CONVNET'),
            ('default', 1, 2204, 'convnext_large-tf32-fp16', TRUE, 'CV', 'CONVNET'),
            ('default', 1, 2205, 'resnet50', TRUE, 'CV', 'CONVNET'),
            ('default', 0, 2206, 'resnet50-noio', TRUE, 'CV', 'CONVNET'),
            ('default', 0, 2207, 'resnet152-ddp-gpus', TRUE, 'CV', 'CONVNET'),
            ('default', 1, 2208, 'regnet_y_128gf', TRUE, 'CV', 'CONVNET'),
            ('default', 0, 2209, 'lightning', TRUE, 'CV', 'CONVNET'),
            ('default', 1, 2210, 'lightning-gpus', TRUE, 'CV', 'CONVNET'),
            ('default', 0, 2211, 'focalnet', TRUE, 'CV', 'CONVNET'),
            ('default', 0, 2012, 'diffusion-single', TRUE, 'CV', 'DIFFUSION'),
            ('default', 1, 2013, 'diffusion-gpus', TRUE, 'CV', 'DIFFUSION'),
            ('default', 1, 2014, 'diffusion-nodes', FALSE, 'CV', 'DIFFUSION'),
            ('default', 0, 2101, 'dinov2-giant-single', TRUE, 'CV', 'TRANSFORMER'),
            ('default', 1, 2102, 'dinov2-giant-gpus', TRUE, 'CV', 'TRANSFORMER'),
            ('default', 0, 2103, 'dinov2-giant-nodes', FALSE, 'CV', 'TRANSFORMER'),
            ('default', 1, 2104, 'llava-single', TRUE, 'CV', 'TRANSFORMER'),
            ('default', 0, 2105, 'llava-gpus', FALSE, 'CV', 'TRANSFORMER'),
            ('default', 1, 2106, 'vjepa-single', TRUE, 'CV', 'TRANSFORMER'),
            ('default', 1, 2107, 'vjepa-gpus', TRUE, 'CV', 'TRANSFORMER'),
            ('default', 0, 3100, 'bert-fp32', TRUE, 'NLP', 'TRANSFORMER'),
            ('default', 0, 3101, 'bert-fp16', TRUE, 'NLP', 'TRANSFORMER'),
            ('default', 0, 3102, 'bert-tf32', TRUE, 'NLP', 'TRANSFORMER'),
            ('default', 1, 3103, 'bert-tf32-fp16', TRUE, 'NLP', 'TRANSFORMER'),
            ('default', 0, 3104, 't5', TRUE, 'NLP', 'TRANSFORMER'),
            ('default', 1, 3105, 'reformer', TRUE, 'NLP', 'TRANSFORMER'),
            ('default', 0, 3106, 'whisper', TRUE, 'NLP', 'TRANSFORMER'),
            ('default', 1, 3107, 'llama', TRUE, 'NLP', 'TRANSFORMER'),
            ('default', 1, 3108, 'llm-lora-single', TRUE, 'NLP', 'TRANSFORMER'),
            ('default', 1, 3109, 'llm-lora-ddp-gpus', TRUE, 'NLP', 'TRANSFORMER'),
            ('default', 1, 3110, 'llm-lora-ddp-nodes', TRUE, 'NLP', 'TRANSFORMER'),
            ('default', 1, 3111, 'llm-lora-mp-gpus', TRUE, 'NLP', 'TRANSFORMER'),
            ('default', 1, 3112, 'llm-full-mp-gpus', TRUE, 'NLP', 'TRANSFORMER'),
            ('default', 1, 3113, 'llm-full-mp-nodes', TRUE, 'NLP', 'TRANSFORMER'),
            ('default', 1, 3114, 'rlhf-single', TRUE, 'NLP', 'TRANSFORMER'),
            ('default', 0, 3115, 'rlhf-gpus', TRUE, 'NLP', 'TRANSFORMER'),
            ('default', 1, 4201, 'torchatari', TRUE, 'RL', 'CONVNET'),
            ('default', 1, 4302, 'brax', TRUE, 'RL', 'MLP'),
            ('default', 0, 4303, 'dqn', TRUE, 'RL', 'MLP'),
            ('default', 1, 4304, 'ppo', TRUE, 'RL', 'MLP'),
            ('default', 0, 4305, 'cleanrljax', FALSE, 'RL', 'MLP'),
            ('default', 1, 5000, 'pna', TRUE, 'GRAPHS', 'GNN'),
            ('default', 1, 5001, 'dimenet', TRUE, 'GRAPHS', 'GNN'),
            ('default', 1, 5002, 'recursiongfn', TRUE, 'GRAPHS', 'GFlow')
        ON CONFLICT (profile, pack) DO NOTHING
        ;"""

def create_database(uri):
    _register_extra_models()

    engine = sqlalchemy.create_engine(
        uri,
        echo=False,
        future=True,
        json_serializer=to_json,
        json_deserializer=from_json,
    )

    try:
        Base.metadata.bind = engine
        Base.metadata.create_all(engine)

        with Session(engine) as session:
            session.execute(text(base_weight_profile()))
            session.commit()

    except DBAPIError as err:
        print(f"could not create database schema because of {err}")


if __name__ == "__main__":
    generate_database_sql_setup()
