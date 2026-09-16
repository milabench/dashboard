"""Factory for the three dashboard trust-tier Blueprints.

PUBLIC routes are always registered (including on the deployed public site).
DEV and ADMIN routes are only registered when ``DEV_MODE`` is on (see
``view.py::view_server``). Experimental routes can also be registered on
the preview tier when ``PREVIEW_SECRET`` is set — those require a preview
token and are not linked from the public UI.

``make_blueprints()`` returns a *fresh* set of Blueprint objects on every
call. Flask blueprints refuse further ``@bp.route`` registrations once
they've been registered to an app once (``_got_registered_once``), so a
process that builds more than one app in its lifetime — the test suite,
or any script calling ``view_server()`` twice — must not share blueprint
instances across those apps.
"""

from flask import Blueprint


def make_blueprints():
    return (
        Blueprint("public", __name__),
        Blueprint("dev", __name__),
        Blueprint("admin", __name__),
    )
