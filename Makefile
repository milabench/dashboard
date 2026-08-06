install:
	pip install -e .[all]
	pip install -r requirements.txt
	pip install -r docs/requirements.txt
	pip install -r tests/requirements.txt

doc: build-doc

build-doc:
	sphinx-build -W --color -c docs/ -b html docs/ _build/html

serve-doc:
	sphinx-serve

update-doc: build-doc serve-doc



CONDA_ACTIVATE=. $$(/home/delaunap/miniconda3/bin/conda info --base)/etc/profile.d/conda.sh ; conda activate

setup-conda:
	($(CONDA_ACTIVATE) py312; )

front:
	cd dashboard/ui && npm run dev

back-conda:
	($(CONDA_ACTIVATE) py312; POSTGRES_USER=milabench_write POSTGRES_PSWD=1234 flask --app dashboard.server.view:main run --host=0.0.0.0 --debug)

back:
	(. ../.venv/bin/activate; POSTGRES_USER=milabench_write POSTGRES_PSWD=1234 flask --app dashboard.server.view:main run --host=0.0.0.0 --debug)

# ── Local Postgres (dev) ────────────────────────────────────────────────────
# Same credentials as `make back`. Unsets DATABASE_URI so a prod DSN in the
# environment / data/.secrets cannot redirect these targets.
LOCAL_PG_HOST ?= localhost
LOCAL_PG_PORT ?= 5432
LOCAL_PG_DB   ?= milabench
LOCAL_PG_USER ?= milabench_write
LOCAL_PG_PSWD ?= 1234

LOCAL_DB_ENV = env -u DATABASE_URI \
	POSTGRES_HOST=$(LOCAL_PG_HOST) \
	POSTGRES_PORT=$(LOCAL_PG_PORT) \
	POSTGRES_DB=$(LOCAL_PG_DB) \
	POSTGRES_USER=$(LOCAL_PG_USER) \
	POSTGRES_PSWD=$(LOCAL_PG_PSWD) \
	POSTGRES_SSLMODE=

.PHONY: local-db local-db-migrate local-db-scaling local-db-gpus local-db-list

# Migrate + import scaling YAML + seed GPU catalog into the local DB.
local-db: local-db-migrate local-db-scaling local-db-gpus
	@echo "[local-db] Ready on $(LOCAL_PG_HOST):$(LOCAL_PG_PORT)/$(LOCAL_PG_DB)"

local-db-migrate:
	(. ../.venv/bin/activate; $(LOCAL_DB_ENV) sh -c 'cd dashboard && alembic upgrade head')

local-db-scaling:
	(. ../.venv/bin/activate; $(LOCAL_DB_ENV) dashboard db scaling import)

local-db-gpus:
	(. ../.venv/bin/activate; $(LOCAL_DB_ENV) dashboard db gpus seed)

local-db-list:
	(. ../.venv/bin/activate; $(LOCAL_DB_ENV) dashboard db scaling list)

# Alembic (config lives in dashboard/alembic.ini)
alembic-upgrade:
	cd dashboard && alembic upgrade head

alembic-revision:
	cd dashboard && alembic revision --autogenerate -m "$(msg)"

alembic-history:
	cd dashboard && alembic history

