
import os
from pathlib import Path

from sqlalchemy import URL

# Keys loaded from data/.secrets into the environment when unset.
_DB_SECRET_KEYS = (
    "POSTGRES_ADMIN_PASSWORD",
    "DB_APP_PASSWORD",
    "POSTGRES_PSWD",
    "POSTGRES_HOST",
    "POSTGRES_PORT",
    "POSTGRES_DB",
    "POSTGRES_SSLMODE",
    "POSTGRES_USER",
    "POSTGRES_ADMIN_USER",
    "DATABASE_URI",
    # Dedicated backup role (used by GHA / dump --backup-user)
    "POSTGRES_BACKUP_USER",
    "POSTGRES_BACKUP_PASSWORD",
    # Azure Blob backups
    "BACKUP_STORAGE_ACCOUNT",
)


def load_db_secrets(root=None):
    """Fill unset DB-related env vars from ``data/.secrets``.

    Distinguishes admin vs application credentials:

    * ``POSTGRES_ADMIN_PASSWORD`` — PostgreSQL admin (DDL / Alembic)
    * ``DB_APP_PASSWORD`` / ``POSTGRES_PSWD`` — app role (``milabench_write``)

    Environment variables already set take precedence over the secrets file.
    """
    if root is None:
        from dashboard.server.slurm.constant import JOBRUNNER_LOCAL_CACHE

        root = Path(JOBRUNNER_LOCAL_CACHE)
    else:
        root = Path(root)

    from dashboard.server.slurm.secrets import create_default_store

    store = create_default_store(root)
    for key in _DB_SECRET_KEYS:
        if os.environ.get(key):
            continue
        value = store.get(key)
        if value:
            os.environ[key] = value

    # App password alias: DB_APP_PASSWORD is the canonical secret name in
    # deploy tooling; POSTGRES_PSWD is what the dashboard runtime uses.
    if not os.environ.get("POSTGRES_PSWD") and os.environ.get("DB_APP_PASSWORD"):
        os.environ["POSTGRES_PSWD"] = os.environ["DB_APP_PASSWORD"]


def _postgres_url(*, username, password):
    db = os.getenv("POSTGRES_DB", "milabench")
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    sslmode = os.getenv("POSTGRES_SSLMODE", "")
    query = {"sslmode": sslmode} if sslmode else {}
    return URL.create(
        "postgresql",
        username=username,
        password=password,
        host=host,
        port=int(port),
        database=db,
        query=query,
    )


def database_uri():
    """Connection URL for the application DB role (read/write app access).

    Uses ``POSTGRES_USER`` / ``POSTGRES_PSWD``, with ``DB_APP_PASSWORD`` as a
    fallback for the password (see ``load_db_secrets``).
    """
    uri_override = os.getenv("DATABASE_URI", None)
    if uri_override:
        return uri_override

    user = os.getenv("POSTGRES_USER", "username")
    password = (
        os.getenv("POSTGRES_PSWD")
        or os.getenv("DB_APP_PASSWORD")
        or "password"
    )
    return _postgres_url(username=user, password=password)


def admin_database_uri():
    """Connection URL for the PostgreSQL admin role (migrations / grants).

    Uses ``POSTGRES_ADMIN_USER`` / ``POSTGRES_ADMIN_PASSWORD``. Does **not**
    fall back to the app password — migrations must use admin credentials.
    """
    user = os.getenv("POSTGRES_ADMIN_USER", "pgadmin")
    password = os.getenv("POSTGRES_ADMIN_PASSWORD", "")
    if not password:
        raise ValueError(
            "POSTGRES_ADMIN_PASSWORD is not set. Add it to data/.secrets "
            "or export it in the environment."
        )
    return _postgres_url(username=user, password=password)


def backup_database_uri():
    """Connection URL for dumps (backup role, else admin, else app).

    Preference order:

    1. ``POSTGRES_BACKUP_USER`` / ``POSTGRES_BACKUP_PASSWORD``
    2. admin credentials (``admin_database_uri``)
    3. app credentials (``database_uri``)
    """
    backup_user = os.getenv("POSTGRES_BACKUP_USER")
    backup_password = os.getenv("POSTGRES_BACKUP_PASSWORD")
    if backup_user and backup_password:
        return _postgres_url(username=backup_user, password=backup_password)

    try:
        return admin_database_uri()
    except ValueError:
        return database_uri()


