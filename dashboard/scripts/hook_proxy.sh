# --- jobrunner proxy: internet on the compute node through the login node ---
__jr_port=$((20000 + ${SLURM_JOB_ID:-$$} % 20000))
ssh -N -D 127.0.0.1:$__jr_port -o BatchMode=yes -o StrictHostKeyChecking=No -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 @LOGIN_HOST@ &
__jr_proxy_pid=$!
for __jr_i in $(seq 1 20); do
    (exec 3<>/dev/tcp/127.0.0.1/$__jr_port) 2>/dev/null && break
    sleep 0.5
done
export ALL_PROXY=socks5h://127.0.0.1:$__jr_port
export HTTPS_PROXY=$ALL_PROXY HTTP_PROXY=$ALL_PROXY
export https_proxy=$ALL_PROXY http_proxy=$ALL_PROXY
export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.proxy GIT_CONFIG_VALUE_0=$ALL_PROXY
