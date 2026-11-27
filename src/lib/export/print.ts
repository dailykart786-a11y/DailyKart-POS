// Print a report table from a hidden frame, so the page itself isn't
// disturbed. The browser's print dialog can also save it as a PDF, with
// every script (Hindi and others) shown correctly.
import { ExportTable, cellText, columnLabel, columnsOf, isNumber } from "./table";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function printTable(t: ExportTable) {
  if (!t.rows.length) return;
  const cols = columnsOf(t.rows);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.meta[0] ?? "Report")}</title><style>
    body{font:11px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif;color:#111;margin:16px}
    h1{font-size:16px;margin:0 0 4px} .m{color:#555;margin:0 0 1px}
    table{border-collapse:collapse;width:100%;margin-top:10px} th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}
    th{background:#eef1f6;font-weight:600} td.n,th.n{text-align:right;white-space:nowrap} thead{display:table-header-group} tr{page-break-inside:avoid}
    @page{margin:12mm}</style></head><body>
    <h1>${esc(t.meta[0] ?? "Report")}</h1>${t.meta.slice(1).map((m) => `<p class="m">${esc(m)}</p>`).join("")}
    <table><thead><tr>${cols.map((c) => `<th class="${t.rows.some((r) => isNumber(r[c])) ? "n" : ""}">${esc(columnLabel(c))}</th>`).join("")}</tr></thead>
    <tbody>${t.rows.map((r) => `<tr>${cols.map((c) => `<td class="${isNumber(r[c]) ? "n" : ""}">${esc(cellText(r[c]))}</td>`).join("")}</tr>`).join("")}</tbody></table>
    </body></html>`;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentWindow?.document;
  if (!doc) { frame.remove(); return; }
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  }, 150);
}
