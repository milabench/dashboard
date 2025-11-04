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

setup:
	($(CONDA_ACTIVATE) py312; )

front:
	cd dashboard/ui && npm run dev

back:
	($(CONDA_ACTIVATE) py312; POSTGRES_USER=milabench_write POSTGRES_PSWD=1234 flask --app dashboard.server.view:main run --host=0.0.0.0 --debug)
