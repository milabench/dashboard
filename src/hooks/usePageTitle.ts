import { useEffect } from 'react';

/**
 * Custom hook to manage page titles dynamically
 * @param title - The title to set for the current page
 * @param suffix - Optional suffix to append (defaults to "Milabench Dashboard")
 */
export const usePageTitle = (title: string, suffix: string = "Milabench Dashboard") => {
    useEffect(() => {
        const fullTitle = title ? `${title} - ${suffix}` : suffix;
        document.title = fullTitle;

        // Cleanup function to reset title when component unmounts
        return () => {
            document.title = suffix;
        };
    }, [title, suffix]);
};

/**
 * Get the appropriate title for a route path
 * @param pathname - The current route pathname
 * @returns The appropriate title for the route
 */
export const getTitleForRoute = (pathname: string): string => {
    if (pathname === '/') return 'Dashboard';
    if (pathname === '/executions') return 'Latest Executions';
    if (pathname.startsWith('/executions/')) return 'Execution Report';
    if (pathname === '/pivot') return 'Pivot View';
    if (pathname === '/explorer') return 'Explorer';
    if (pathname === '/scaling') return 'Scaling';
    if (pathname === '/grouped') return 'Grouped View';
    if (pathname === '/profile') return 'Profiles';
    if (pathname === '/saved-queries') return 'Saved Queries';
    if (pathname.startsWith('/jobrunner/')) return 'Job Details';
    if (pathname.startsWith('/joblogs/')) return 'Job Logs';

    // Default fallback
    return 'Milabench Dashboard';
};