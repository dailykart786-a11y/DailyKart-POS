import { useParams } from "react-router-dom";
import { ErrorState } from "@/components/feedback/ErrorState";
import { ERROR_CODES } from "@/components/feedback/errorCodes";

/** /error/400 ... /error/504: friendly pages the app can send people to. */
const ErrorPage = () => {
  const { code } = useParams();
  const n = Number(code);
  return <ErrorState code={ERROR_CODES[n] ? n : 404} fullScreen />;
};

export default ErrorPage;
