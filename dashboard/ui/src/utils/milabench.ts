export const MILABENCH_GITHUB_REPO = 'https://github.com/mila-iqia/milabench';

/** True when commit looks like a real git SHA (not a placeholder). */
export function isMilabenchCommit(commit: string | null | undefined): boolean {
    if (!commit) return false;
    return /^[0-9a-f]{7,40}$/i.test(commit.trim());
}

export function milabenchCommitUrl(commit: string): string {
    return `${MILABENCH_GITHUB_REPO}/tree/${commit.trim()}`;
}

export function shortMilabenchCommit(commit: string, length = 8): string {
    return commit.trim().slice(0, length);
}
