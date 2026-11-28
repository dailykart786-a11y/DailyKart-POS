// When a report's database function hasn't been added yet, show a note on
// that report only, instead of switching the whole page to the old one.
import { useState } from "react";
import { NoData } from "./shared";

export function NeedsUpdate({ file }: { file: string }) {
  return (
    <NoData
      title="One-time database update needed"
      description={`This report needs ${file} (also at the end of dailykart-updates.sql). Run it once in the Supabase SQL Editor and reload.`}
    />
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMissing(): [boolean, () => void] {
  const [missing, setMissing] = useState(false);
  return [missing, () => setMissing(true)];
}
