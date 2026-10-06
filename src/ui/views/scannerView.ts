import { ICONS } from "../theme.js";

export function renderScannerView(): string {
  return `
  <!-- ========================================================================= -->
  <!-- VIEW: SCANNER (الماسح اللحظي الحي وسجل الـ 30 دورة فحص) -->
  <!-- ========================================================================= -->
  <section id="view-scanner" class="hidden space-y-3.5 max-w-[1600px] mx-auto font-mono">
    
    <!-- Scanner Header & Operational Toolbar -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div>
        <h1 class="text-base font-bold text-white flex items-center gap-2">
          ${ICONS.scanner}
          <span>محرك الماسح اللحظي لسوق الذهب (Real Market Scanner Console)</span>
        </h1>
        <p class="text-[11px] text-slate-400 mt-0.5">فحص دوري لحالات السوق وتدفق الشموع المغلقة، تحفيز كشف النماذج وتوليد الإشارات الحتمية.</p>
      </div>

      <!-- Real Command Buttons (Start / Stop / Tick) -->
      <div class="flex items-center gap-2 flex-wrap">
        <button id="btnScannerStart" onclick="executeScannerStart()" class="px-3.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 font-bold text-white text-xs transition shadow flex items-center gap-1.5">
          <span>بدء الماسح (Start)</span>
        </button>
        <button id="btnScannerStop" onclick="executeScannerStop()" class="px-3.5 py-1.5 rounded bg-rose-600 hover:bg-rose-500 font-bold text-white text-xs transition shadow flex items-center gap-1.5">
          <span>إيقاف الماسح (Stop)</span>
        </button>
        <button id="btnScannerTick" onclick="executeScannerTick()" class="px-3.5 py-1.5 rounded bg-amber-600 hover:bg-amber-500 font-bold text-black text-xs transition shadow flex items-center gap-1.5">
          <span>فحص فوري يدوي (Tick)</span>
        </button>
        <button onclick="refreshScanner(true)" class="p-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800" title="تحديث السجل">
          ${ICONS.refresh}
        </button>
      </div>
    </div>

    <!-- Scanner Feedback Alert -->
    <div id="scannerNoticeBox" class="hidden p-3 rounded-lg border text-xs flex items-center justify-between">
      <span id="scannerNoticeText" class="font-bold"></span>
      <button onclick="document.getElementById('scannerNoticeBox').classList.add('hidden')" class="text-slate-400">&times;</button>
    </div>

    <!-- Scanner Metrics Strip -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">حالة المحرك</span>
        <span class="text-emerald-400 text-lg font-bold block mt-1" id="scStatusVal">RUNNING</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">معدل نبضات الفحص</span>
        <span class="text-white text-lg font-bold block mt-1" id="scIntervalVal">-- ms</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">مدة آخر دورة مسح</span>
        <span class="text-cyan-400 text-lg font-bold block mt-1" id="scDurationVal">-- ms</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3 rounded-lg">
        <span class="text-slate-500 text-[10px] block">النماذج المكتشفة المعتمدة</span>
        <span class="text-amber-400 text-lg font-bold block mt-1" id="scActiveSetupsCount">0</span>
      </div>
    </div>

    <!-- Complete 30-Run Scanner Historical Activity Table (MANDATORY REQUIREMENT) -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg overflow-hidden shadow-sm">
      <div class="px-4 py-3 bg-[#070A10] border-b border-slate-800 flex items-center justify-between text-xs">
        <div class="flex items-center gap-2">
          <span class="font-bold text-slate-200">سجل آخر 30 دورة مسح حقيقية (Authoritative 30 Scans Log)</span>
          <span class="text-[10px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">REAL BACKEND STORE</span>
        </div>
        <span class="text-[11px] text-slate-500">محدث لحظياً عبر الأحداث و SSE</span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-right text-xs">
          <thead>
            <tr class="bg-[#070A10]/60 text-slate-500 text-[11px] border-b border-slate-850">
              <th class="py-2.5 px-3">معرف الدورة (Run ID)</th>
              <th class="py-2.5 px-3">التوقيت (UTC)</th>
              <th class="py-2.5 px-3">الرمز والأطر</th>
              <th class="py-2.5 px-3">الحالة (Status)</th>
              <th class="py-2.5 px-3">المدة (Duration)</th>
              <th class="py-2.5 px-3">الشموع المجلوبة</th>
              <th class="py-2.5 px-3">الشموع الجديدة</th>
              <th class="py-2.5 px-3">النماذج</th>
              <th class="py-2.5 px-3">الإشارات</th>
              <th class="py-2.5 px-3">نوع المشغل (Trigger)</th>
              <th class="py-2.5 px-3">تفاصيل الأخطاء / الرسالة</th>
            </tr>
          </thead>
          <tbody id="scannerHistoryTableBody" class="divide-y divide-slate-850/60 text-slate-300">
            <tr>
              <td colspan="11" class="py-12 text-center text-slate-500 text-xs">
                NO SCANNER HISTORY (لا توجد دورات مسح مسجلة حتى الآن — اضغط "فحص فوري يدوي" لتنفيذ دورة فورية)
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

  </section>
  `;
}
