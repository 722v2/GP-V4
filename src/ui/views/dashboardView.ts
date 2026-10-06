import { ICONS } from "../theme.js";

export function renderDashboardView(): string {
  return `
  <!-- ========================================================================= -->
  <!-- VIEW: DASHBOARD (لوحة العمليات والتحكم المركزي) -->
  <!-- ========================================================================= -->
  <section id="view-dashboard" class="space-y-3.5 max-w-[1600px] mx-auto font-mono">
    
    <!-- Row 1: Quick Market & Operational Context Bar -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div class="flex items-center gap-4 flex-wrap">
        <div class="flex items-center gap-2">
          <span class="text-amber-400 font-bold text-sm tracking-tight">XAU/USD</span>
          <span class="text-white text-base font-bold" id="dashPrice">UNAVAILABLE</span>
          <span class="text-[10px] px-1.5 py-0.2 rounded font-semibold bg-slate-900 text-slate-400 border border-slate-800" id="dashPriceBadge">NO LIVE FEED</span>
        </div>
        <div class="h-4 w-px bg-slate-800 hidden sm:block"></div>
        <div class="flex items-center gap-3 text-slate-400 text-[11px]">
          <span>BID: <strong class="text-slate-200" id="dashBid">--.--</strong></span>
          <span>ASK: <strong class="text-slate-200" id="dashAsk">--.--</strong></span>
          <span>SPREAD: <strong class="text-amber-400" id="dashSpread">--</strong></span>
        </div>
        <div class="h-4 w-px bg-slate-800 hidden md:block"></div>
        <div class="hidden md:flex items-center gap-2 text-[11px] text-slate-400">
          <span>الجلسة الحالية:</span>
          <span class="text-cyan-400 font-bold" id="dashSession">--</span>
        </div>
      </div>

      <div class="flex items-center gap-2.5 text-[11px]">
        <div class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
          <span>مزود السوق:</span>
          <span class="text-rose-400 font-bold" id="dashProviderBadge">NOT CONNECTED</span>
        </div>
        <div class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
          <span>الماسح:</span>
          <span class="text-emerald-400 font-bold" id="dashScannerStatus">RUNNING</span>
        </div>
        <button onclick="refreshDashboard(true)" class="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800" title="تحديث لحظي">
          ${ICONS.refresh}
        </button>
      </div>
    </div>

    <!-- Row 2: Main Trading Grid (Chart ~65% / Operator Panels ~35%) -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
      
      <!-- Left Column (~65% width): Large Terminal Chart + Market Strip -->
      <div class="lg:col-span-8 flex flex-col gap-3">
        
        <!-- Large Interactive Candlestick Chart Container -->
        <div class="bg-[#090D15] border border-slate-800 rounded-lg overflow-hidden flex flex-col shadow-lg">
          
          <!-- Chart Header Toolbar -->
          <div class="px-3.5 py-2.5 bg-[#070A10] border-b border-slate-800 flex items-center justify-between text-xs flex-wrap gap-2">
            <div class="flex items-center gap-3">
              <span class="font-bold text-slate-200 flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                <span>الرسم البياني للتيرمينال (XAU/USD)</span>
              </span>
              <span id="chartDataSourceBadge" class="text-[10px] px-2 py-0.5 rounded font-bold bg-amber-950/80 text-amber-400 border border-amber-800/80">
                TEST / FIXTURE DATA (M5)
              </span>
              <!-- Timeframe Selector -->
              <div class="flex items-center bg-slate-900 border border-slate-800 rounded p-0.5 text-[11px]">
                <button type="button" onclick="selectTimeframe('M1')" id="tf-M1" class="px-2 py-0.5 rounded font-bold transition bg-amber-500 text-black">M1 (PRIMARY)</button>
                <button type="button" onclick="selectTimeframe('M5')" id="tf-M5" class="px-2 py-0.5 rounded text-slate-400 hover:text-white transition">M5</button>
                <button type="button" onclick="selectTimeframe('M15')" id="tf-M15" class="px-2 py-0.5 rounded text-slate-400 hover:text-white transition">M15</button>
                <button type="button" onclick="selectTimeframe('H1')" id="tf-H1" class="px-2 py-0.5 rounded text-slate-400 hover:text-white transition">H1</button>
              </div>
            </div>

            <!-- Chart HUD Coordinates / Tooltip -->
            <div class="hidden sm:flex items-center gap-3 text-[11px] text-slate-400" id="chartHud">
              <span>O: <strong class="text-slate-200" id="hudOpen">-</strong></span>
              <span>H: <strong class="text-slate-200" id="hudHigh">-</strong></span>
              <span>L: <strong class="text-slate-200" id="hudLow">-</strong></span>
              <span>C: <strong class="text-slate-200" id="hudClose">-</strong></span>
            </div>
          </div>

          <!-- HTML5 Canvas Responsive Chart Container -->
          <div class="relative w-full h-[400px] sm:h-[450px] lg:h-[480px] bg-[#070A10] select-none cursor-crosshair">
            <canvas id="terminalCandleCanvas" class="w-full h-full block"></canvas>
            
            <!-- Professional Empty State Overlay if Market Data Unavailable -->
            <div id="chartOverlayNoFeed" class="absolute inset-0 flex flex-col items-center justify-center bg-[#070A10]/95 text-slate-400 text-xs gap-3 p-6 text-center hidden">
              <div class="w-10 h-10 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-amber-500">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
              </div>
              <div class="space-y-1">
                <h3 class="font-bold text-white text-sm">MARKET DATA NOT CONNECTED</h3>
                <p class="text-slate-500 text-[11px] max-w-sm">مزود بيانات السوق (Biquiti) غير متصل حالياً في بيئة التطوير. يتم الاعتماد على الشموع الاختبارية (Test Fixtures) في وضع التطوير والمحاكاة.</p>
              </div>
              <span class="text-[10px] px-2.5 py-1 rounded bg-slate-900 text-slate-400 border border-slate-800">
                Provider: Biquiti &bull; Status: NOT VERIFIED
              </span>
            </div>
          </div>

          <!-- Chart Footer Legend / Levels -->
          <div class="px-3.5 py-1.5 bg-[#070A10] border-t border-slate-850 flex items-center justify-between text-[10px] text-slate-400 overflow-x-auto">
            <div class="flex items-center gap-3.5 whitespace-nowrap">
              <span class="flex items-center gap-1"><span class="w-2.5 h-1 bg-amber-500 inline-block"></span> السعر الحالي</span>
              <span class="flex items-center gap-1"><span class="w-2.5 h-1 bg-cyan-400 inline-block"></span> سعر الدخول (Entry)</span>
              <span class="flex items-center gap-1"><span class="w-2.5 h-1 bg-rose-500 inline-block"></span> وقف الخسارة (SL)</span>
              <span class="flex items-center gap-1"><span class="w-2.5 h-1 bg-emerald-500 inline-block"></span> الأهداف (TP1 / TP2)</span>
            </div>
            <span class="text-slate-500 hidden md:inline" id="chartCandlesCount">-- شمعة معتمدة</span>
          </div>
        </div>

        <!-- Market Intelligence Strip Directly Under Chart -->
        <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div class="bg-[#070A10] p-2.5 rounded border border-slate-850 space-y-1">
            <span class="text-slate-500 text-[10px] block">المسار والاتجاه (Trend)</span>
            <span class="text-white font-bold text-sm" id="intelTrend">RANGE / NEUTRAL</span>
          </div>
          <div class="bg-[#070A10] p-2.5 rounded border border-slate-850 space-y-1">
            <span class="text-slate-500 text-[10px] block">هيكل السوق (Structure)</span>
            <span class="text-cyan-400 font-bold text-sm" id="intelStructure">BALANCED</span>
          </div>
          <div class="bg-[#070A10] p-2.5 rounded border border-slate-850 space-y-1">
            <span class="text-slate-500 text-[10px] block">جلسة التداول (Session)</span>
            <span class="text-amber-400 font-bold text-sm" id="intelSession">LONDON / NY</span>
          </div>
          <div class="bg-[#070A10] p-2.5 rounded border border-slate-850 space-y-1">
            <span class="text-slate-500 text-[10px] block">فلاتر السوق (Filters)</span>
            <span class="text-emerald-400 font-bold text-sm" id="intelFilters">ACTIVE</span>
          </div>
        </div>

      </div>

      <!-- Right Column (~35% width): Account Capital & Risk Panel + Active Setup -->
      <div class="lg:col-span-4 flex flex-col gap-3.5">
        
        <!-- Account Capital & Risk Engine Panel (MANDATORY REQUIREMENT) -->
        <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3 shadow-md text-xs">
          <div class="flex items-center justify-between border-b border-slate-800 pb-2">
            <div>
              <span class="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                ${ICONS.risk}
                <span>رأس المال وسقف المخاطر (Account & Risk)</span>
              </span>
              <span class="text-[10px] text-slate-500 block">DEV RUNTIME CAPITAL &bull; محرك المخاطر الداخلي</span>
            </div>
            <button onclick="switchTab('settings')" class="text-[10px] text-amber-400 hover:text-amber-300 px-2 py-0.5 rounded border border-amber-800/80 bg-amber-950/40 font-bold">
              تعديل (Edit) &larr;
            </button>
          </div>

          <!-- Account Capital Prominent Display -->
          <div class="bg-[#070A10] p-3 rounded border border-slate-850 flex items-center justify-between">
            <div>
              <span class="text-slate-500 text-[10px] block">رأس المال التشغيلي (Account Capital)</span>
              <span class="text-amber-400 text-xl font-bold font-mono tracking-tight" id="dashAccountCapital">$10,000.00</span>
            </div>
            <span class="text-[9px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 font-mono">SIMULATED</span>
          </div>

          <!-- Risk Limits Grid -->
          <div class="grid grid-cols-2 gap-2 text-[11px]">
            <div class="bg-[#070A10] p-2 rounded border border-slate-850">
              <span class="text-slate-500 block">المخاطرة / الصفقة</span>
              <span class="text-white font-bold text-sm block mt-0.5 font-mono" id="dashRiskPerTrade">1.00%</span>
              <span class="text-slate-500 text-[9px] block" id="dashRiskAmount">~$100.00 / trade</span>
            </div>
            <div class="bg-[#070A10] p-2 rounded border border-slate-850">
              <span class="text-slate-500 block">التراجع (DD / Max)</span>
              <span class="text-emerald-400 font-bold text-sm block mt-0.5 font-mono" id="dashDrawdown">0.00% / 10.00%</span>
              <span class="text-slate-500 text-[9px] block">Max DD Threshold</span>
            </div>
            <div class="bg-[#070A10] p-2 rounded border border-slate-850">
              <span class="text-slate-500 block">الصفقات (Open / Max)</span>
              <span class="text-white font-bold text-sm block mt-0.5 font-mono" id="dashOpenTrades">0 / 2</span>
              <span class="text-slate-500 text-[9px] block">Max Open Trades</span>
            </div>
            <div class="bg-[#070A10] p-2 rounded border border-slate-850">
              <span class="text-slate-500 block">التعرض (Exposure / Max)</span>
              <span class="text-cyan-400 font-bold text-sm block mt-0.5 font-mono" id="dashNetExposure">0.00 / 1.50 L</span>
              <span class="text-slate-500 text-[9px] block">Net Exposure Lots</span>
            </div>
          </div>

          <!-- Kill Switch Status Row -->
          <div class="flex items-center justify-between pt-1.5 border-t border-slate-850 text-[11px]">
            <div class="flex items-center gap-1.5">
              <span class="text-slate-400">قاطع الدائرة (Kill Switch):</span>
              <span class="font-bold text-emerald-400" id="dashKsText">NONE (SAFE)</span>
            </div>
            <button onclick="switchTab('risk')" class="text-slate-400 hover:text-white text-[10px] underline">
              تحكم الأمان &larr;
            </button>
          </div>
        </div>

        <!-- Active Setup Panel (CRITICAL) -->
        <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 flex flex-col justify-between shadow-md">
          <div>
            <div class="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-3">
              <span class="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                <span class="w-2 h-2 rounded bg-amber-500"></span>
                <span>النموذج النشط حالياً (Active Setup)</span>
              </span>
              <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400" id="setupStateBadge">MONITORING</span>
            </div>

            <!-- Setup Content Dynamic Body -->
            <div id="activeSetupBody" class="space-y-3 text-xs">
              <!-- Default Truthful Empty State (Never Fabricated) -->
              <div class="p-5 text-center text-slate-500 bg-[#070A10] rounded border border-slate-850 space-y-1.5">
                <p class="font-bold text-slate-300">NO ACTIVE SETUP</p>
                <p class="text-[11px] text-slate-500">المحرك يراقب شموع السوق المغلقة بانتظام للكشف عن أي فرصة متطابقة حتمياً.</p>
              </div>
            </div>
          </div>

          <div class="pt-3 border-t border-slate-850 mt-3 flex items-center justify-between text-xs">
            <span class="text-[10px] text-slate-500" id="setupLastEvaluated">آخر فحص: --</span>
            <button onclick="switchTab('setups')" class="text-amber-400 hover:text-amber-300 text-xs font-bold hover:underline">
              عرض سجل النماذج &larr;
            </button>
          </div>
        </div>

      </div>

    </div>

    <!-- Row 3: Recent Real Scanner Runs (Dashboard 5-8 Activity Strip) -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3.5 space-y-2.5">
      <div class="flex items-center justify-between border-b border-slate-800 pb-2">
        <div class="flex items-center gap-2">
          ${ICONS.scanner}
          <span class="font-bold text-slate-200 text-xs">آخر دورات فحص الماسح الفعلي (Recent Scanner Activity)</span>
          <span class="text-[9px] px-1.5 py-0.2 rounded bg-slate-900 text-slate-400 border border-slate-800">REAL STORE</span>
        </div>
        <button onclick="switchTab('scanner')" class="text-amber-400 hover:underline text-[11px]">عرض سجل الـ 30 دورة &larr;</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-right text-xs">
          <thead>
            <tr class="text-[10px] text-slate-500 border-b border-slate-850 pb-1">
              <th class="py-1.5 px-2.5">التوقيت (UTC)</th>
              <th class="py-1.5 px-2.5">الحالة</th>
              <th class="py-1.5 px-2.5">الرمز والأطر</th>
              <th class="py-1.5 px-2.5">المدة الزمنية</th>
              <th class="py-1.5 px-2.5">الشموع المجلوبة</th>
              <th class="py-1.5 px-2.5">الشموع الجديدة</th>
              <th class="py-1.5 px-2.5">النماذج المكتشفة</th>
              <th class="py-1.5 px-2.5">الإشارات المولدة</th>
            </tr>
          </thead>
          <tbody id="dashScannerBody" class="divide-y divide-slate-850/60 text-slate-300">
            <tr>
              <td colspan="8" class="py-4 text-center text-slate-500 text-[11px]">
                جارٍ جلب آخر دورات مسح السوق من المحرك...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

  </section>
  `;
}
