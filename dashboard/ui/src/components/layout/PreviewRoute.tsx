import { Navigate, useLocation } from 'react-router-dom';
import { useHealth } from '../../contexts/HealthContext';
import { usePreview } from '../../contexts/ViewModeContext';

interface PreviewRouteProps {
    children: React.ReactNode;
}

/** Gate experimental pages: open in dev mode, or after preview unlock on prod. */
export function PreviewRoute({ children }: PreviewRouteProps) {
    const { devMode } = useHealth();
    const { previewAvailable, previewUnlocked } = usePreview();
    const location = useLocation();

    if (devMode || previewUnlocked) {
        return <>{children}</>;
    }

    if (previewAvailable) {
        return <Navigate to="/preview" replace state={{ from: location.pathname }} />;
    }

    return <Navigate to="/" replace />;
}