def page(title, body, more_css=""):
    css = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@4.0.0/dist/css/bootstrap.min.css" integrity="sha384-Gn5384xqQ1aoWXA+058RXPxPg6fy4IWvTNh0E263XmFcJlSAwiGgFAW/dAiS6JXm" crossorigin="anonymous">'
    
    return f"""
        <!doctype html>
        <html>
            <head>
                <title>{title}</title>
                {css}

                <style>
                    th {{
                        text-align: left
                    }}

                    td {{
                        text-align: right
                    }}

                    {more_css}
                </style>
            </head>
            <body>
                <div class="container-fluid">
                    {body}
                </div>
            </body>
        </html>
        """


def plot(chart):
    return f"""
    <div>
        <script src="https://cdn.jsdelivr.net/npm/vega@5"></script>
        <script src="https://cdn.jsdelivr.net/npm/vega-lite@5"></script>
        <script src="https://cdn.jsdelivr.net/npm/vega-embed@6"></script>
        <div id="vis"></div>
        <script type="text/javascript">
            (function () {{
                const spec = {chart};
                vegaEmbed('#vis', spec, {{actions: false}}).catch(console.error);
            }})();
        </script>
    </div>
    """


def cursor_to_json(cursor):
    columns = list(cursor.keys())
    results = []
    for row in cursor:
        row_dict = {}
        for col, val in zip(columns, row):
            row_dict[col] = val
        results.append(row_dict)
    return results


def cursor_to_dataframe(cursor):
    import pandas as pd

    columns = list(cursor.keys())
    results = []
    for row in cursor:
        row = list(row)
        results.append(row)

    return pd.DataFrame(results, columns=columns)


def make_selection_key(key, names=None, used_tables=None):
    from dashboard.server.database.models import Exec, Metric, Pack, Weight
    from sqlalchemy import Text, cast

    table, path = key.split(":")
    tables = {
        "Exec": Exec, 
        "Metric": Metric, 
        "Pack": Pack,
        "Weight": Weight
    }

    types = {
        "product": str,
        "CUDA_VERSION": str,
        "TORCH_VERSION": str
    }

    if used_tables is not None:
        used_tables.append(table)

    maybe = path.split(" as ")
    path = maybe[0]

    frags = path.split(".")
    selection = getattr(tables[table], frags[0]) 

    for frag in frags[1:-1]:
        selection = selection[frag]

    if len(frags) > 1:
        lst = frags[-1]
        lst_type = types.get(lst, str)

        if lst_type is str:
            selection = cast(selection[lst], Text)
        else:
            selection = selection[lst]
    
    if len(maybe) == 2:
        as_name = maybe[1]
    else:
        as_name = key

    if names is not None:
        names[key] = as_name

    return selection.label(as_name)

def make_filter(key, fields=None, used_tables=None):
    op = key["operator"]
    field = make_selection_key(key["field"], used_tables=used_tables)
    value = key["value"]

    if fields is not None:
        fields[key["field"]] = field

    match op:
        case "in":
            if isinstance(value, str):
                return field.in_([v.strip() for v in value.split(",")])
            else:
                return field.in_(value)
        case "not in":
            if isinstance(value, str):
                return field.notin_([v.strip() for v in value.split(",")])
            else:
                return field.notin_(value)
        case "==":
            return field == value
        case "!=":
            return field != value
        case ">":
            return field > value
        case "<":
            return field < value
        case ">=":
            return field >= value
        case "<=":
            return field <= value
        case "like":
            return field.like(value)
        case "not like":
            return field.notlike(value)
        case "is":
            return field.is_(value)
        case "is not":
            return field.is_not(value)

def make_filters(filters, fields=None, used_tables=None):
    return [make_filter(f, fields, used_tables=used_tables) for f in filters]
