import os

import pytest

from dashboard.server import migrations


@pytest.fixture(autouse=True)
def _clear_db_env(monkeypatch):
    for key in (
        "AUTO_MIGRATE",
        "DEV_MODE",
        "DATABASE_URI",
        "POSTGRES_HOST",
    ):
        monkeypatch.delenv(key, raising=False)


class TestShouldAutoMigrate:
    def test_localhost_with_dev_mode_defaults_on(self, monkeypatch):
        monkeypatch.setenv("POSTGRES_HOST", "localhost")
        assert migrations.should_auto_migrate() is True

    def test_remote_host_defaults_off(self, monkeypatch):
        monkeypatch.setenv("POSTGRES_HOST", "psql-milabench-dev.postgres.database.azure.com")
        monkeypatch.setenv("DEV_MODE", "true")
        assert migrations.should_auto_migrate() is False

    def test_explicit_auto_migrate_overrides_remote(self, monkeypatch):
        monkeypatch.setenv("POSTGRES_HOST", "psql-milabench-dev.postgres.database.azure.com")
        monkeypatch.setenv("AUTO_MIGRATE", "1")
        assert migrations.should_auto_migrate() is True

    def test_auto_migrate_disabled_on_localhost(self, monkeypatch):
        monkeypatch.setenv("POSTGRES_HOST", "localhost")
        monkeypatch.setenv("AUTO_MIGRATE", "0")
        assert migrations.should_auto_migrate() is False

    def test_dev_mode_off_on_localhost(self, monkeypatch):
        monkeypatch.setenv("POSTGRES_HOST", "localhost")
        monkeypatch.setenv("DEV_MODE", "false")
        assert migrations.should_auto_migrate() is False

    def test_database_uri_localhost(self, monkeypatch):
        monkeypatch.setenv(
            "DATABASE_URI",
            "postgresql://milabench_write:1234@127.0.0.1:5432/milabench",
        )
        assert migrations.is_local_dev_database() is True


class TestMigrationDatabaseUrl:
    def test_localhost_uses_app_role_even_with_admin_secrets(self, monkeypatch):
        monkeypatch.setenv("POSTGRES_HOST", "localhost")
        monkeypatch.setenv("POSTGRES_USER", "milabench_write")
        monkeypatch.setenv("POSTGRES_PSWD", "1234")
        monkeypatch.setenv("POSTGRES_ADMIN_USER", "pgadmin")
        monkeypatch.setenv("POSTGRES_ADMIN_PASSWORD", "prod-secret")

        url = migrations.migration_database_url()
        assert url.username == "milabench_write"
        assert url.password == "1234"
        assert url.host == "localhost"

    def test_remote_prefers_admin_when_configured(self, monkeypatch):
        monkeypatch.setenv("POSTGRES_HOST", "psql-milabench-dev.postgres.database.azure.com")
        monkeypatch.setenv("POSTGRES_USER", "milabench_write")
        monkeypatch.setenv("POSTGRES_PSWD", "app-secret")
        monkeypatch.setenv("POSTGRES_ADMIN_USER", "pgadmin")
        monkeypatch.setenv("POSTGRES_ADMIN_PASSWORD", "admin-secret")

        url = migrations.migration_database_url()
        assert url.username == "pgadmin"
        assert url.password == "admin-secret"
