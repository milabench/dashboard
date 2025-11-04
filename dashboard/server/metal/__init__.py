#
#  Run on baremetal machine
#
#   We can still ssh and run things but we need to be fire and forget
#
#     Options:
#
#       ssh node "nohup milabench > output.log 2>&1 &"
#       ssh node "echo 'milabench' | at now"
#       ssh node "systemd-run --unit=myjob.service --user long_command"
#
#       ssh node "ps -ef | grep milabench"
#


class Baremetal:
    # Schedule a job
    def sbatch():
        pass

    # List running jobs
    def squeue():
        pass

    # Get accounting info about a job
    def sacct():
        pass

    # Get info about a job
    def sinfo():
        pass