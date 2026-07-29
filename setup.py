#!/usr/bin/env python
from pathlib import Path

from setuptools import setup, find_packages

with open("dashboard/server/__init__.py") as file:
    for line in file.readlines():
        if "version" in line:
            version = line.split("=")[1].strip().replace('"', "")
            break

extra_requires = {"plugins": ["importlib_resources"]}
extra_requires["all"] = sorted(set(sum(extra_requires.values(), [])))

if __name__ == "__main__":
    setup(
        name="dashboard",
        version=version,
        extras_require=extra_requires,
        description="Dashboard for milabench",
        long_description=(Path(__file__).parent / "README.rst").read_text(),
        author="Pierre Delaunay",
        author_email="pierre.delaunay@mila.quebec",
        license="BSD 3-Clause License",
        url="https://dashboard.readthedocs.io",
        classifiers=[
            "License :: OSI Approved :: BSD License",
            "Programming Language :: Python :: 3.10",
            "Programming Language :: Python :: 3.11",
            "Programming Language :: Python :: 3.12",
            "Operating System :: OS Independent",
        ],
        packages=find_packages(exclude=["tests", "tests.*", "examples"]),
        entry_points={
            "console_scripts": [
                "dashboard=dashboard.cli:main_force",
            ],
        },
        setup_requires=["setuptools"],
        install_requires=[
            "importlib_resources",
            "sqlalchemy",
            "pandas",
            "flask",
            "flask_caching",
            "flask-socketio",
            "psycopg2-binary",
            "altair",
            "waitress",
            "alembic",
            "apscheduler",
            "croniter",
            "iguane",
        ],
        package_data={
            "dashboard": [
                "static/**/*",
                "data/*",
                "data/scaling/*",
                "alembic.ini",
                "alembic/**/*",
            ],
        },
        include_package_data=True,
    )
