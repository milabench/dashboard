import os


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
REPOSITORY = os.path.join(ROOT, "milabench")


# This should be outside
CLUSTERS = os.path.join(REPOSITORY, "config", "clusters", "clusters.yml")

# Repo templates
SLURM_PROFILES = os.path.join(REPOSITORY, 'config', 'clusters', 'slurm.yaml')
SLURM_TEMPLATES = os.path.join(REPOSITORY, 'scripts', 'slurm')
PIPELINE_DEF = os.path.join(REPOSITORY, 'scripts', 'pipeline')

JOBRUNNER_WORKDIR = "scratch/jobrunner"
JOBRUNNER_LOCAL_CACHE =  os.path.abspath(os.path.join(ROOT, 'data'))


OR = "?"
AND = ","

AFTER = "after"
AFTER_OK = "afterok"
AFTER_ANY = "afterany"
AFTER_NOT_OK = "afternotok"
SINGLETON = "singleton"
