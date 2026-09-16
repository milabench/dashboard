import ReactDOM from 'react-dom/client';
import App from './App';
import { installPreviewAuthInterceptor } from './services/previewAuth';
import './theme.css';
import './index.css';

installPreviewAuthInterceptor();

ReactDOM.createRoot(document.getElementById('root')!).render(
  //<React.StrictMode>
    <App />
  // </React.StrictMode>
);
