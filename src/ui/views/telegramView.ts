import { ICONS } from "../theme.js";

export function renderTelegramView(): string {
  return `
  <!-- ========================================================================= -->
  <!-- VIEW: TELEGRAM (مركز تحكم وإشعارات تيليجرام) -->
  <!-- ========================================================================= -->
  <section id="view-telegram" class="hidden space-y-3.5 max-w-[1600px] mx-auto font-mono">
    
    <!-- Telegram Header -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div>
        <h1 class="text-base font-bold text-white flex items-center gap-2">
          ${ICONS.telegram}
          <span>مركز تحكم وإشعارات تيليجرام (Telegram Operations Hub)</span>
        </h1>
        <p class="text-[11px] text-slate-400 mt-0.5">مراقبة اتصال بوت تيليجرام، تسليم إشعارات الإشارات والصفقات، واختبار قنوات الإرسال المعتمدة.</p>
      </div>

      <div class="flex items-center gap-2">
        <button onclick="refreshTelegram(true)" class="px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs flex items-center gap-1.5 transition">
          ${ICONS.refresh}
          <span>تحديث الحالة</span>
        </button>
      </div>
    </div>

    <!-- Truthful Status Notification Banner -->
    <div id="tgNoticeBanner" class="p-3 rounded-lg bg-amber-950/20 border border-amber-800/40 text-amber-300 text-xs flex items-center justify-between gap-3">
      <div class="flex items-center gap-2.5">
        <span class="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shrink-0"></span>
        <span><strong>حالة الربط الفعلي:</strong> خدمة تيليجرام حالياً في مرحلة التطوير والاختبار (DEV / TEST) — غير متصلة فعلياً لعدم توفير الرموز السرية.</span>
      </div>
      <span class="text-[10px] px-2 py-0.5 rounded bg-amber-900/60 text-amber-200 border border-amber-700 font-bold shrink-0">NOT CONNECTED</span>
    </div>

    <!-- Telegram Subsystem Status Grid -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
      <div class="bg-[#090D15] border border-slate-800 p-3.5 rounded-lg space-y-1">
        <span class="text-slate-500 text-[10px] block">حالة الاتصال بالخادم</span>
        <span class="text-rose-400 text-base font-bold block" id="tgConnStatus">NOT CONFIGURED</span>
        <span class="text-[10px] text-slate-500 block">Telegram API Connection</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3.5 rounded-lg space-y-1">
        <span class="text-slate-500 text-[10px] block">مفتاح البوت (Bot Token)</span>
        <span class="text-slate-300 text-sm font-bold block" id="tgBotTokenStatus">NOT CONFIGURED</span>
        <span class="text-[10px] text-slate-500 block">TELEGRAM_BOT_TOKEN</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3.5 rounded-lg space-y-1">
        <span class="text-slate-500 text-[10px] block">معرف القناة / المحادثة (Chat ID)</span>
        <span class="text-slate-300 text-sm font-bold block" id="tgChatIdStatus">NOT CONFIGURED</span>
        <span class="text-[10px] text-slate-500 block">TELEGRAM_CHAT_ID</span>
      </div>
      <div class="bg-[#090D15] border border-slate-800 p-3.5 rounded-lg space-y-1">
        <span class="text-slate-500 text-[10px] block">خاصية الإشعارات (Feature Flag)</span>
        <span class="text-amber-400 text-sm font-bold block" id="tgEnabledStatus">DISABLED</span>
        <span class="text-[10px] text-slate-500 block">telegramEnabled in Config</span>
      </div>
    </div>

    <!-- Telegram Test Message & Controls Panel -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-4">
      <div class="flex items-center justify-between border-b border-slate-850 pb-2.5">
        <div>
          <h2 class="font-bold text-white text-sm">اختبار قناة إرسال الإشعارات (Test Message Action)</h2>
          <p class="text-[11px] text-slate-400 mt-0.5">يقوم هذا الإجراء باستدعاء الخادم الفعلي POST /api/telegram/test والتحقق من إمكانية تسليم الإشعار.</p>
        </div>
        <span class="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">REAL ENDPOINT</span>
      </div>

      <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <button id="btnSendTgTest" onclick="executeTelegramTestMessage()" class="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 font-bold text-black text-xs transition shadow flex items-center justify-center gap-2">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
          <span>إرسال رسالة اختبار (Send Test Message)</span>
        </button>
        <span class="text-[11px] text-slate-400">ملاحظة: إذا لم تكن المفاتيح مُهيأة في متغيرات البيئة، سيرد الخادم برفض صريح ولن يتم تزييف النجاح.</span>
      </div>

      <!-- Test Message Execution Feedback Alert -->
      <div id="tgTestResultBox" class="hidden p-3.5 rounded-lg border text-xs">
        <div class="flex items-center gap-2">
          <span id="tgTestResultIcon" class="w-3 h-3 rounded-full"></span>
          <span id="tgTestResultTitle" class="font-bold"></span>
        </div>
        <p id="tgTestResultDetail" class="text-[11px] mt-1.5 leading-relaxed text-slate-300"></p>
      </div>
    </div>

    <!-- Operations & Delivery History Table -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg overflow-hidden shadow-sm">
      <div class="px-4 py-3 bg-[#070A10] border-b border-slate-800 flex items-center justify-between text-xs">
        <span class="font-bold text-slate-200">سجل عمليات إشعارات تيليجرام (Telegram Notifications Log)</span>
        <span class="text-[11px] text-slate-500" id="tgLogCount">0 عمليات مسجلة</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-right text-xs">
          <thead>
            <tr class="bg-[#070A10]/80 text-slate-500 text-[11px] border-b border-slate-850">
              <th class="py-2.5 px-3">التوقيت (UTC)</th>
              <th class="py-2.5 px-3">نوع الحدث</th>
              <th class="py-2.5 px-3">المحتوى</th>
              <th class="py-2.5 px-3">حالة التسليم</th>
              <th class="py-2.5 px-3">رسالة الخادم / الرمز</th>
            </tr>
          </thead>
          <tbody id="tgLogsTableBody" class="divide-y divide-slate-850/60 text-slate-300">
            <tr>
              <td colspan="5" class="py-8 text-center text-slate-500 text-xs">
                لا توجد إشعارات تيليجرام مسجلة (خدمة تيليجرام غير مُهيأة في بيئة الاختبار الحالية)
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

  </section>
  `;
}
