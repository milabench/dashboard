import type { TimelineVllmReport, TimelineBucketAggregate, TimelineDistStats, TimelineMilabenchRateStats } from '../services/api';

function pad(s: string | number, width: number): string {
    const str = String(s);
    return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

function center(s: string, width: number, fill: string): string {
    const total = width - s.length;
    if (total <= 0) return s;
    const left = Math.floor(total / 2);
    const right = total - left;
    return fill.repeat(left) + s + fill.repeat(right);
}

function line(label: string, value: number | string, isInt = false): string {
    const v = isInt ? String(value) : Number(value).toFixed(2);
    return pad(label, 40) + ' ' + pad(v, 10);
}

function rawLine(label: string, value: string): string {
    return pad(label, 40) + ' ' + pad(value, 18);
}

// Python's _dist_stats() returns raw units (seconds for latencies, tok/s
// already for prefill) — scale=1000 converts s -> ms for display here.
function distSection(
    lines: string[],
    short: string,
    header: string,
    stats: TimelineDistStats | null | undefined,
    unit: string,
    scale = 1,
) {
    lines.push(center(header, 50, '-'));
    if (!stats) {
        lines.push('  (no samples)');
        return;
    }
    lines.push(rawLine(`Mean ± SD ${short} (${unit}):`, `${(stats.mean * scale).toFixed(2)} ± ${(stats.std * scale).toFixed(2)}`));
    lines.push(line(`Median ${short} (${unit}):`, stats.median * scale));
    for (const [p, v] of stats.percentiles) {
        lines.push(line(`P${Math.round(p * 100)} ${short} (${unit}):`, v * scale));
    }
}

export function formatVllmReport(data: TimelineVllmReport): string {
    const lines: string[] = [];
    lines.push(center(' Serving Benchmark Result ', 50, '='));
    lines.push(line('Successful requests:', data.completed, true));
    lines.push(line('Failed requests:', data.failed, true));
    if (!data.completed) {
        lines.push('(no successful requests — cannot compute aggregate stats)');
        return lines.join('\n');
    }
    lines.push(line('Benchmark duration (s):', data.dur_s ?? 0));
    lines.push(line('Total input tokens:', data.total_input ?? 0, true));
    lines.push(line('Total generated tokens:', data.total_output ?? 0, true));
    lines.push(line('Request throughput (req/s):', data.request_throughput ?? 0));
    lines.push(line('Output token throughput (tok/s):', data.output_throughput ?? 0));
    lines.push(line('Peak output token throughput (tok/s):', data.max_output_tokens_per_s ?? 0));
    lines.push(line('Peak concurrent requests:', data.max_concurrent_requests ?? 0, true));
    lines.push(line('Total token throughput (tok/s):', data.total_token_throughput ?? 0));

    // Named distinctly from the throughput chart's "system prefill tok/s"
    // line: this is a per-REQUEST rate (that request's own prompt_len /
    // its own ttft), not a system-wide bucketed aggregate — the two are
    // not meant to be numerically comparable, so they shouldn't share a
    // label either.
    distSection(lines, 'Prefill Speed', 'Per-Request Prefill Speed (tok/s = prompt_len / ttft)', data.prefill, 'tok/s', 1);
    distSection(lines, 'TTFT', 'Time to First Token', data.ttft, 'ms', 1000);
    distSection(lines, 'TPOT', 'Time per Output Token (excl. 1st token)', data.tpot, 'ms', 1000);
    distSection(lines, 'ITL', 'Inter-token Latency', data.itl, 'ms', 1000);
    distSection(lines, 'E2EL', 'End-to-end Latency', data.e2el, 'ms', 1000);

    lines.push('='.repeat(50));
    lines.push('');
    lines.push('^ one number per metric for the ENTIRE run — no visibility');
    lines.push('  into whether performance was steady, ramping, or degrading.');
    return lines.join('\n');
}

// milabench itself never sees a windowed system aggregate — each bucket's
// `rate` is pushed to it as one raw sample (benchmarks/vllm/main.py: `for
// sampled_obs in timeline(...): push_metric(**sampled_obs)`). That sample
// stream isn't tagged task="train", so milabench's own summary.py never
// actually runs its outlier-trimmed aggregation on it (that only fires for
// "rate" samples tagged task="train") — it just collects the raw values.
// This section reports that same raw distribution, untrimmed.
function milabenchRateSection(lines: string[], stats: TimelineMilabenchRateStats | null | undefined) {
    lines.push(center('Milabench-style Sampled Throughput (tok/s)', 50, '-'));
    if (!stats) {
        lines.push('  (no samples)');
        return;
    }
    lines.push(line('Bucket samples used:', stats.n, true));
    lines.push(rawLine('Mean ± SD (tok/s):', `${stats.mean.toFixed(2)} ± ${stats.std.toFixed(2)}`));
    lines.push(line('Median (tok/s):', stats.median));
    for (const [p, v] of stats.percentiles) {
        lines.push(line(`P${Math.round(p * 100)} (tok/s):`, v));
    }
    lines.push(line('Min (tok/s):', stats.min));
    lines.push(line('Max (tok/s):', stats.max));
}

export function formatBucketAggregateReport(data: TimelineBucketAggregate): string {
    const lines: string[] = [];
    lines.push(center(' Bucket Aggregate Result ', 50, '='));
    lines.push(line('Successful requests:', data.completed, true));
    lines.push(line('Failed requests:', data.failed, true));
    if (!data.completed) {
        lines.push('(no successful requests — cannot compute aggregate stats)');
        return lines.join('\n');
    }
    lines.push(line('Benchmark duration (s):', data.dur_s ?? 0));
    lines.push(line('Total input tokens:', data.total_input ?? 0, true));
    lines.push(line('Total generated tokens:', data.total_output ?? 0, true));
    lines.push(line('Request throughput (req/s):', data.request_throughput ?? 0));
    lines.push(line('Output token throughput (tok/s):', data.output_throughput ?? 0));
    lines.push(line(`Peak system prefill tok/s (ttft window):`, data.peak_bucket_input_rate ?? 0));
    lines.push(line(`Peak output tok/s (${(data.bucket_duration ?? 0).toFixed(2)}s window):`, data.peak_bucket_output_rate ?? 0));
    lines.push(line('Peak concurrent requests (bucket):', data.peak_bucket_active_jobs ?? 0, true));
    lines.push(line('Total token throughput (tok/s):', data.total_token_throughput ?? 0));

    milabenchRateSection(lines, data.milabench_rate);

    // Named distinctly from the throughput chart's "system prefill tok/s"
    // line: this is a per-REQUEST rate (that request's own prompt_len /
    // its own ttft), not a system-wide bucketed aggregate — the two are
    // not meant to be numerically comparable, so they shouldn't share a
    // label either.
    distSection(lines, 'Prefill Speed', 'Per-Request Prefill Speed (tok/s = prompt_len / ttft)', data.prefill, 'tok/s', 1);
    distSection(lines, 'TTFT', 'Time to First Token', data.ttft, 'ms', 1000);
    distSection(lines, 'TPOT', 'Time per Output Token (excl. 1st token)', data.tpot, 'ms', 1000);
    distSection(lines, 'ITL', 'Inter-token Latency', data.itl, 'ms', 1000);
    distSection(lines, 'E2EL', 'End-to-end Latency', data.e2el, 'ms', 1000);

    lines.push('='.repeat(50));
    lines.push('');
    lines.push('^ "Milabench-style Sampled Throughput" is the raw distribution of the');
    lines.push('  same per-bucket weighted tok/s samples benchmarks/vllm/main.py pushes');
    lines.push('  to milabench (push_metric per bucket) — untrimmed, since that stream');
    lines.push('  isn\'t tagged task="train" and so never reaches milabench\'s own');
    lines.push('  outlier-trimmed \'rate\' aggregation in practice.');
    lines.push(`^ pools the ${data.num_buckets ?? 0} buckets' raw TTFT/ITL samples back into`);
    lines.push('  one distribution; TPOT/E2EL aren\'t localized per-bucket but');
    lines.push('  are computed over this SAME request set — the ramp-trimmed');
    lines.push('  subset when trim is on — so they show the trim\'s impact');
    lines.push('  against the vLLM panel, which always uses every request.');
    lines.push('  Peak fields differ because they use a bucket-width window');
    lines.push('  instead of a 1-second window.');
    return lines.join('\n');
}
