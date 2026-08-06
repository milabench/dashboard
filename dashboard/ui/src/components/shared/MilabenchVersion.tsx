import { Box, Link, Text } from '@chakra-ui/react';
import {
    isMilabenchCommit,
    milabenchCommitUrl,
    shortMilabenchCommit,
} from '../../utils/milabench';

interface MilabenchVersionProps {
    tag?: string | null;
    commit?: string | null;
    /** Fallback when tag is missing */
    fallback?: string;
    tagFontSize?: string;
    commitFontSize?: string;
}

/**
 * Shows milabench git-describe tag with the short commit as a GitHub link underneath.
 */
export function MilabenchVersion({
    tag,
    commit,
    fallback = 'N/A',
    tagFontSize = 'sm',
    commitFontSize = 'xs',
}: MilabenchVersionProps) {
    const displayTag = tag?.trim() || fallback;
    const hasCommit = isMilabenchCommit(commit);

    return (
        <Box>
            <Text fontSize={tagFontSize}>{displayTag}</Text>
            {hasCommit && (
                <Link
                    href={milabenchCommitUrl(commit!)}
                    target="_blank"
                    rel="noopener noreferrer"
                    fontSize={commitFontSize}
                    fontFamily="mono"
                    color="blue.500"
                    _hover={{ textDecoration: 'underline' }}
                >
                    {shortMilabenchCommit(commit!)}
                </Link>
            )}
        </Box>
    );
}
