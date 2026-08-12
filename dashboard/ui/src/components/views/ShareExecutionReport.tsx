import { useParams } from 'react-router-dom';
import { ExecutionReport } from './ExecutionReport';

export const ShareExecutionReport = () => {
    const { token } = useParams<{ token: string }>();
    if (!token) {
        return null;
    }
    return <ExecutionReport shareToken={token} />;
};
