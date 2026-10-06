import { ICONS } from "../theme.js";

export function renderSettingsView(): string {
  return `
  <!-- ========================================================================= -->
  <!-- VIEW: SETTINGS (إعدادات المشغل وتكوين النظام ورأس المال) -->
  <!-- ========================================================================= -->
  <section id="view-settings" class="space-y-3.5 max-w-[1600px] mx-auto font-mono">
    
    <!-- Settings Header -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div>
        <h1 class="text-base font-bold text-white flex items-center gap-2">
          ${ICONS.settings}
          <span>إعدادات المشغل وتكوين النظام ورأس المال (Operator Settings & Runtime Config)</span>
        </h1>
        <p class="text-[11px] text-slate-400 mt-0.5">لوحة التحكم المركزية لتعديل معايير التشغيل والمخاطر ورأس المال والفلاتر مع تطبيق فوري على المحرك دون إعادة تشغيل.</p>
      </div>

      <div class="flex items-center gap-2">
        <button onclick="refreshSettings(true)" class="px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs flex items-center gap-1.5 transition">
          ${ICONS.refresh}
          <span>استعادة الإعدادات</span>
        </button>
      </div>
    </div>

    <!-- Feedback Notification Banner -->
    <div id="settingsNoticeBox" class="hidden p-3 rounded-lg border text-xs flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <span id="settingsNoticeIcon" class="w-2.5 h-2.5 rounded-full"></span>
        <span id="settingsNoticeText" class="font-bold"></span>
      </div>
      <button onclick="document.getElementById('settingsNoticeBox').classList.add('hidden')" class="text-slate-400 hover:text-white">&times;</button>
    </div>

    <!-- Grid of Settings Sections -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3.5 text-xs">
      
      <!-- 1. ACCOUNT CAPITAL (رأس مال الحساب التشغيلي - MANDATORY) -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3.5 shadow-md">
        <div class="border-b border-slate-850 pb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
            <span class="font-bold text-white text-sm">رأس مال الحساب التشغيلي (Account Capital)</span>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800 font-bold">DEV RUNTIME CAPITAL</span>
        </div>

        <p class="text-slate-400 text-[11px] leading-relaxed">
          القيمة المعتمدة لحساب سقف المخاطرة في محرك المخاطر الداخلي (DEV / SIMULATED ACCOUNT CAPITAL). تغيير هذه القيمة يُحدّث محرك المخاطر (Risk Engine) فورياً دون إعادة تشغيل الخادم.
        </p>

        <form id="formAccountCapital" onsubmit="event.preventDefault(); saveAccountCapital();" class="space-y-3 bg-[#070A10] p-3 rounded-lg border border-slate-850">
          <div>
            <label class="block text-slate-300 font-semibold mb-1 text-[11px]">رأس المال المحاسبي (Account Equity / Capital):</label>
            <div class="relative flex items-center">
              <span class="absolute right-3 text-slate-500 font-bold">$</span>
              <input type="number" id="inputAccountEquity" step="any" min="0.01" class="w-full bg-slate-900 border border-slate-700 rounded px-3 pr-7 py-2 text-white font-mono text-sm focus:outline-none focus:border-amber-500 transition" required>
              <span class="absolute left-3 text-slate-500 text-xs">USD</span>
            </div>
            <div class="flex items-center justify-between mt-1 text-[10px] text-slate-500">
              <span>قيمة عددية موجبة حقيقية (حسب رصيد الحساب أو خطة التداول)</span>
              <span>القيمة الحالية المعتمدة: <strong id="lblCurrentCapital" class="text-amber-400 font-bold">$---</strong></span>
            </div>
          </div>

          <div class="pt-1 flex items-center justify-between">
            <span class="text-[10px] text-slate-500" id="lblCapitalLastUpdated">آخر تحديث: متزامن</span>
            <button type="submit" id="btnSaveCapital" class="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 font-bold text-black text-xs transition shadow flex items-center gap-1.5">
              <span>حفظ رأس المال (Save Capital)</span>
            </button>
          </div>
        </form>
      </div>

      <!-- 2. RISK PARAMETERS (معايير سقف المخاطر - MANDATORY) -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3.5 shadow-md">
        <div class="border-b border-slate-850 pb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
            <span class="font-bold text-white text-sm">معايير سقف المخاطر (Risk Engine Parameters)</span>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800 font-bold">HOT-UPDATE</span>
        </div>

        <form id="formRiskSettings" onsubmit="event.preventDefault(); saveRiskSettings();" class="space-y-3 bg-[#070A10] p-3 rounded-lg border border-slate-850">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">المخاطرة / الصفقة (% Per Trade):</label>
              <input type="number" id="inputPerTradePct" step="any" min="0.0001" max="100" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">نسبة المخاطرة لكل صفقة</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">أقصى تراجع (% Max Drawdown):</label>
              <input type="number" id="inputMaxDrawdownPct" step="any" min="0.01" max="100" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">سقف قاطع الدائرة</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">سقف الخسارة اليومية (% Daily Cap):</label>
              <input type="number" id="inputDailyLossCapPct" step="any" min="0.01" max="100" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">حظر التداول لليوم</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">سقف الخسارة الأسبوعية (% Weekly Cap):</label>
              <input type="number" id="inputWeeklyLossCapPct" step="any" min="0.01" max="100" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">حظر التداول للأسبوع</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">الصفقات المتزامنة (Max Open):</label>
              <input type="number" id="inputMaxOpenTrades" step="1" min="1" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">سقف الصفقات المفتوحة</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">أقصى تعرض كلي (Max Exposure Lots):</label>
              <input type="number" id="inputNetExposureMax" step="any" min="0.01" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">مجموع عقود اللوت</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">الحد الأقصى للوت (Max Lot):</label>
              <input type="number" id="inputMaxLot" step="any" min="0.01" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">سقف حجم العقد</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">سقف الهامش المستهلك (% Margin):</label>
              <input type="number" id="inputMarginCeilingPct" step="any" min="0.01" max="100" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">سقف حجز الرصيد</span>
            </div>
          </div>

          <div class="pt-2 border-t border-slate-850 flex items-center justify-between">
            <span class="text-[10px] text-slate-500">التحديث يُطبق مباشرة على RiskStateTracker</span>
            <button type="submit" id="btnSaveRisk" class="px-4 py-1.5 rounded bg-rose-600 hover:bg-rose-500 font-bold text-white text-xs transition shadow">
              <span>حفظ حدود المخاطر (Save Risk)</span>
            </button>
          </div>
        </form>
      </div>

      <!-- 3. SCANNER & TIMING (الماسح اللحظي وفترة الصلاحية) -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3.5 shadow-md">
        <div class="border-b border-slate-850 pb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-cyan-500"></span>
            <span class="font-bold text-white text-sm">الماسح اللحظي وتوقيت النماذج (Scanner Settings)</span>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800 font-bold">SCANNER ENGINE</span>
        </div>

        <form id="formScannerSettings" onsubmit="event.preventDefault(); saveScannerSettings();" class="space-y-3 bg-[#070A10] p-3 rounded-lg border border-slate-850">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">معدل نبضات الفحص (Interval ms):</label>
              <input type="number" id="inputScanIntervalMs" step="1000" min="1000" max="600000" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">افتراضي: 60,000 ms (1 دقيقة)</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">انتهاء صلاحية النموذج (Expiry Bars):</label>
              <input type="number" id="inputStrategyExpiryBars" step="1" min="1" max="100" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">عدد الشموع قبل الإلغاء</span>
            </div>
          </div>

          <div class="pt-2 border-t border-slate-850 flex items-center justify-between">
            <span class="text-[10px] text-slate-500">يُطبق على ScannerScheduler دون إعادة تشغيل</span>
            <button type="submit" id="btnSaveScanner" class="px-4 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 font-bold text-black text-xs transition shadow">
              <span>حفظ إعدادات الماسح</span>
            </button>
          </div>
        </form>
      </div>

      <!-- 4. MARKET & SESSION FILTERS (فلاتر بيئة السوق) -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3.5 shadow-md">
        <div class="border-b border-slate-850 pb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <span class="font-bold text-white text-sm">فلاتر بيئة السوق (Market Filters)</span>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800 font-bold">FILTERS</span>
        </div>

        <form id="formMarketFilters" onsubmit="event.preventDefault(); saveMarketFilters();" class="space-y-3 bg-[#070A10] p-3 rounded-lg border border-slate-850">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">فلتر السبريد (Spread Filter):</label>
              <select id="selectSpreadFilter" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500">
                <option value="false">معطل (السماح بالتداول)</option>
                <option value="true">مفعل (حظر فوق الحد)</option>
              </select>
              <span class="text-[9px] text-slate-500">حظر الإشارات عند اتساع السبريد</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">الحد الأقصى للسبريد (Max Spread Pts):</label>
              <input type="number" id="inputMaxSpreadPoints" step="0.1" min="0.1" max="50.0" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">أقصى فارق سعري مسموح</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">فلتر جلسات التداول (Session Filter):</label>
              <select id="selectSessionFilter" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500">
                <option value="false">معطل (كافة الجلسات)</option>
                <option value="true">مفعل (جلسات محددة)</option>
              </select>
              <span class="text-[9px] text-slate-500">حظر خارج الجلسات المعتمدة</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">الجلسات المسموحة (Allowed Sessions):</label>
              <input type="text" id="inputAllowedSessions" placeholder="LONDON,NEW_YORK" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">مفصولة بفاصلة (ASIA, LONDON, NEW_YORK)</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">فلتر الأخبار (News Filter):</label>
              <select id="selectNewsFilter" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500">
                <option value="false">معطل</option>
                <option value="true">مفعل</option>
              </select>
              <span class="text-[9px] text-slate-500">تعليق التداول حول الأخبار</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">نافذة الأخبار (News Window Minutes):</label>
              <input type="number" id="inputNewsWindowMinutes" step="5" min="5" max="1440" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">دقائق الحظر قبل وبعد الحدث</span>
            </div>
          </div>

          <div class="pt-2 border-t border-slate-850 flex items-center justify-between">
            <span class="text-[10px] text-slate-500">يُطبق على MarketFilterEngine</span>
            <button type="submit" id="btnSaveFilters" class="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 font-bold text-white text-xs transition shadow">
              <span>حفظ فلاتر السوق</span>
            </button>
          </div>
        </form>
      </div>

      <!-- 5. STRATEGIES (النماذج والاستراتيجيات) -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3.5 shadow-md">
        <div class="border-b border-slate-850 pb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
            <span class="font-bold text-white text-sm">النماذج والاستراتيجيات (Strategies & Memory)</span>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800 font-bold">EXECUTION LOGIC</span>
        </div>

        <form id="formStrategies" onsubmit="event.preventDefault(); saveStrategySettings();" class="space-y-3 bg-[#070A10] p-3 rounded-lg border border-slate-850">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">استراتيجية الشمعة القوية (Strong Candle):</label>
              <select id="selectStrongCandle" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500">
                <option value="true">مفعلة (استراتيجية رئيسية)</option>
                <option value="false">معطلة</option>
              </select>
              <span class="text-[9px] text-slate-500">توليد نماذج الإعداد السعري</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">ذاكرة التجارب (Experience Memory):</label>
              <select id="selectExpMemory" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500">
                <option value="false">معطلة (Default DEV)</option>
                <option value="true">مفعلة</option>
              </select>
              <span class="text-[9px] text-slate-500">تخزين الدروس المستفادة</span>
            </div>
          </div>

          <div class="pt-2 border-t border-slate-850 flex items-center justify-between">
            <span class="text-[10px] text-slate-500">تعديل سلوك توليد الصفقات</span>
            <button type="submit" id="btnSaveStrategies" class="px-4 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 font-bold text-white text-xs transition shadow">
              <span>حفظ خيارات الاستراتيجية</span>
            </button>
          </div>
        </form>
      </div>

      <!-- 6. AI ADVISORY (إعدادات الذكاء الاصطناعي التشغيلية) -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3.5 shadow-md">
        <div class="border-b border-slate-850 pb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-purple-500"></span>
            <span class="font-bold text-white text-sm">استشارات الذكاء الاصطناعي (AI Advisory Config)</span>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800 font-bold">NON-SECRET SETTINGS</span>
        </div>

        <p class="text-slate-400 text-[11px]">
          ملاحظة أمنية: مفتاح AI API Key (NVIDIA NIM) يعتبر سراً محفوظاً بالبيئة ولا يُعرض بالواجهة. الإعدادات التشغيلية أدناه قابلة للتعديل والتحكم.
        </p>

        <form id="formAiSettings" onsubmit="event.preventDefault(); saveAiSettings();" class="space-y-3 bg-[#070A10] p-3 rounded-lg border border-slate-850">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">تفعيل استشارات AI (AI Enabled):</label>
              <select id="selectAiEnabled" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500">
                <option value="true">مفعل (استشاري)</option>
                <option value="false">معطل</option>
              </select>
              <span class="text-[9px] text-slate-500">الذكاء الاصطناعي استشاري وليس حاكماً</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">الحد الأدنى للثقة (Min Confidence):</label>
              <input type="number" id="inputAiMinConfidence" step="0.05" min="0.1" max="1.0" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">افتراضي: 0.60 (60%)</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">النموذج الرئيسي (Primary Model):</label>
              <input type="text" id="inputAiModel" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">deepseek/deepseek-r1</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">نموذج M5 السريع (M5 Fast Model):</label>
              <input type="text" id="inputAiM5Model" placeholder="اختياري" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500">
              <span class="text-[9px] text-slate-500">نموذج الاستجابة السريعة</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">مهلة الانتظار (Timeout ms):</label>
              <input type="number" id="inputAiTimeoutMs" step="1000" min="5000" max="120000" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">افتراضي: 45,000 ms</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">سماحية المستويات (Tolerance Pts):</label>
              <input type="number" id="inputAiLevelTolerance" step="0.5" min="0.1" max="10.0" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">أقصى تباعد مسموح بالنقاط</span>
            </div>
          </div>

          <div class="pt-2 border-t border-slate-850 flex items-center justify-between">
            <span class="text-[10px] text-slate-500">يُطبق على AiRouter دون إعادة تشغيل</span>
            <button type="submit" id="btnSaveAi" class="px-4 py-1.5 rounded bg-purple-600 hover:bg-purple-500 font-bold text-white text-xs transition shadow">
              <span>حفظ إعدادات AI</span>
            </button>
          </div>
        </form>
      </div>

      <!-- 7. PERSISTENCE & STORAGE (التخزين والمزامنة) -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3.5 shadow-md">
        <div class="border-b border-slate-850 pb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
            <span class="font-bold text-white text-sm">التخزين والمزامنة (Persistence & Retries)</span>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800 font-bold">RUNTIME STORE</span>
        </div>

        <p class="text-slate-400 text-[11px]">
          في بيئة التطوير الحالية، يتم حفظ الإعدادات عبر Runtime Config Store المحلي (ملف محلي / ذاكرة حية) دون الحاجة لسوبابيز.
        </p>

        <form id="formPersistence" onsubmit="event.preventDefault(); savePersistenceSettings();" class="space-y-3 bg-[#070A10] p-3 rounded-lg border border-slate-850">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">تفعيل المزامنة (Persistence Enabled):</label>
              <select id="selectPersistenceEnabled" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500">
                <option value="true">مفعل (تخزين محلي / سحابي)</option>
                <option value="false">معطل</option>
              </select>
              <span class="text-[9px] text-slate-500">حفظ الصفقات والإعدادات</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">أقصى محاولات إعادة (Max Retries):</label>
              <input type="number" id="inputPersistMaxRetries" step="1" min="0" max="10" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">افتراضي: 3 محاولات</span>
            </div>
          </div>

          <div class="pt-2 border-t border-slate-850 flex items-center justify-between">
            <span class="text-[10px] text-slate-500">يُطبق على طبقة PersistenceRetry</span>
            <button type="submit" id="btnSavePersistence" class="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 font-bold text-white text-xs transition shadow">
              <span>حفظ خيارات التخزين</span>
            </button>
          </div>
        </form>
      </div>

      <!-- 8. EXECUTION & VENUE (بيئة التنفيذ والمحاكاة) -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3.5 shadow-md">
        <div class="border-b border-slate-850 pb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-teal-500"></span>
            <span class="font-bold text-white text-sm">بيئة التنفيذ والمحاكاة (Execution & Spread Model)</span>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded bg-teal-950/80 text-teal-300 border border-teal-800 font-bold">PAPER BROKER</span>
        </div>

        <form id="formExecution" onsubmit="event.preventDefault(); saveExecutionSettings();" class="space-y-3 bg-[#070A10] p-3 rounded-lg border border-slate-850">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">بيئة التنفيذ (Venue):</label>
              <select id="selectExecutionVenue" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500">
                <option value="BROKER">وسيط MT5 حقيقي (MetaTrader 5 Real Broker)</option>
                <option value="SIMULATED">محاكاة واختبار داخلي (SIMULATED / TEST)</option>
              </select>
              <span class="text-[9px] text-slate-500">التنفيذ الحي يتطلب تهيئة حساب MT5</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">سبريد المحاكاة (Spread Points):</label>
              <input type="number" id="inputExecSpread" step="0.05" min="0.0" max="10.0" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">افتراضي: 0.35 نقطة</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">الانزلاق السعري (Slippage Points):</label>
              <input type="number" id="inputExecSlippage" step="0.05" min="0.0" max="10.0" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">افتراضي: 0.20 نقطة</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">زمن الاستجابة (Latency ms):</label>
              <input type="number" id="inputExecLatency" step="50" min="0" max="5000" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
              <span class="text-[9px] text-slate-500">افتراضي: 250 ms</span>
            </div>
          </div>

          <div class="pt-2 border-t border-slate-850 flex items-center justify-between">
            <span class="text-[10px] text-slate-500">يُطبق على SpreadSlippageModel فورياً</span>
            <button type="submit" id="btnSaveExecution" class="px-4 py-1.5 rounded bg-teal-600 hover:bg-teal-500 font-bold text-white text-xs transition shadow">
              <span>حفظ إعدادات المحاكاة</span>
            </button>
          </div>
        </form>
      </div>

      <!-- 9. TELEGRAM CHANNEL (قناة تيليجرام التشغيلية) -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3.5 shadow-md">
        <div class="border-b border-slate-850 pb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-sky-500"></span>
            <span class="font-bold text-white text-sm">قناة إشعارات تيليجرام (Telegram Config)</span>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded bg-sky-950/80 text-sky-300 border border-sky-800 font-bold">OPERATIONAL</span>
        </div>

        <form id="formTelegram" onsubmit="event.preventDefault(); saveTelegramSettings();" class="space-y-3 bg-[#070A10] p-3 rounded-lg border border-slate-850">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">تفعيل الإشعارات (Telegram Enabled):</label>
              <select id="selectTgEnabled" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500">
                <option value="false">معطل (Default DEV)</option>
                <option value="true">مفعل</option>
              </select>
              <span class="text-[9px] text-slate-500">يتطلب Bot Token سري بالبيئة</span>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">معرف المحادثة (Chat ID):</label>
              <input type="text" id="inputTgChatId" placeholder="@channel_id أو رقمي" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500">
              <span class="text-[9px] text-slate-500">معرف القناة أو المشغل</span>
            </div>
          </div>

          <div class="pt-2 border-t border-slate-850 flex items-center justify-between">
            <span class="text-[10px] text-slate-500">بوت توكن يُدار عبر متغيرات البيئة فقط</span>
            <button type="submit" id="btnSaveTelegram" class="px-4 py-1.5 rounded bg-sky-600 hover:bg-sky-500 font-bold text-white text-xs transition shadow">
              <span>حفظ إعدادات تيليجرام</span>
            </button>
          </div>
        </form>

        <!-- Auto-Discovery Panel -->
        <div class="bg-[#070A10] p-3 rounded-lg border border-slate-850 space-y-2 mt-3 text-[11px] font-mono">
          <div class="flex items-center justify-between border-b border-slate-850 pb-1.5">
            <span class="font-bold text-slate-300">الربط التلقائي الآمن (Secure Auto-Discovery)</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded text-slate-200 font-bold bg-slate-800" id="lblTgDiscoveryStatus">--</span>
          </div>
          
          <div class="grid grid-cols-2 gap-2 text-slate-400 text-[10px]">
            <div>معرف المحادثة المكتشف: <span id="lblTgDiscoveredId" class="text-white font-bold">--</span></div>
            <div>نوع الكشف: <span id="lblTgDiscoveryType" class="text-white font-bold">--</span></div>
            <div>حالة التحقق: <span id="lblTgVerificationStatus" class="text-white font-bold">--</span></div>
            <div>رمز المطالبة: <span id="lblTgClaimCode" class="text-amber-400 font-bold">--</span></div>
          </div>

          <div class="pt-2 flex items-center justify-between gap-2 border-t border-slate-850">
            <span class="text-[9px] text-slate-500 max-w-[70%] leading-normal">أنشئ رمز المطالبة، ثم أرسله كرسالة خاصة إلى البوت لإثبات ملكية المحادثة فورياً.</span>
            <button onclick="requestTelegramClaimCode()" type="button" class="px-2.5 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-black font-bold text-[10px] transition">
              توليد رمز المطالبة
            </button>
          </div>
        </div>
      </div>

    </div>

    <!-- 10. SYSTEM AUDIT TRAIL (سجل تدقيق التعديلات التشغيلية) -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3 shadow-md">
      <div class="border-b border-slate-850 pb-2 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
          <h2 class="font-bold text-white text-sm">سجل تدقيق التعديلات التشغيلية (Runtime Config Audit Trail)</h2>
        </div>
        <span class="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 font-mono" id="auditCountLabel">0 تعديلات مسجلة</span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-right text-xs">
          <thead>
            <tr class="bg-[#070A10]/80 text-slate-500 text-[11px] border-b border-slate-850 font-mono">
              <th class="py-2.5 px-3">التوقيت (UTC)</th>
              <th class="py-2.5 px-3">المشغل (Operator)</th>
              <th class="py-2.5 px-3">القسم (Section)</th>
              <th class="py-2.5 px-3">تفاصيل التغيير (Changes)</th>
            </tr>
          </thead>
          <tbody id="auditTableBody" class="divide-y divide-slate-850/60 text-slate-300 font-mono">
            <tr>
              <td colspan="4" class="py-6 text-center text-slate-500 text-xs">
                لم يتم تسجيل أي تعديلات تشغيلية بعد. التعديلات المطبقة ستظهر هنا فورياً مع تفاصيل الحقول القديمة والجديدة.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Integrations & Persistence Truth Statement (CRITICAL REQUIREMENT) -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3 shadow-md">
      <div class="border-b border-slate-850 pb-2 flex items-center justify-between">
        <h2 class="font-bold text-white text-sm">حالة الربط الخارجي والتخزين في بيئة التطوير (Integrations & Persistence Truth)</h2>
        <span class="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">ZERO-CONFIG DEV REALITY</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <div class="bg-[#070A10] p-3 rounded border border-slate-850 space-y-1">
          <span class="text-slate-500 text-[10px] block">قاعدة بيانات Supabase</span>
          <span class="text-rose-400 font-bold block" id="setSupabaseState">NOT CONNECTED</span>
          <p class="text-[10px] text-slate-500 leading-relaxed">يتم حفظ الإعدادات في الذاكرة ومخزن الإعدادات المحلي (Dev Local Store). لا يتم الادعاء بالاتصال بسوبابيز في Phase 1.</p>
        </div>
        <div class="bg-[#070A10] p-3 rounded border border-slate-850 space-y-1">
          <span class="text-slate-500 text-[10px] block">مزود السوق Biquiti</span>
          <span class="text-rose-400 font-bold block" id="setBiquitiState">NOT CONNECTED</span>
          <p class="text-[10px] text-slate-500 leading-relaxed">المزود غير مُهيأ في بيئة التطوير الحالية، ويتم الاعتماد على الشموع الاختبارية المعتمدة.</p>
        </div>
        <div class="bg-[#070A10] p-3 rounded border border-slate-850 space-y-1">
          <span class="text-slate-500 text-[10px] block">الذكاء الاصطناعي (NVIDIA NIM)</span>
          <span class="text-rose-400 font-bold block" id="setNovitaState">NOT CONNECTED</span>
          <p class="text-[10px] text-slate-500 leading-relaxed">خدمة الذكاء الاصطناعي غير متصلة. الذكاء الاصطناعي نظام استشاري فني غير حاكم.</p>
        </div>
        <div class="bg-[#070A10] p-3 rounded border border-slate-850 space-y-1">
          <span class="text-slate-500 text-[10px] block">وسيط MT5 والتنفيذ</span>
          <span class="text-rose-400 font-bold block">DEFERRED</span>
          <p class="text-[10px] text-slate-500 leading-relaxed">وسيط MT5 مؤجل. التنفيذ الحقيقي غير متاح، والوسيط النشط هو Paper Broker (محاكاة ورقية آمنة).</p>
        </div>
      </div>
    </div>

  </section>
  `;
}
