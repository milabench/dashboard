dashboard
=========

|pypi| |py_versions| |codecov| |docs| |tests| |style|

.. |pypi| image:: https://img.shields.io/pypi/v/dashboard.svg
    :target: https://pypi.python.org/pypi/dashboard
    :alt: Current PyPi Version

.. |py_versions| image:: https://img.shields.io/pypi/pyversions/dashboard.svg
    :target: https://pypi.python.org/pypi/dashboard
    :alt: Supported Python Versions

.. |codecov| image:: https://codecov.io/gh/milabench/dashboard/branch/master/graph/badge.svg?token=40Cr8V87HI
   :target: https://codecov.io/gh/milabench/dashboard

.. |docs| image:: https://readthedocs.org/projects/dashboard/badge/?version=latest
   :target:  https://dashboard.readthedocs.io/en/latest/?badge=latest

.. |tests| image:: https://github.com/milabench/dashboard/actions/workflows/test.yml/badge.svg?branch=master
   :target: https://github.com/milabench/dashboard/actions/workflows/test.yml

.. |style| image:: https://github.com/milabench/dashboard/actions/workflows/style.yml/badge.svg?branch=master
   :target: https://github.com/milabench/dashboard/actions/workflows/style.yml


.. code-block:: bash

   git clone https://github.com/milabench/dashboard.git
   
   cd dashboard
   conda create -n py312 PYTHON=3.12
   conda activate py312
   pip instal -e .
   make front
   make back

Features
--------

* Pivot Table
* Slurm integration
   * Job Tracking
   * Job Submit
* Plot Generation
* 