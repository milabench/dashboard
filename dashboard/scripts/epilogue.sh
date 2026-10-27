# Default jobrunner epilogue
#
# Runs on the LOGIN NODE (which has internet), triggered over ssh by the compute
# node when the job exits. It is included in epilogue.sh after these variables are set:
#   JR_JOB_ID        internal job id
#   JR_JOB_DIR       job folder on the cluster (cwd)
#   JR_EXIT_CODE     exit code of the job script
#   JR_SLURM_JOB_ID  slurm job id
#
# Best effort: a failure here never changes the job's exit status.

echo "[epilogue] job $JR_JOB_ID (slurm $JR_SLURM_JOB_ID) exited with $JR_EXIT_CODE at $(date -Is)"

mkdir -p meta
{
    echo "exit_code=$JR_EXIT_CODE"
    echo "end_time=$(date -Is)"
} > meta/epilogue.txt

# Add bookkeeping that needs internet here, for example:
#   rsync -az output/ some-host:/archive/$JR_JOB_ID/
#   curl -fsS -X POST "$DASHBOARD_URL/api/..." -d "job=$JR_JOB_ID"
