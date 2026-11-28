// Dashboard colours, taken from the DailyKart logo (dark navy and gold) and the app theme.
export const BRAND = {
  navy: "#13213a",
  navyLight: "#1f3459",
  gold: "#f5b301",
  goldSoft: "#fde68a",
};

/** Series colours: navy, gold, green, sky, rose, violet, orange, slate. */
export const SERIES = ["hsl(217 80% 45%)", "hsl(43 96% 50%)", "hsl(142 65% 38%)", "hsl(199 85% 48%)", "hsl(350 75% 55%)", "hsl(262 55% 58%)", "hsl(25 90% 55%)", "hsl(215 16% 60%)"];

export const axisStyle = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

export const tooltipStyle = {
  contentStyle: {
    background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 10,
    fontSize: 12, color: "hsl(var(--popover-foreground))", boxShadow: "0 8px 24px rgb(0 0 0 / 0.12)",
  },
  labelStyle: { color: "hsl(var(--popover-foreground))", fontWeight: 600 },
};

export const darkTooltipStyle = {
  contentStyle: { background: BRAND.navy, border: `1px solid ${BRAND.gold}`, borderRadius: 10, fontSize: 12, color: "#fff" },
  labelStyle: { color: BRAND.goldSoft, fontWeight: 600 },
  itemStyle: { color: "#fff" },
};
