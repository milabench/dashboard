# --- jobrunner epilogue: run bookkeeping on the login node (has internet) ---
__jr_epilogue() {
    __jr_rc=$?
    trap - EXIT
    [ -n "$__jr_proxy_pid" ] && kill $__jr_proxy_pid 2>/dev/null
    timeout 120 ssh -o BatchMode=yes -o ConnectTimeout=20 @LOGIN_HOST@ \
        "JR_EXIT_CODE=$__jr_rc JR_SLURM_JOB_ID=$SLURM_JOB_ID bash @JOB_DIR@/epilogue.sh" || true
    exit $__jr_rc
}
trap __jr_epilogue EXIT
