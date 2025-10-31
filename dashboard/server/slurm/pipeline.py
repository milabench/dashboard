from __future__ import annotations

from .constant import *


class JobNode:
    def gen(self, depends_event=AFTER_OK, depends_on=None):
        pass

    @staticmethod
    def from_json(data):
        def make_jobs(data):
            return [JobNode.from_json(job) for job in data.pop("jobs")]

        match data.pop("type"):
            case "job":
                return Job(**data)
            case "parallel":
                return Parallel(*make_jobs(data), **data)
            case "sequential":
                return Sequential(*make_jobs(data), **data)
            case "pipeline":
                return Pipeline(job_definition=JobNode.from_json(data.pop("definition")), **data)
            case unknown_type:
                raise RuntimeError(f"Unknown type: {unknown_type}")


class Pipeline:
    """The job runner define a dependency between jobs and schedule them to slurm.
    It is able to launch a job on the cluster.

    Its most interesting feature is being able to track which job failed and which were successful
    and only trigger the failed one.

    To do so it simply iterate over the job tree and mark the one failed to retry and skip the successful ones.

    The pipeline runs alterate the folder structure to make the output fs reflect the job dependencies

    """

    def __init__(self, name, job_definition, job_id=None):
        self.definition: JobNode = job_definition
        self.name = name

        # A pipeline run is something only known to the job runner and as such does not have Slurm Job ID
        # But it has a jobs id
        self.job_id = job_id

    def output_dir(self, root=JOBRUNNER_WORKDIR):
        return os.path.join(root, self.name)

    def schedule(self):
        context = {
            "output": [self.output_dir()]
        }

        self.definition.gen(context)

    def rerun(self) -> Pipeline:
        # traverse the job definition and create a new one
        pass

    def __json__(self):
        return {
            "type": "pipeline",
            "definition": self.definition.__json__(),
            "job_id": self.job_id,
            "name": self.name
        }


class Job(JobNode):
    def __init__(self, script, profile, job_id=None, slurm_jobid=None):
        self.script = script
        self.profile = profile
        self.job_id = job_id
        self.slurm_jobid = slurm_jobid

    def output_dir(self, root=JOBRUNNER_WORKDIR):
        return os.path.join(root, self.job_id)

    def gen(self, context, depends_event=AFTER_OK, depends_on=None):
        sbatch_args = []

        if depends_on is not None:
            sbatch_args.append(f"--dependency={depends_event}:{depends_on}")

        # fetch resource profile
        # ...

        # fetch script
        # ...

        # Create the job folder locally and rsync it to remote

        # Build the sbatch command

        # Submit the job, get a slurm_id for dependencies if any
        return self.slurm_jobid

    def __json__(self):
        return {
            "type": "job",
            "script": self.script,
            "profile": self.profile,
            "job_id": self.job_id,
            "slurm_jobid": self.slurm_jobid
        }


class Sequential(JobNode):
    def __init__(self, *jobs, name='S'):
        self.name = name
        self.job_id = None
        self.jobs = jobs

    def output_dir(self, root):
        return os.path.join(root, self.name)

    def gen(self, depends_on=None):
        job_id = depends_on

        for job in self.jobs:
            job_id = job.gen(depends_on=job_id)

        return job_id

    def __json__(self):
        return {
            "type": "sequential",
            "name": self.name,
            "jobs": [
                job.__json__() for job in self.jobs
            ]
        }


class Parallel(JobNode):
    def __init__(self, *jobs, name='P'):
        self.name = name
        self.jobs = jobs

    def output_dir(self, root):
        return os.path.join(root, self.name)

    def gen(self, depends_on=None):
        job_ids = []
        for job in self.jobs:
            job_ids.append(job.gen(depends_on=depends_on))

        return ':'.join(job_ids)

    def __json__(self):
        return {
            "type": "parallel",
            "name": self.name,
            "jobs": [
                job.__json__() for job in self.jobs
            ]
        }

#
# Standard milabench run
#
standard_run = Sequential(
    Job("pin", "pin"),
    Job("install", "install"),
    Job("prepare", "prepare"),
    Parallel(
        Job("A100l", "run"),
        Job("A100", "run"),
        Job("A6000", "run"),
        Job("H100", "run"),
        Job("L40S", "run"),
        Job("rtx8000", "run"),
        Job("v100", "run"),
    )
)
