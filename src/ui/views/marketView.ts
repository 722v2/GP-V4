import { ICONS } from "../theme.js";

export function renderMarketView(): string {
  return `
  <!-- ========================================================================= -->
  <!-- VIEW: MARKET (شاشة السوق والسيولة الشاملة) -->
  <!-- ========================================================================= -->
  <section id="view-market" class="hidden space-y-3.5 max-w-[1600px] mx-auto font-mono">
    
    <!-- Market View Header Strip -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div>
        <h1 class="text-base font-bold text-white flex items-center gap-2">
          ${ICONS.market}
          <span>شاشة السوق اللحظية والسيولة (XAU/USD Market Telemetry)</span>
        </h1>
        <p class="text-[11px] text-slate-400 mt-0.5">تحليل الشموع المكتملة، جلسات التداول، السبريد، ومؤشرات البيئة الفنية المعتمدة.</p>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="refreshMarketData(true)" class="px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs flex items-center gap-1.5 transition">
          ${ICONS.refresh}
          <span>تحديث الشموع</span>
        </button>
      </div>
    </div>

    <!-- Market Stats Grid -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">السعر اللحظي (XAU/USD)</span>
        <span class="text-white text-lg font-bold block mt-1" id="mktPrice">--.--</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">الفارق السعري (Spread)</span>
        <span class="text-amber-400 text-lg font-bold block mt-1" id="mktSpread">-- pts</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">الجلسات المفتوحة</span>
        <span class="text-cyan-400 text-lg font-bold block mt-1" id="mktSessions">--</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">مزود الأسعار</span>
        <span class="text-emerald-400 text-lg font-bold block mt-1" id="mktProviderStatus">BIQUITI LIVE</span>
      </div>
    </div>

    <!-- Closed Candles Historical Feed Table -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg overflow-hidden shadow-sm">
      <div class="px-4 py-3 bg-[#070A10] border-b border-slate-800 flex items-center justify-between text-xs">
        <span class="font-bold text-slate-200">سجل الشموع السعرية المغلقة (100% Closed Bars Only)</span>
        <span class="text-[11px] text-slate-400">الإطار الزمني المعتمد: M5</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-right text-xs">
          <thead>
            <tr class="bg-[#070A10]/60 text-slate-500 text-[11px] border-b border-slate-850">
              <th class="py-2 px-3">وقت الافتتاح (UTC)</th>
              <th class="py-2 px-3">الافتتاح (Open)</th>
              <th class="py-2 px-3">الأعلى (High)</th>
              <th class="py-2 px-3">الأدنى (Low)</th>
              <th class="py-2 px-3">الإغلاق (Close)</th>
              <th class="py-2 px-3">الحجم (Volume)</th>
              <th class="py-2 px-3">التغير (Points)</th>
            </tr>
          </thead>
          <tbody id="mktCandleTableBody" class="divide-y divide-slate-850/60 text-slate-300">
            <tr><td colspan="7" class="py-8 text-center text-slate-500 text-xs">جارٍ جلب الشموع السعرية المعتمدة من الذاكرة...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

  </section>
  `;
}
