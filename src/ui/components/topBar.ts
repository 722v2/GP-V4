import type { AppConfig } from "../../config/AppConfig.js";

export function renderTopBar(cfg: AppConfig): string {
  return `
  <!-- Top Operator Market & System Telemetry Header -->
  <header class="h-14 border-b border-slate-800 bg-[#090D15] px-3 md:px-5 flex items-center justify-between z-30 shrink-0 select-none font-mono">
    
    <!-- Left: Brand + Environment + Market Data State -->
    <div class="flex items-center gap-3 sm:gap-4 overflow-hidden">
      <!-- Mobile Drawer Toggle -->
      <button id="btnMobileDrawer" onclick="toggleMobileDrawer()" class="md:hidden p-1.5 text-slate-400 hover:text-white rounded border border-slate-800 bg-slate-900 focus:outline-none" aria-label="Toggle Navigation">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
      </button>

      <!-- Logo / Title -->
      <div class="flex items-center gap-2">
        <div class="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)] animate-pulse"></div>
        <span class="font-bold tracking-wider text-base text-white">GP-V4</span>
        <span class="text-[9px] text-amber-400 bg-amber-950/80 border border-amber-800/80 px-1.5 py-0.2 rounded font-bold uppercase hidden sm:inline">OPERATOR TERMINAL</span>
        <span class="text-[9px] text-slate-400 bg-slate-900 border border-slate-800 px-1.5 py-0.2 rounded font-semibold hidden md:inline">DEV / TEST</span>
      </div>

      <div class="h-4 w-px bg-slate-800 hidden sm:block"></div>

      <!-- Market Telemetry: XAU/USD, Price, Bid/Ask, Spread -->
      <div class="flex items-center gap-2.5 sm:gap-3 text-xs">
        <div class="flex items-baseline gap-1.5">
          <span class="font-bold text-amber-400 text-sm tracking-tight" id="topSymbol">XAU/USD</span>
          <span class="text-sm sm:text-base font-bold text-white tracking-wider" id="topPrice">UNAVAILABLE</span>
          <span class="text-[9px] px-1 py-0.2 rounded font-semibold bg-slate-900 text-slate-400 border border-slate-800" id="topPriceSource">NO LIVE FEED</span>
        </div>

        <div class="hidden xl:flex items-center gap-2.5 text-[11px] text-slate-400 bg-[#070A10] px-2.5 py-1 rounded border border-slate-850">
          <div><span class="text-slate-500">BID: </span><span class="text-slate-200 font-bold" id="topBid">--.--</span></div>
          <div class="w-px h-3 bg-slate-800"></div>
          <div><span class="text-slate-500">ASK: </span><span class="text-slate-200 font-bold" id="topAsk">--.--</span></div>
          <div class="w-px h-3 bg-slate-800"></div>
          <div><span class="text-slate-500">SPREAD: </span><span class="text-amber-400 font-bold" id="topSpread">-- pts</span></div>
        </div>
      </div>
    </div>

    <!-- Right: Operational Gating & Integration Truth States -->
    <div class="flex items-center gap-2 sm:gap-2.5 text-xs">
      
      <!-- Market Session Badge -->
      <div class="hidden lg:flex items-center gap-1.5 px-2 py-1 rounded bg-[#070A10] border border-slate-850 text-slate-300 text-[11px]">
        <span class="text-slate-500">SESSION:</span>
        <span class="text-cyan-400 font-semibold" id="topSession">--</span>
      </div>

      <!-- Integrations Truth Pills (Compact) -->
      <div class="hidden 2xl:flex items-center gap-1.5 text-[10px] text-slate-400 bg-[#070A10] px-2 py-1 rounded border border-slate-850">
        <span>BIQUITI: <strong id="topBiquitiStatus" class="text-slate-500">NOT CONNECTED</strong></span>
        <span class="text-slate-700">&bull;</span>
        <span>AI: <strong id="topNovitaStatus" class="text-slate-500">NOT CONNECTED</strong></span>
        <span class="text-slate-700">&bull;</span>
        <span>SUPABASE: <strong id="topSupabaseStatus" class="text-slate-500">IN-MEMORY</strong></span>
        <span class="text-slate-700">&bull;</span>
        <span>TELEGRAM: <strong id="topTelegramStatus" class="text-slate-500">NOT CONNECTED</strong></span>
      </div>

      <!-- Mode Badge -->
      <div class="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
        <span class="text-slate-500 hidden sm:inline">MODE: </span>
        <span class="text-amber-300 font-bold uppercase" id="topMode">${cfg.mode}</span>
      </div>

      <!-- Kill Switch Safety Quick Pill -->
      <button onclick="switchTab('risk')" id="topKsButton" class="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-[11px] hover:bg-emerald-900/60 transition" title="Kill Switch Safety State">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400" id="topKsDot"></span>
        <span class="font-bold" id="topKsText">SAFE</span>
      </button>

    </div>
  </header>
  `;
}
