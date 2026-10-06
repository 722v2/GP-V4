import { ICONS } from "../theme.js";

export function renderBacktestView(): string {
  return `
  <!-- ========================================================================= -->
  <!-- VIEW: BACKTEST & REPLAY (محاكي التداول والاختبار التاريخي) -->
  <!-- ========================================================================= -->
  <section id="view-backtest" class="hidden space-y-3.5 max-w-[1600px] mx-auto font-mono">
    
    <!-- Header Strip -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div>
        <h1 class="text-base font-bold text-white flex items-center gap-2">
          ${ICONS.backtest}
          <span>محاكي الاختبار التاريخي وإعادة التشغيل (Backtest & Market Replay)</span>
        </h1>
        <p class="text-[11px] text-slate-400 mt-0.5">محاكاة حتمية وتاريخية عبر الشموع السعرية المسجلة لتقييم الاستراتيجيات ومعدلات النجاح الحقيقية.</p>
      </div>

      <div class="flex items-center gap-2">
        <button id="btnRunBacktest" onclick="executeRunBacktest()" class="px-3.5 py-1.5 rounded bg-amber-600 hover:bg-amber-500 font-bold text-black text-xs transition shadow flex items-center gap-1.5">
          <span>تشغيل الاختبار التاريخي (Run Backtest)</span>
        </button>
        <button id="btnRunReplay" onclick="executeRunReplay()" class="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 font-bold text-slate-200 text-xs border border-slate-700 transition flex items-center gap-1.5">
          <span>إعادة تشغيل السوق (Replay)</span>
        </button>
      </div>
    </div>

    <!-- Backtest Performance Metrics Strip -->
    <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">إجمالي الصفقات (Trades)</span>
        <span class="text-white text-lg font-bold block mt-1" id="btTotalTrades">--</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">نسبة الصفقات الرابحة (Win Rate)</span>
        <span class="text-emerald-400 text-lg font-bold block mt-1" id="btWinRate">--%</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">معامل الربحية (Profit Factor)</span>
        <span class="text-amber-400 text-lg font-bold block mt-1" id="btProfitFactor">--</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">أقصى تراجع (Max Drawdown)</span>
        <span class="text-rose-400 text-lg font-bold block mt-1" id="btMaxDrawdown">--%</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">صافي العائد ($ Net Profit)</span>
        <span class="text-cyan-400 text-lg font-bold block mt-1" id="btNetProfit">$0.00</span>
      </div>
    </div>

    <!-- Replay / Backtest Execution State Panel -->
    <div id="btRunningNotice" class="hidden bg-[#0D121D] border border-amber-800/80 rounded-lg p-3 text-xs text-amber-300 flex items-center gap-3">
      <span class="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></span>
      <span id="btRunningText">جارٍ تنفيذ الاختبار التاريخي عبر تدفق الشموع...</span>
    </div>

    <!-- Backtest Simulated Executions Table -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg overflow-hidden shadow-sm">
      <div class="px-4 py-3 bg-[#070A10] border-b border-slate-800 flex items-center justify-between text-xs">
        <span class="font-bold text-slate-200">سجل نتائج المحاكاة التاريخية (Simulation Ledger)</span>
        <span class="text-[11px] text-slate-400">Deterministic Engine &bull; Slippage & Spread Included</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-right text-xs">
          <thead>
            <tr class="bg-[#070A10]/80 text-slate-500 text-[11px] border-b border-slate-850">
              <th class="py-2.5 px-3">#</th>
              <th class="py-2.5 px-3">الأصل</th>
              <th class="py-2.5 px-3">الاتجاه</th>
              <th class="py-2.5 px-3">سعر الدخول</th>
              <th class="py-2.5 px-3">سعر الخروج</th>
              <th class="py-2.5 px-3">وقف الخسارة (SL)</th>
              <th class="py-2.5 px-3">الهدف (TP)</th>
              <th class="py-2.5 px-3">الربح ($)</th>
              <th class="py-2.5 px-3">مضاعف R</th>
              <th class="py-2.5 px-3">سبب الخروج</th>
            </tr>
          </thead>
          <tbody id="backtestTableBody" class="divide-y divide-slate-850/60 text-slate-300">
            <tr><td colspan="10" class="py-8 text-center text-slate-500 text-xs">اضغط على "تشغيل الاختبار التاريخي" لتحليل بيانات الشموع وتوليد التقرير</td></tr>
          </tbody>
        </table>
      </div>
    </div>

  </section>
  `;
}
