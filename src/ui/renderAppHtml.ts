import type { AppConfig } from "../config/AppConfig.js";
import { renderTopBar } from "./components/topBar.js";
import { renderSidebar } from "./components/sidebar.js";
import { renderDashboardView } from "./views/dashboardView.js";
import { renderMarketView } from "./views/marketView.js";
import { renderScannerView } from "./views/scannerView.js";
import { renderSetupsView } from "./views/setupsView.js";
import { renderSignalsView } from "./views/signalsView.js";
import { renderTradesView } from "./views/tradesView.js";
import { renderRiskView } from "./views/riskView.js";
import { renderAiDecisionsView } from "./views/aiDecisionsView.js";
import { renderBacktestView } from "./views/backtestView.js";
import { renderSystemView } from "./views/systemView.js";
import { renderMt5View } from "./views/mt5View.js";
import { renderSettingsView } from "./views/settingsView.js";
import { renderTelegramView } from "./views/telegramView.js";
import { renderClientScript } from "./clientScript.js";

export function renderAppHtml(cfg: AppConfig): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl" class="h-full bg-[#070A10] text-slate-100 antialiased selection:bg-amber-500 selection:text-black">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>GP-V4 — منصة التداول والعمليات المركزية XAU/USD</title>
  <meta name="description" content="GP-V4 Dark Trading Terminal for XAU/USD analysis, deterministic setups, and risk-gated execution.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            terminal: {
              base: '#070A10',
              surface: '#090D15',
              card: '#0D121D',
              border: '#1E293B',
              borderLight: '#334155',
            }
          },
          fontFamily: {
            mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
            sans: ['Cairo', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif']
          }
        }
      }
    }
  </script>
  <style>
    /* Professional Trading Terminal Scrollbars */
    ::-webkit-scrollbar {
      width: 5px;
      height: 5px;
    }
    ::-webkit-scrollbar-track {
      background: #070A10;
    }
    ::-webkit-scrollbar-thumb {
      background: #1E293B;
      border-radius: 2px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: #334155;
    }
    /* Tabular figures for rapid readability */
    .font-mono, td, th {
      font-variant-numeric: tabular-nums;
    }
  </style>
</head>
<body class="h-full flex flex-col font-sans bg-[#070A10] text-slate-200 overflow-hidden select-none">

  <!-- Top Real-Time Telemetry Bar -->
  ${renderTopBar(cfg)}

  <!-- Main Terminal Workspace (Sidebar + Scrollable View Container) -->
  <div class="flex-1 flex overflow-hidden relative">

    <!-- Compact Desktop Sidebar & Mobile Drawers -->
    ${renderSidebar()}

    <!-- Main Dynamic Content Workspace -->
    <main id="mainWorkspace" class="flex-1 overflow-y-auto p-2.5 sm:p-3.5 md:p-4 pb-16 md:pb-6 space-y-4">
      
      <!-- 1. Central Trading Terminal Dashboard (Default Active View) -->
      ${renderDashboardView()}

      <!-- 2. Market Telemetry & Liquidity View -->
      ${renderMarketView()}

      <!-- 3. Scanner 30-Run History View -->
      ${renderScannerView()}

      <!-- 4. Deterministic Setups Ledger View -->
      ${renderSetupsView()}

      <!-- 5. Signals Ledger View -->
      ${renderSignalsView()}

      <!-- 6. Active & Closed Trades View -->
      ${renderTradesView()}

      <!-- 7. Risk, Exposure & Kill Switch View -->
      ${renderRiskView()}

      <!-- 8. AI Advisory Decisions View -->
      ${renderAiDecisionsView()}

      <!-- 9. Backtest & Replay Simulator View -->
      ${renderBacktestView()}

      <!-- 10. System Health & Reconciliation View -->
      ${renderSystemView()}

      <!-- 11. MT5 Real Broker & Account View -->
      ${renderMt5View()}

      <!-- 12. Telegram Operations & Notifications View -->
      ${renderTelegramView()}

      <!-- 13. Operator Settings & Config View -->
      ${renderSettingsView()}

      <!-- Footer Terminal Telemetry & Clean Slate Verification Metadata -->
      <footer class="pt-4 pb-2 border-t border-slate-900 text-[10px] text-slate-500 flex flex-wrap items-center justify-between gap-2 font-mono">
        <div class="flex items-center gap-2">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          <span>GP-V4 AUTHORITATIVE ENGINE &bull; ${cfg.symbols.join(", ")} &bull; ${cfg.mode}</span>
        </div>
        <div class="text-slate-600">
          <span class="text-slate-600">مرحلة التطهير وإعادة الهيكلة</span> &bull; 
          <span class="text-slate-600 font-semibold">CLEAN SLATE: OLD UI REMOVED</span> &bull; REBUILT FROM SCRATCH
        </div>
      </footer>

    </main>

  </div>

  <!-- Real-Time Trading Terminal Client Logic -->
  <script>
    ${renderClientScript()}
  </script>
</body>
</html>`;
}
