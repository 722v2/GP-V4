import { ICONS } from "../theme.js";

export function renderTradesView(): string {
  return `
  <!-- ========================================================================= -->
  <!-- VIEW: TRADES (دفتر الأستاذ المالي للصفقات والمراكز) -->
  <!-- ========================================================================= -->
  <section id="view-trades" class="hidden space-y-3.5 max-w-[1600px] mx-auto font-mono">
    
    <!-- Trades Header -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div>
        <h1 class="text-base font-bold text-white flex items-center gap-2">
          ${ICONS.trades}
          <span>دفتر الصفقات والمراكز الحية (Trades Ledger Panel)</span>
        </h1>
        <p class="text-[11px] text-slate-400 mt-0.5">الصفقات المفتوحة اللحظية، الأرباح غير المحققة، أوامر الحماية، والسجل التاريخي المغلق.</p>
      </div>

      <div class="flex items-center gap-2">
        <button onclick="refreshPositions(true)" class="px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs flex items-center gap-1.5 transition">
          ${ICONS.refresh}
          <span>تحديث الصفقات</span>
        </button>
      </div>
    </div>

    <!-- Trades Summary Metrics Strip -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">الصفقات المفتوحة</span>
        <span class="text-white text-lg font-bold block mt-1" id="trdOpenCount">0</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">حجم التعرض الكلي (Lots)</span>
        <span class="text-cyan-400 text-lg font-bold block mt-1" id="trdExposureLots">0.00 Lots</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">الأرباح غير المحققة</span>
        <span class="text-white text-lg font-bold block mt-1" id="trdUnrealizedPnl">$0.00</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">أرباح اليوم المحققة</span>
        <span class="text-emerald-400 text-lg font-bold block mt-1" id="trdRealizedPnl">$0.00</span>
      </div>
    </div>

    <!-- Toggle Sub-Tabs: Active Positions vs Closed History -->
    <div class="flex items-center gap-2 bg-[#090D15] p-1.5 rounded-lg border border-slate-800 text-xs">
      <button type="button" onclick="toggleTradesSubTab('active')" id="tabBtnActivePositions" class="px-3.5 py-1.5 rounded font-bold transition bg-slate-800 text-white border border-slate-700 flex items-center gap-1.5">
        <span>المراكز الحية المفتوحة (Active)</span>
        <span class="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-700 text-slate-200" id="badgeActivePositionsCount">0</span>
      </button>
      <button type="button" onclick="toggleTradesSubTab('closed')" id="tabBtnClosedTrades" class="px-3.5 py-1.5 rounded font-bold transition text-slate-400 hover:text-white flex items-center gap-1.5">
        <span>أرشيف الصفقات المغلقة (History)</span>
        <span class="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-850 text-slate-400" id="badgeClosedTradesCount">0</span>
      </button>
    </div>

    <!-- 1. Open Positions Table -->
    <div id="containerOpenPositions" class="bg-[#090D15] border border-slate-800 rounded-lg overflow-hidden shadow-sm">
      <div class="overflow-x-auto">
        <table class="w-full text-right text-xs">
          <thead>
            <tr class="bg-[#070A10]/80 text-slate-500 text-[11px] border-b border-slate-850">
              <th class="py-2.5 px-3">معرف الصفقة</th>
              <th class="py-2.5 px-3">الأصل</th>
              <th class="py-2.5 px-3">الاتجاه</th>
              <th class="py-2.5 px-3">سعر الدخول</th>
              <th class="py-2.5 px-3">السعر اللحظي</th>
              <th class="py-2.5 px-3">وقف الخسارة (SL)</th>
              <th class="py-2.5 px-3">الأهداف TP1/TP2</th>
              <th class="py-2.5 px-3">حجم العقد (Lots)</th>
              <th class="py-2.5 px-3">الربح غير المحقق</th>
              <th class="py-2.5 px-3">الحماية على الوسيط</th>
              <th class="py-2.5 px-3">وقت الفتح</th>
            </tr>
          </thead>
          <tbody id="posActiveTableBody" class="divide-y divide-slate-850/60 text-slate-300">
            <tr><td colspan="11" class="py-8 text-center text-slate-500 text-xs">لا توجد صفقات مفتوحة حالياً (Paper Trading جاهز)</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 2. Closed Trades History Table -->
    <div id="containerClosedTrades" class="hidden bg-[#090D15] border border-slate-800 rounded-lg overflow-hidden shadow-sm">
      <div class="overflow-x-auto">
        <table class="w-full text-right text-xs">
          <thead>
            <tr class="bg-[#070A10]/80 text-slate-500 text-[11px] border-b border-slate-850">
              <th class="py-2.5 px-3">معرف الصفقة</th>
              <th class="py-2.5 px-3">الأصل</th>
              <th class="py-2.5 px-3">الاتجاه</th>
              <th class="py-2.5 px-3">سعر الدخول</th>
              <th class="py-2.5 px-3">سعر الإغلاق</th>
              <th class="py-2.5 px-3">حجم العقد</th>
              <th class="py-2.5 px-3">الربح المحقق ($)</th>
              <th class="py-2.5 px-3">مضاعف R المحقق</th>
              <th class="py-2.5 px-3">سبب الإغلاق</th>
              <th class="py-2.5 px-3">وقت الإغلاق</th>
            </tr>
          </thead>
          <tbody id="posClosedTableBody" class="divide-y divide-slate-850/60 text-slate-300">
            <tr><td colspan="10" class="py-8 text-center text-slate-500 text-xs">لا توجد صفقات مغلقة مسجلة (Empty State)</td></tr>
          </tbody>
        </table>
      </div>
    </div>

  </section>
  `;
}
