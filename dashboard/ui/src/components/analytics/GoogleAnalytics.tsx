import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;

function loadGtag(measurementId: string) {
  if (window.gtag) {
    return;
  }

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer.push(args);
  };

  window.gtag('js', new Date());
  window.gtag('config', measurementId);
}

// Injects the Google tag (gtag.js) once and records a page_view on every
// client-side route change, since gtag's own pageview only fires on load.
export function GoogleAnalytics() {
  const location = useLocation();
  const loaded = useRef(false);

  useEffect(() => {
    if (!MEASUREMENT_ID || import.meta.env.DEV) {
      return;
    }
    if (!loaded.current) {
      loadGtag(MEASUREMENT_ID);
      loaded.current = true;
      return;
    }
    window.gtag?.('event', 'page_view', {
      page_path: location.pathname + location.search,
    });
  }, [location]);

  return null;
}
