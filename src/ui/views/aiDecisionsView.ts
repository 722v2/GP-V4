import { ICONS } from "../theme.js";

export function renderAiDecisionsView(): string {
  return `
  <!-- ========================================================================= -->
  <!-- VIEW: AI DECISIONS (استشارات الذكاء الاصطناعي الفنية) -->
  <!-- ========================================================================= -->
  <section id="view-ai" class="hidden space-y-3.5 max-w-[1600px] mx-auto font-mono">
    
    <!-- AI Header & Policy Banner -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3.5 space-y-2 text-xs">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-base font-bold text-white flex items-center gap-2">
          ${ICONS.ai}
          <span>قرارات وتعليلات الذكاء الاصطناعي الاستشارية (AI Advisor Engine)</span>
        </h1>
        <button onclick="refreshAiDecisions(true)" class="px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs flex items-center gap-1.5 transition">
          ${ICONS.refresh}
          <span>تحديث القرارات</span>
        </button>
      </div>

      <!-- Critical Boundary Statement -->
      <div class="p-2.5 rounded bg-purple-950/20 border border-purple-900/60 text-purple-300 text-[11px] leading-relaxed">
        <strong>تنبيه معماري حاسم:</strong> الذكاء الاصطناعي يعمل حصرياً كنظام استشاري فني مكمل (Advisory System). 
        <span class="text-amber-400 font-bold">الذكاء الاصطناعي ليس محرك مخاطر (AI ≠ Risk Engine)</span> و 
        <span class="text-rose-400 font-bold">ليس منفذ صفقات مباشر (AI ≠ Execution Engine)</span>. 
        القرارات الحتمية ومطابقة الحواجز الأمنية تظل حصرية لمحركات النظام الأساسية.
      </div>
    </div>

    <!-- AI Telemetry Strip -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">حالة المزود الذكي</span>
        <span class="text-emerald-400 text-lg font-bold block mt-1" id="aiStatusVal">READY</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">النموذج المعتمد</span>
        <span class="text-white text-sm font-bold block mt-1" id="aiModelVal">--</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">الحد الأدنى للثقة المعتمدة</span>
        <span class="text-amber-400 text-lg font-bold block mt-1" id="aiMinConfVal">--</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">إجمالي الاستشارات المسجلة</span>
        <span class="text-cyan-400 text-lg font-bold block mt-1" id="aiUsageCountVal">0</span>
      </div>
    </div>

    <!-- AI Decisions Log Table -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg overflow-hidden shadow-sm">
      <div class="overflow-x-auto">
        <table class="w-full text-right text-xs">
          <thead>
            <tr class="bg-[#070A10]/80 text-slate-500 text-[11px] border-b border-slate-850">
              <th class="py-2.5 px-3">التوقيت (UTC)</th>
              <th class="py-2.5 px-3">معرف القرار</th>
              <th class="py-2.5 px-3">معرف النموذج</th>
              <th class="py-2.5 px-3">القرار الاستشاري</th>
              <th class="py-2.5 px-3">الاتجاه</th>
              <th class="py-2.5 px-3">نسبة الثقة</th>
              <th class="py-2.5 px-3">التحقق الهيكلي</th>
              <th class="py-2.5 px-3">الذاكرة المؤقتة (Cached)</th>
              <th class="py-2.5 px-3">أسباب القرار</th>
            </tr>
          </thead>
          <tbody id="aiDecisionsTableBody" class="divide-y divide-slate-850/60 text-slate-300">
            <tr><td colspan="9" class="py-8 text-center text-slate-500 text-xs">لا توجد استشارات مسجلة من الذكاء الاصطناعي حتى الآن (Empty State)</td></tr>
          </tbody>
        </table>
      </div>
    </div>

  </section>
  `;
}
