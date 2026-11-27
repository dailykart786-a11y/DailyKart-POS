// PDF of a report table with jsPDF (already used for bills; loaded only when
// asked for): report details on top, header repeated on every page, page
// numbers. The built-in PDF font only has Latin letters, so names in other
// scripts are best printed with "Print" instead (the browser can save that
// as a PDF too).
import { ExportTable, cellText, columnLabel, columnsOf, isNumber } from "./table";

export async function downloadPdf(t: ExportTable) {
  if (!t.rows.length) return;
  const m = await import("jspdf");
  const JsPDF = m.jsPDF ?? m.default;
  const cols = columnsOf(t.rows);
  const doc = new JsPDF({ orientation: cols.length > 6 ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 32;
  const size = cols.length > 10 ? 7 : 8;
  const latin = (s: string) => s.replace(/₹/g, "Rs ").replace(/[–—]/g, "-").replace(/·/g, "|").replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "?");
  const head = cols.map((c) => latin(columnLabel(c)));
  const body = t.rows.map((r) => cols.map((c) => latin(cellText(r[c]))));
  const numeric = cols.map((c) => t.rows.some((r) => isNumber(r[c])) && t.rows.every((r) => r[c] === null || r[c] === undefined || r[c] === "" || isNumber(r[c])));

  doc.setFontSize(size);
  const natural = cols.map((_, i) => Math.min(170, Math.max(doc.getTextWidth(head[i]) + 8, ...body.slice(0, 300).map((r) => doc.getTextWidth(r[i]) + 8))));
  // Shrink columns to fit the page, or spread spare width across them
  const total = natural.reduce((a, b) => a + b, 0);
  const colW = natural.map((w) => (w * (W - 2 * M)) / total);

  let y = M;
  const meta = () => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text(latin(t.meta[0] ?? "DailyKart report"), M, y + 10); y += 22;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(90);
    for (const m of t.meta.slice(1)) { doc.text(latin(m), M, y); y += 11; }
    doc.setTextColor(0); y += 6;
  };
  const header = () => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(size);
    const lines = head.map((h, i) => doc.splitTextToSize(h, colW[i] - 6) as string[]);
    const h = Math.max(...lines.map((l) => l.length)) * (size + 2) + 6;
    doc.setFillColor(238, 241, 246); doc.rect(M, y, W - 2 * M, h, "F");
    let x = M;
    lines.forEach((l, i) => { doc.text(l, numeric[i] ? x + colW[i] - 3 : x + 3, y + size + 2, { align: numeric[i] ? "right" : "left" }); x += colW[i]; });
    y += h; doc.setFont("helvetica", "normal");
  };
  meta();
  header();
  for (const r of body) {
    const lines = r.map((v, i) => (numeric[i] ? [v] : (doc.splitTextToSize(v, colW[i] - 6) as string[]).slice(0, 4)));
    const h = Math.max(...lines.map((l) => l.length)) * (size + 2) + 5;
    if (y + h > H - M - 14) { doc.addPage(); y = M; header(); }
    let x = M;
    lines.forEach((l, i) => { doc.text(l, numeric[i] ? x + colW[i] - 3 : x + 3, y + size + 1, { align: numeric[i] ? "right" : "left" }); x += colW[i]; });
    y += h;
    doc.setDrawColor(225); doc.line(M, y - 1, W - M, y - 1);
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFontSize(7.5); doc.setTextColor(120);
    doc.text(`DailyKart POS | ${latin(t.meta[0]?.replace(/^DailyKart · /, "") ?? "")}`, M, H - 16);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 16, { align: "right" });
  }
  doc.save(`${t.name}.pdf`);
}
