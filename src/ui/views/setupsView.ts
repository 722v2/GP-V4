import { ICONS } from "../theme.js";

export function renderSetupsView(): string {
  return `
  <!-- ========================================================================= -->
  <!-- VIEW: SETUPS (نماذج التحليل الفني والفرص المكتشفة) -->
  <!-- ========================================================================= -->
  <section id="view-setups" class="hidden space-y-3.5 max-w-[1600px] mx-auto font-mono">
    
    <!-- Header Strip -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div>
        <h1 class="text-base font-bold text-white flex items-center gap-2">
          ${ICONS.setups}
          <span>دليل نماذج الإعداد النشطة (Market Setups Hub)</span>
        </h1>
        <p class="text-[11px] text-slate-400 mt-0.5">نماذج الشموع الفنية، مناطق الفجوات السعرية (FVG)، والكسور الهيكلية المكتشفة بالخوارزميات.</p>
      </div>

      <!-- State Filter Pills -->
      <div class="flex items-center gap-2">
        <button onclick="refreshSetups(true)" class="px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs flex items-center gap-1.5 transition">
          ${ICONS.refresh}
          <span>تحديث النماذج</span>
        </button>
      </div>
    </div>

    <!-- Setups Table -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg overflow-hidden shadow-sm">
      <div class="overflow-x-auto">
        <table class="w-full text-right text-xs">
          <thead>
            <tr class="bg-[#070A10]/80 text-slate-500 text-[11px] border-b border-slate-850">
              <th class="py-2.5 px-3">معرف النموذج</th>
              <th class="py-2.5 px-3">الأصل</th>
              <th class="py-2.5 px-3">الإطار</th>
              <th class="py-2.5 px-3">النوع والاستراتيجية</th>
              <th class="py-2.5 px-3">الاتجاه</th>
              <th class="py-2.5 px-3">سعر الدخول</th>
              <th class="py-2.5 px-3">وقف الخسارة (SL)</th>
              <th class="py-2.5 px-3">الهدف الأول (TP1)</th>
              <th class="py-2.5 px-3">الهدف الثاني (TP2)</th>
              <th class="py-2.5 px-3">مضاعف R</th>
              <th class="py-2.5 px-3">الجودة / الثقة</th>
              <th class="py-2.5 px-3">الحالة التشغيلية</th>
            </tr>
          </thead>
          <tbody id="setupsTableBody" class="divide-y divide-slate-850/60 text-slate-300">
            <tr><td colspan="12" class="py-8 text-center text-slate-500 text-xs">لا توجد نماذج إعداد نشطة حالياً (Empty State)</td></tr>
          </tbody>
        </table>
      </div>
    </div>

  </section>
  `;
}
