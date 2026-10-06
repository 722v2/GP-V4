import { ICONS } from "../theme.js";

export function renderRiskView(): string {
  return `
  <!-- ========================================================================= -->
  <!-- VIEW: RISK (إدارة المخاطر والقدرة الاستيعابية ومفتاح الأمان) -->
  <!-- ========================================================================= -->
  <section id="view-risk" class="hidden space-y-3.5 max-w-[1600px] mx-auto font-mono">
    
    <!-- Risk Header -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div>
        <h1 class="text-base font-bold text-white flex items-center gap-2">
          ${ICONS.risk}
          <span>مركز إدارة المخاطر والأمان (Risk & Exposure Engine)</span>
        </h1>
        <p class="text-[11px] text-slate-400 mt-0.5">مراقبة حية وحصرية لحالة رأس المال، التراجع التراكمي، حواجز الحماية، وقواطع الدائرة الأمنية.</p>
      </div>

      <div class="flex items-center gap-2">
        <button onclick="refreshRisk(true)" class="px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs flex items-center gap-1.5 transition">
          ${ICONS.refresh}
          <span>تحديث المخاطر</span>
        </button>
      </div>
    </div>

    <!-- Kill Switch Prominent Warning & Action Unit -->
    <div class="bg-[#0D121D] border border-slate-800 rounded-lg p-4 space-y-3 shadow-md">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-2.5">
        <div class="flex items-center gap-2.5">
          <span class="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" id="ksStatusDot"></span>
          <div>
            <span class="text-slate-400 text-[10px] block">مستوى قاطع الدائرة الأمني (Kill Switch Level)</span>
            <span class="text-white text-base font-bold" id="ksLevelText">المستوى: NONE (آمن وطبيعي)</span>
          </div>
        </div>
        <span class="text-xs px-2.5 py-1 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold" id="ksLevelBadge">
          NORMAL (مسموح بالتداول)
        </span>
      </div>

      <div class="text-xs text-slate-300 bg-[#070A10] p-2.5 rounded border border-slate-850 flex items-center justify-between">
        <div><span class="text-slate-500">سبب الإجراء الحالي: </span><span id="ksReasonText" class="text-slate-200 font-semibold">لا توجد قيود أمان نشطة حاليًا.</span></div>
        <span class="text-[10px] text-slate-500" id="ksTriggeredBy">المشغل: SYSTEM</span>
      </div>

      <!-- Action Controls: Reset & Escalate -->
      <div class="pt-2 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <button onclick="triggerKsReset()" class="px-3.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 font-bold text-white text-xs transition shadow flex items-center gap-1.5">
            <span>إلغاء قفل الأمان وإعادة التعيين (Reset Safety)</span>
          </button>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-[11px] text-slate-400 font-semibold">تصعيد اضطراري:</span>
          <button onclick="triggerKsEscalate('L1')" class="px-2.5 py-1 rounded bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs font-bold transition">L1 (تحذير)</button>
          <button onclick="triggerKsEscalate('L2')" class="px-2.5 py-1 rounded bg-rose-900/60 hover:bg-rose-800 border border-rose-700 text-rose-200 text-xs font-bold transition">L2 (وقف فتح صفقات)</button>
          <button onclick="triggerKsEscalate('L3')" class="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition">L3 (تجميد كامل)</button>
        </div>
      </div>
    </div>

    <!-- Metric Columns (Account Metrics vs Guardrails) -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3.5 text-xs">
      
      <!-- Account Metrics -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3">
        <div class="border-b border-slate-800 pb-2">
          <span class="font-bold text-slate-200 text-xs">مقاييس رأس المال والحساب الحالية</span>
        </div>
        <div class="space-y-2 text-[11px]">
          <div class="flex justify-between py-1 border-b border-slate-850"><span class="text-slate-500">رأس مال الحساب التشغيلي (Equity):</span><span class="font-bold text-white" id="rkEquityVal">$---</span></div>
          <div class="flex justify-between py-1 border-b border-slate-850"><span class="text-slate-500">ذروة رأس المال المسجلة (Peak):</span><span class="font-bold text-slate-300" id="rkPeakVal">$---</span></div>
          <div class="flex justify-between py-1 border-b border-slate-850"><span class="text-slate-500">التراجع التراكمي الفعلي (Current DD):</span><span class="font-bold text-emerald-400" id="rkDdVal">0.00%</span></div>
          <div class="flex justify-between py-1 border-b border-slate-850"><span class="text-slate-500">صافي الربح/الخسارة اليومي:</span><span class="font-bold text-slate-200" id="rkDailyPnl">$0.00</span></div>
          <div class="flex justify-between py-1"><span class="text-slate-500">صافي الربح/الخسارة الأسبوعي:</span><span class="font-bold text-slate-200" id="rkWeeklyPnl">$0.00</span></div>
        </div>
      </div>

      <!-- Guardrails Checkpoints -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3">
        <div class="border-b border-slate-800 pb-2 flex justify-between items-center">
          <span class="font-bold text-slate-200 text-xs">فحص الحواجز الأمنية (Guardrails)</span>
          <span class="text-[10px] text-emerald-400 font-bold bg-emerald-950 px-1.5 py-0.2 rounded border border-emerald-800" id="rkVerdictBadge">APPROVED</span>
        </div>
        <div class="space-y-2 text-[11px]">
          <div class="flex justify-between items-center py-1 border-b border-slate-850"><span>سقف الخسارة اليومية المسموح:</span><span class="px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold" id="rkBreachDaily">PASS</span></div>
          <div class="flex justify-between items-center py-1 border-b border-slate-850"><span>سقف الخسارة الأسبوعية:</span><span class="px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold" id="rkBreachWeekly">PASS</span></div>
          <div class="flex justify-between items-center py-1 border-b border-slate-850"><span>سقف أقصى تراجع مسموح:</span><span class="px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold" id="rkBreachDd">PASS</span></div>
          <div class="flex justify-between items-center py-1 border-b border-slate-850"><span>سقف عدد الصفقات المفتوحة:</span><span class="px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold" id="rkBreachTrades">PASS</span></div>
          <div class="flex justify-between items-center py-1"><span>سقف التعرض الكلي بالعقود:</span><span class="px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold" id="rkBreachExposure">PASS</span></div>
        </div>
      </div>

    </div>

  </section>
  `;
}
