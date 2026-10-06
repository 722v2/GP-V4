import { ICONS } from "../theme.js";

export function renderMt5View(): string {
  return `
  <!-- ========================================================================= -->
  <!-- VIEW: MT5 REAL BROKER (وسيط MetaTrader 5 والحساب الحقيقي) -->
  <!-- ========================================================================= -->
  <section id="view-mt5" class="space-y-3.5 max-w-[1600px] mx-auto font-mono">

    <!-- MT5 Header -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div>
        <h1 class="text-base font-bold text-white flex items-center gap-2">
          ${ICONS.broker}
          <span>بوابة وسيط MetaTrader 5 والحساب الحقيقي (MT5 Real Account)</span>
        </h1>
        <p class="text-[11px] text-slate-400 mt-0.5">لوحة التحكم المركزية لإدارة حساب التداول الحقيقي والاتصال ومطابقة الصفقات والمواصفات اللحظية لعقود الذهب (XAU/USD).</p>
      </div>

      <div class="flex items-center gap-2">
        <button onclick="refreshMt5Status(true)" class="px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs flex items-center gap-1.5 transition">
          ${ICONS.refresh}
          <span>تحديث حالة الوسيط</span>
        </button>
        <button onclick="testMt5Connection()" class="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 font-bold text-black text-xs flex items-center gap-1.5 transition shadow">
          <span>اختبار الاتصال (Test)</span>
        </button>
      </div>
    </div>

    <!-- Feedback Notice Banner -->
    <div id="mt5NoticeBox" class="hidden p-3 rounded-lg border text-xs flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <span id="mt5NoticeIcon" class="w-2.5 h-2.5 rounded-full"></span>
        <span id="mt5NoticeText" class="font-bold"></span>
      </div>
      <button onclick="document.getElementById('mt5NoticeBox').classList.add('hidden')" class="text-slate-400 hover:text-white">&times;</button>
    </div>

    <!-- Top Grid: 1. Connection & 2. Account Balance -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3.5 text-xs">

      <!-- 1. CONNECTION (حالة الاتصال وبيانات الحساب) -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3.5 shadow-md">
        <div class="border-b border-slate-850 pb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-amber-500" id="mt5StatusDot"></span>
            <span class="font-bold text-white text-sm">بيانات الاتصال والوسيط (Broker Connection)</span>
          </div>
          <span id="mt5StatusBadge" class="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 font-bold">NOT CONFIGURED</span>
        </div>

        <form id="formMt5Account" onsubmit="event.preventDefault(); saveMt5Account();" class="space-y-3 bg-[#070A10] p-3 rounded-lg border border-slate-850">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">اسم الوسيط (Broker):</label>
              <input type="text" id="inputMt5Broker" value="JustMarkets" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">رقم الحساب (Login ID):</label>
              <input type="text" id="inputMt5Account" placeholder="e.g. 12345678" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">الخادم (Server):</label>
              <input type="text" id="inputMt5Server" placeholder="e.g. JustMarkets-Live" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500">
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">رمز الذهب لدى الوسيط:</label>
              <input type="text" id="inputMt5Symbol" value="XAUUSD" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500" required>
            </div>
            <div class="col-span-2">
              <label class="block text-slate-300 font-semibold mb-1 text-[11px]">عنوان جسر MT5 (Bridge Gateway URL):</label>
              <input type="url" id="inputMt5BridgeUrl" placeholder="http://127.0.0.1:8080 or https://mt5.internal" class="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500">
              <span class="text-[9px] text-slate-500">عنوان خادم الـ REST Gateway المتصل بـ MetaTrader 5 Terminal</span>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="pt-2 border-t border-slate-850 flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <button type="button" onclick="disconnectMt5()" id="btnDisconnectMt5" class="px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs transition">
                <span>قطع الاتصال</span>
              </button>
              <button type="button" onclick="confirmDeleteMt5Account()" id="btnDeleteMt5" class="px-3 py-1.5 rounded bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 text-xs transition">
                <span>حذف الحساب</span>
              </button>
            </div>
            <button type="submit" id="btnSaveMt5" class="px-4 py-1.5 rounded bg-amber-600 hover:bg-amber-500 font-bold text-black text-xs transition shadow">
              <span>حفظ بيانات الحساب (Save)</span>
            </button>
          </div>
        </form>

        <div class="space-y-1.5 text-[11px] text-slate-400 bg-slate-950/50 p-2.5 rounded border border-slate-900">
          <div class="flex justify-between">
            <span class="text-slate-500">آخر اتصال ناجح:</span>
            <span id="lblMt5LastConnected" class="text-slate-300">لم يتم الاتصال</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-500">تفاصيل الحالة:</span>
            <span id="lblMt5HealthDetail" class="text-slate-300 truncate max-w-[280px]">غير مهيأ</span>
          </div>
          <div class="flex justify-between" id="rowMt5LastError">
            <span class="text-slate-500">آخر خطأ:</span>
            <span id="lblMt5LastError" class="text-rose-400 font-bold truncate max-w-[280px]">لا يوجد</span>
          </div>
        </div>
      </div>

      <!-- 2. ACCOUNT FINANCIALS (أرصدة وهوامش الحساب الحقيقي) -->
      <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3.5 shadow-md">
        <div class="border-b border-slate-850 pb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <span class="font-bold text-white text-sm">بيانات الرصيد والهامش الحقيقي (MT5 Account State)</span>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800 font-bold">BROKER SOURCE OF TRUTH</span>
        </div>

        <p class="text-slate-400 text-[11px]">
          القيم أدناه مسترجعة مباشرة من وسيط التداول الحقيقي عبر جسر MT5. لا يتم اختراع أو توليد قيم وهمية.
        </p>

        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div class="bg-[#070A10] p-3 rounded-lg border border-slate-850">
            <div class="text-[10px] text-slate-500 font-semibold mb-0.5">الرصيد المالي (Balance)</div>
            <div id="lblMt5Balance" class="text-base font-bold text-white font-mono">$---</div>
          </div>
          <div class="bg-[#070A10] p-3 rounded-lg border border-slate-850">
            <div class="text-[10px] text-slate-500 font-semibold mb-0.5">صافي السيولة (Equity)</div>
            <div id="lblMt5Equity" class="text-base font-bold text-amber-400 font-mono">$---</div>
          </div>
          <div class="bg-[#070A10] p-3 rounded-lg border border-slate-850">
            <div class="text-[10px] text-slate-500 font-semibold mb-0.5">الهامش الحر (Free Margin)</div>
            <div id="lblMt5FreeMargin" class="text-base font-bold text-emerald-400 font-mono">$---</div>
          </div>
          <div class="bg-[#070A10] p-3 rounded-lg border border-slate-850">
            <div class="text-[10px] text-slate-500 font-semibold mb-0.5">الهامش المحجوز (Used Margin)</div>
            <div id="lblMt5UsedMargin" class="text-base font-bold text-rose-400 font-mono">$---</div>
          </div>
          <div class="bg-[#070A10] p-3 rounded-lg border border-slate-850">
            <div class="text-[10px] text-slate-500 font-semibold mb-0.5">مستوى الهامش (Margin Level)</div>
            <div id="lblMt5MarginLevel" class="text-base font-bold text-cyan-400 font-mono">---%</div>
          </div>
          <div class="bg-[#070A10] p-3 rounded-lg border border-slate-850">
            <div class="text-[10px] text-slate-500 font-semibold mb-0.5">العملة والرافعة</div>
            <div id="lblMt5CurrencyLeverage" class="text-base font-bold text-slate-300 font-mono">USD / 1:---</div>
          </div>
        </div>

        <div class="p-3 bg-[#070A10] rounded-lg border border-slate-850 flex items-center justify-between text-xs">
          <div class="flex items-center gap-2">
            <span class="text-slate-400">مطابقة المراكز مع سجل النظام:</span>
            <span id="lblReconciliationStatus" class="font-bold text-emerald-400">متطابق</span>
          </div>
          <button onclick="triggerMt5Reconciliation()" class="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-[11px] transition">
            <span>إعادة المطابقة (Reconcile)</span>
          </button>
        </div>
      </div>

    </div>

    <!-- 3. INSTRUMENT SPECIFICATION (مواصفات عقد XAU/USD لدى الوسيط) -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3.5 shadow-md text-xs">
      <div class="border-b border-slate-850 pb-2 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-cyan-500"></span>
          <span class="font-bold text-white text-sm">مواصفات الأداة المالية من الوسيط (Instrument Specification)</span>
        </div>
        <span class="text-[10px] px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800 font-bold">XAU/USD GOLD</span>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3" id="gridMt5Spec">
        <div class="bg-[#070A10] p-2.5 rounded border border-slate-850">
          <div class="text-[10px] text-slate-500">حجم العقد (Contract Size):</div>
          <div id="specContractSize" class="font-bold text-white font-mono mt-0.5">100 oz</div>
        </div>
        <div class="bg-[#070A10] p-2.5 rounded border border-slate-850">
          <div class="text-[10px] text-slate-500">الحد الأدنى للوت (Min Lot):</div>
          <div id="specMinLot" class="font-bold text-white font-mono mt-0.5">0.01</div>
        </div>
        <div class="bg-[#070A10] p-2.5 rounded border border-slate-850">
          <div class="text-[10px] text-slate-500">الحد الأقصى للوت (Max Lot):</div>
          <div id="specMaxLot" class="font-bold text-white font-mono mt-0.5">100.0</div>
        </div>
        <div class="bg-[#070A10] p-2.5 rounded border border-slate-850">
          <div class="text-[10px] text-slate-500">خطوة اللوت (Lot Step):</div>
          <div id="specLotStep" class="font-bold text-white font-mono mt-0.5">0.01</div>
        </div>
        <div class="bg-[#070A10] p-2.5 rounded border border-slate-850">
          <div class="text-[10px] text-slate-500">حجم النقطة (Point Size):</div>
          <div id="specPointSize" class="font-bold text-white font-mono mt-0.5">0.01</div>
        </div>
        <div class="bg-[#070A10] p-2.5 rounded border border-slate-850">
          <div class="text-[10px] text-slate-500">حجم التيك (Tick Size):</div>
          <div id="specTickSize" class="font-bold text-white font-mono mt-0.5">0.01</div>
        </div>
        <div class="bg-[#070A10] p-2.5 rounded border border-slate-850">
          <div class="text-[10px] text-slate-500">قيمة التيك (Tick Value):</div>
          <div id="specTickValue" class="font-bold text-white font-mono mt-0.5">$1.00</div>
        </div>
        <div class="bg-[#070A10] p-2.5 rounded border border-slate-850">
          <div class="text-[10px] text-slate-500">مسافة الوقف الأدنى (Stops Level):</div>
          <div id="specStopsLevel" class="font-bold text-amber-400 font-mono mt-0.5">0 pts</div>
        </div>
        <div class="bg-[#070A10] p-2.5 rounded border border-slate-850">
          <div class="text-[10px] text-slate-500">الخانة العشرية (Digits):</div>
          <div id="specDigits" class="font-bold text-white font-mono mt-0.5">2</div>
        </div>
        <div class="bg-[#070A10] p-2.5 rounded border border-slate-850">
          <div class="text-[10px] text-slate-500">رمز الوسيط (Broker Symbol):</div>
          <div id="specBrokerSymbol" class="font-bold text-cyan-400 font-mono mt-0.5">XAUUSD</div>
        </div>
      </div>
    </div>

    <!-- 4. OPEN POSITIONS & PENDING ORDERS TABLE -->
    <div class="bg-[#090D15] border border-slate-800 rounded-lg p-4 space-y-3.5 shadow-md text-xs">
      <div class="border-b border-slate-850 pb-2 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
          <span class="font-bold text-white text-sm">المراكز المفتوحة والأوامر المعلقة في MT5 (Live Positions & Orders)</span>
        </div>
        <span class="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-400 font-mono" id="lblMt5PositionsCount">0 مراكز مفتوحة</span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-right font-mono text-[11px]">
          <thead class="bg-[#070A10] text-slate-400 border-b border-slate-800">
            <tr>
              <th class="p-2">معرف التذكرة (Ticket)</th>
              <th class="p-2">الأداة</th>
              <th class="p-2">النوع</th>
              <th class="p-2">الحجم (Lots)</th>
              <th class="p-2">سعر الدخول</th>
              <th class="p-2">السعر الحالي</th>
              <th class="p-2">وقف الخسارة (SL)</th>
              <th class="p-2">جني الأرباح (TP)</th>
              <th class="p-2">الربح/الخسارة (PnL)</th>
              <th class="p-2">الحماية</th>
            </tr>
          </thead>
          <tbody id="tblMt5PositionsBody" class="divide-y divide-slate-850">
            <tr>
              <td colspan="10" class="p-4 text-center text-slate-500 font-sans">لا توجد مراكز مفتوحة حالياً لدى الوسيط.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

  </section>
  `;
}
