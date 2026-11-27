import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { ErrorState } from "@/components/feedback/ErrorState";
import { logError } from "@/lib/errorLog";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    logError("Page not found", location.pathname);
  }, [location.pathname]);

  return <ErrorState code={404} fullScreen />;
};

export default NotFound;
