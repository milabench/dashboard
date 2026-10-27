# Default jobrunner prologue
#
# Runs on the LOGIN NODE (which has internet) right before the job is submitted.
# It is included in prologue.sh after these variables are exported:
#   JR_JOB_ID   internal job id
#   JR_JOB_DIR  job folder on the cluster (cwd)
#
# The script runs with `set -e`: a failure here aborts the submission.

echo "[prologue] job $JR_JOB_ID on $(hostname) at $(date -Is)"

# Record where/when the job was submitted from
mkdir -p meta
{
    echo "submit_host=$(hostname)"
    echo "submit_time=$(date -Is)"
    echo "user=$USER"
} > meta/prologue.txt

# Add setup that needs internet here, for example:
#   git -C "$HOME/milabench" fetch --all
#   uv pip install -r requirements.txt
