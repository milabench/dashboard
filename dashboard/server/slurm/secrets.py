"""Secret provider API for slurm job submission.

Secrets are resolved through a chain of providers. The first provider
that returns a value for a key wins. Default chain:

  1. Environment variables (os.environ[KEY])
  2. .secrets KEY=VALUE file in the data directory
  3. Command provider (if DASHBOARD_SECRET_CMD is set)

Template syntax in scripts: {{ secrets.KEY_NAME }}
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable


SECRET_PATTERN = re.compile(r"\{\{\s*secrets\.(\w+)\s*\}\}")


@runtime_checkable
class SecretProvider(Protocol):
    """Protocol for secret providers."""

    @property
    def name(self) -> str: ...

    def get(self, key: str) -> str | None: ...

    def available(self) -> bool: ...


class EnvSecretProvider:
    """Read secrets directly from environment variables."""

    @property
    def name(self) -> str:
        return "env"

    def available(self) -> bool:
        return True

    def get(self, key: str) -> str | None:
        return os.environ.get(key)


class FileSecretProvider:
    """Load secrets from a KEY=VALUE file."""

    def __init__(self, path: Path):
        self._path = path
        self._cache: dict[str, str] | None = None

    @property
    def name(self) -> str:
        return f"file:{self._path}"

    def available(self) -> bool:
        return self._path.exists()

    def get(self, key: str) -> str | None:
        if self._cache is None:
            self._cache = self._load()
        return self._cache.get(key)

    def keys(self) -> list[str]:
        if self._cache is None:
            self._cache = self._load()
        return list(self._cache.keys())

    def reload(self):
        self._cache = None

    def set(self, key: str, value: str):
        """Add or update a key in the secrets file."""
        if self._cache is None:
            self._cache = self._load()

        self._cache[key] = value
        self._write()

    def delete(self, key: str) -> bool:
        """Remove a key from the secrets file. Returns True if it existed."""
        if self._cache is None:
            self._cache = self._load()

        if key not in self._cache:
            return False

        del self._cache[key]
        self._write()
        return True

    def _write(self):
        self._path.parent.mkdir(parents=True, exist_ok=True)
        lines = [f"{k}={v}\n" for k, v in sorted(self._cache.items())]
        self._path.write_text("".join(lines))
        try:
            self._path.chmod(0o600)
        except OSError:
            pass

    def _load(self) -> dict[str, str]:
        if not self._path.exists():
            return {}

        secrets = {}
        for line in self._path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip()
                if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
                    v = v[1:-1]
                secrets[k] = v
        return secrets


class TomlSecretProvider:
    """Load secrets from a TOML file with named environment sections.

    Expected format::

        [dev]
        POSTGRES_HOST = "localhost"
        DB_APP_PASSWORD = "devpass"

        [prod]
        POSTGRES_HOST = "prod.example.com"
        DB_APP_PASSWORD = "prodpass"

    An optional ``[common]`` section is merged first; the selected env
    section overrides it. Select the section via ``env`` (default ``"dev"``),
    ``DASHBOARD_ENV`` env var, or ``--env`` CLI flag.
    """

    def __init__(self, path: Path, env: str = "dev"):
        self._path = path
        self._env = env
        self._cache: dict[str, str] | None = None

    @property
    def name(self) -> str:
        return f"toml:{self._path}[{self._env}]"

    def available(self) -> bool:
        return self._path.exists()

    def get(self, key: str) -> str | None:
        if self._cache is None:
            self._cache = self._load()
        return self._cache.get(key)

    def keys(self) -> list[str]:
        if self._cache is None:
            self._cache = self._load()
        return list(self._cache.keys())

    def reload(self):
        self._cache = None

    def _load(self) -> dict[str, str]:
        if not self._path.exists():
            return {}
        try:
            import tomllib
        except ImportError:
            try:
                import tomli as tomllib  # type: ignore[no-redef]
            except ImportError:
                raise ImportError(
                    "tomllib not found. Upgrade to Python 3.11+ or install tomli."
                )
        with self._path.open("rb") as fh:
            data = tomllib.load(fh)

        result: dict[str, str] = {}
        for k, v in data.get("common", {}).items():
            result[k] = str(v)
        for k, v in data.get(self._env, {}).items():
            result[k] = str(v)
        return result


class CommandSecretProvider:
    """Fetch secrets by running an external command.

    The command template should contain {key} which will be replaced
    with the secret name. Exit code 0 = found, non-zero = not found.

    Example: "pass show milabench/{key}"
    """

    def __init__(self, command_template: str):
        self._template = command_template

    @property
    def name(self) -> str:
        return f"cmd:{self._template.split()[0]}"

    def available(self) -> bool:
        binary = self._template.split()[0]
        return shutil.which(binary) is not None

    def get(self, key: str) -> str | None:
        cmd = self._template.replace("{key}", key)
        try:
            result = subprocess.run(
                cmd, shell=True, capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
        return None


class BitwardenSecretProvider:
    """Fetch secrets from the Bitwarden CLI (``bw``).

    Setup::

        bw login                        # once — authenticate
        export BW_SESSION=$(bw unlock --raw)   # unlock before each CLI session

    Each secret is stored as a **Login item** in Bitwarden:

    * Item name  → the secret key (e.g. ``POSTGRES_HOST``)
    * Password   → the secret value

    Optionally scope lookups to one collection by setting
    ``DASHBOARD_BW_COLLECTION`` to the collection ID, or pass ``collection``
    to the constructor.  Unscoped lookups search the whole vault.
    """

    def __init__(self, collection: str | None = None):
        self._collection = collection or os.environ.get("DASHBOARD_BW_COLLECTION")
        self._cache: dict[str, str] = {}

    @property
    def name(self) -> str:
        suffix = f"/{self._collection}" if self._collection else ""
        return f"bitwarden{suffix}"

    def available(self) -> bool:
        return shutil.which("bw") is not None and bool(self._session())

    def _session(self) -> str:
        return os.environ.get("BW_SESSION") or os.environ.get("DASHBOARD_BW_SESSION", "")

    def get(self, key: str) -> str | None:
        if key in self._cache:
            return self._cache[key]

        cmd = ["bw", "get", "password", key, "--session", self._session()]
        if self._collection:
            cmd += ["--collectionid", self._collection]

        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=15
            )
            if result.returncode == 0:
                value = result.stdout.strip()
                if value:
                    self._cache[key] = value
                    return value
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
        return None


@dataclass
class SecretStore:
    """Chain of secret providers. First match wins."""

    providers: list = field(default_factory=list)
    _cache: dict = field(default_factory=dict, init=False)

    def get(self, key: str) -> str:
        """Resolve a secret by key. Returns empty string if not found."""
        if key in self._cache:
            return self._cache[key]

        for provider in self.providers:
            if not provider.available():
                continue
            value = provider.get(key)
            if value is not None:
                self._cache[key] = value
                return value

        return ""

    def list_available(self) -> list[str]:
        """Return secret names known to the file provider."""
        keys = set()
        for provider in self.providers:
            if isinstance(provider, FileSecretProvider) and provider.available():
                keys.update(provider.keys())
        return sorted(keys)

    def file_provider(self) -> FileSecretProvider | None:
        """Return the file provider instance if present."""
        for provider in self.providers:
            if isinstance(provider, FileSecretProvider):
                return provider
        return None

    def clear_cache(self):
        self._cache.clear()


def create_default_store(root: Path, env: str = "dev") -> SecretStore:
    """Create a SecretStore with the default provider chain.

    Prefers ``secrets.toml`` (with ``[dev]``/``[prod]`` sections) when present;
    falls back to the legacy ``KEY=VALUE`` ``.secrets`` file.

    *env* selects the TOML section and must be passed explicitly.
    It intentionally ignores ``DASHBOARD_ENV`` so that ``prod`` can never be
    selected implicitly from the shell environment — only ``--env prod`` on the
    CLI can do that.
    """

    store = SecretStore()
    store.providers.append(EnvSecretProvider())

    bw = BitwardenSecretProvider()
    if bw.available():
        store.providers.append(bw)

    toml_path = root / "secrets.toml"
    if toml_path.exists():
        store.providers.append(TomlSecretProvider(toml_path, env=env))
    else:
        store.providers.append(FileSecretProvider(root / ".secrets"))

    cmd = os.environ.get("DASHBOARD_SECRET_CMD")
    if cmd:
        store.providers.append(CommandSecretProvider(cmd))

    return store


def resolve_secrets(text: str, store: SecretStore) -> str:
    """Replace all {{ secrets.KEY }} templates in text with resolved values.

    Raises ValueError if a referenced secret cannot be resolved.
    """
    missing = []

    def replacer(match):
        key = match.group(1)
        value = store.get(key)
        if not value:
            missing.append(key)
            return match.group(0)
        return value

    result = SECRET_PATTERN.sub(replacer, text)

    if missing:
        raise ValueError(f"Could not resolve secrets: {', '.join(missing)}")

    return result


def mask_value(value: str, visible: int = 4) -> str:
    """Return a masked version of a secret value for display."""
    if len(value) <= visible:
        return "*" * len(value)
    return value[:visible] + "*" * (len(value) - visible)
