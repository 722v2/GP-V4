import { ICONS } from "../theme.js";

export function renderSystemView(): string {
  return `
  <!-- ========================================================================= -->
  <!-- VIEW: SYSTEM (صحة الخدمات والأنظمة الفرعية والمطابقة) -->
  <!-- ========================================================================= -->
  <section id="view-system" class="hidden space-y-3.5 max-w-[1600px] mx-auto font-mono">
    
    <!-- Header Strip -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div>
        <h1 class="text-base font-bold text-white flex items-center gap-2">
          ${ICONS.system}
          <span>مركز فحص الأنظمة الفرعية وصحة الخدمات (System Health & Reconciliation)</span>
        </h1>
        <p class="text-[11px] text-slate-400 mt-0.5">الحالة التشغيلية الآنية لكافة أجزاء النظام، قواعد البيانات، مزود الأسعار، ومحركات الحماية.</p>
      </div>

      <div class="flex items-center gap-2">
        <button onclick="refreshSystemHealth(true)" class="px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs flex items-center gap-1.5 transition">
          ${ICONS.refresh}
          <span>تحديث الحالة</span>
        </button>
      </div>
    </div>

    <!-- Subsystems Grid -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 text-xs">
      
      <!-- Subsystem 1: Core Pipeline -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3.5 space-y-2">
        <div class="flex items-center justify-between border-b border-slate-850 pb-2">
          <span class="font-bold text-slate-200">خط الإنتاج الأساسي (Trading Pipeline)</span>
          <span class="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold" id="sysPipelineStatus">ACTIVE</span>
        </div>
        <div class="space-y-1.5 text-slate-400 text-[11px]">
          <div class="flex justify-between"><span>الحالة:</span><span class="text-slate-200">يعمل بكفاءة</span></div>
          <div class="flex justify-between"><span>الرمز الأساسي:</span><span class="text-amber-400 font-bold">XAU/USD</span></div>
          <div class="flex justify-between"><span>التزامن الزمني:</span><span class="text-emerald-400">SYNCED</span></div>
        </div>
      </div>

      <!-- Subsystem 2: Market Data Provider (Biquiti) -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3.5 space-y-2">
        <div class="flex items-center justify-between border-b border-slate-850 pb-2">
          <span class="font-bold text-slate-200">مزود بيانات السوق (Biquiti)</span>
          <span class="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold" id="sysBiquitiStatus">CONNECTED</span>
        </div>
        <div class="space-y-1.5 text-slate-400 text-[11px]">
          <div class="flex justify-between"><span>المزود:</span><span class="text-slate-200">Biquiti Market Feed</span></div>
          <div class="flex justify-between"><span>الربط:</span><span class="text-cyan-400 font-bold">LIVE API</span></div>
          <div class="flex justify-between"><span>سجل الأخطاء:</span><span class="text-slate-200" id="sysBiquitiErrors">0 أخطاء</span></div>
        </div>
      </div>

      <!-- Subsystem 3: Execution Engine & Broker -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3.5 space-y-2">
        <div class="flex items-center justify-between border-b border-slate-850 pb-2">
          <span class="font-bold text-slate-200">محرك التنفيذ والوسيط (Broker Adapter)</span>
          <span class="text-[10px] px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-bold">PAPER BROKER</span>
        </div>
        <div class="space-y-1.5 text-slate-400 text-[11px]">
          <div class="flex justify-between"><span>الوضع الفعلي:</span><span class="text-amber-300 font-bold">SIMULATED (آمن)</span></div>
          <div class="flex justify-between"><span>وسيط MT5:</span><span class="text-rose-400 font-bold">DEFERRED (مؤجل)</span></div>
          <div class="flex justify-between"><span>الانزلاق والسبريد:</span><span class="text-slate-200">Spread & Slippage Active</span></div>
        </div>
      </div>

      <!-- Subsystem 4: Persistence / Supabase -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3.5 space-y-2">
        <div class="flex items-center justify-between border-b border-slate-850 pb-2">
          <span class="font-bold text-slate-200">حفظ البيانات والتخزين (Persistence)</span>
          <span class="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700 font-bold" id="sysPersistenceStatus">IN-MEMORY</span>
        </div>
        <div class="space-y-1.5 text-slate-400 text-[11px]">
          <div class="flex justify-between"><span>قاعدة البيانات:</span><span class="text-slate-200" id="sysPersistenceMode">In-Memory Store</span></div>
          <div class="flex justify-between"><span>حالة الاستقرار:</span><span class="text-emerald-400">HEALTHY</span></div>
          <div class="flex justify-between"><span>المطابقة:</span><span class="text-slate-200">AUTO-SYNC</span></div>
        </div>
      </div>

      <!-- Subsystem 5: AI Advisory Router -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3.5 space-y-2">
        <div class="flex items-center justify-between border-b border-slate-850 pb-2">
          <span class="font-bold text-slate-200">موجه الذكاء الاصطناعي (AI Router)</span>
          <span class="text-[10px] px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 font-bold" id="sysAiStatus">ADVISORY</span>
        </div>
        <div class="space-y-1.5 text-slate-400 text-[11px]">
          <div class="flex justify-between"><span>الدور:</span><span class="text-purple-300">استشاري غير حاكم</span></div>
          <div class="flex justify-between"><span>قاطع الدائرة (Breaker):</span><span class="text-emerald-400" id="sysAiBreaker">CLOSED (طبيعي)</span></div>
          <div class="flex justify-between"><span>المزود:</span><span class="text-slate-200">NVIDIA NIM / DeepSeek V4.1 Flash</span></div>
        </div>
      </div>

      <!-- Subsystem 6: Telegram Notifier -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3.5 space-y-2">
        <div class="flex items-center justify-between border-b border-slate-850 pb-2">
          <span class="font-bold text-slate-200">نظام الإشعارات (Telegram Notifier)</span>
          <span class="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-700 font-bold" id="sysTgStatus">CONFIGURED</span>
        </div>
        <div class="space-y-1.5 text-slate-400 text-[11px]">
          <div class="flex justify-between"><span>القناة:</span><span class="text-slate-200">Telegram Bot API</span></div>
          <div class="flex justify-between"><span>حالة الإرسال:</span><span class="text-emerald-400">READY</span></div>
          <div class="flex justify-between"><span>الأولوية:</span><span class="text-slate-200">NON-BLOCKING</span></div>
        </div>
      </div>

    </div>

    <!-- Reconciliation & Integrity Panel -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3">
      <div class="flex items-center justify-between border-b border-slate-850 pb-2">
        <div class="flex items-center gap-2">
          <span class="font-bold text-slate-200">خدمة المطابقة والحماية (Reconciliation Engine)</span>
          <span class="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">SYNCHRONIZED</span>
        </div>
        <span class="text-[11px] text-slate-500">فحص فوري لأوامر الحماية والمراكز</span>
      </div>
      <p class="text-xs text-slate-400 leading-relaxed">
        يقوم محرك المطابقة بالتأكد الدوري من توافق المراكز الحية المسجلة في الذاكرة مع أوامر وقف الخسارة وجني الأرباح المعلقة لدى الوسيط لمنع أي انفصال بين الواقع المسجل وواقع المحفظة.
      </p>
    </div>

  </section>
  `;
}
