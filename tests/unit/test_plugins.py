import dashboard.plugins
from dashboard.core import discover_plugins


def test_plugins():
    plugins = discover_plugins(dashboard.plugins)

    assert len(plugins) == 1
