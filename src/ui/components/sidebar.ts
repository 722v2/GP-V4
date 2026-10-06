import { ICONS } from "../theme.js";

export function renderSidebar(): string {
  return `
  <!-- Desktop Compact Fixed Sidebar -->
  <aside id="mainSidebar" class="w-56 bg-[#090D15] border-l border-slate-800 flex flex-col shrink-0 select-none z-20 hidden md:flex font-mono">
    
    <!-- Navigation Items List -->
    <nav class="flex-1 overflow-y-auto p-2 space-y-0.5 text-xs">
      
      <div class="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">نواة العمليات (Core)</div>

      <button id="nav-dashboard" onclick="switchTab('dashboard')" class="w-full flex items-center justify-between px-2.5 py-2 rounded transition text-right text-amber-400 bg-amber-950/40 border-r-2 border-amber-500 font-semibold group">
        <div class="flex items-center gap-2">
          ${ICONS.dashboard}
          <span>لوحة العمليات</span>
        </div>
        <span class="text-[9px] px-1 py-0.2 rounded bg-amber-900/60 text-amber-300 border border-amber-700/60">MAIN</span>
      </button>

      <button id="nav-market" onclick="switchTab('market')" class="w-full flex items-center justify-between px-2.5 py-2 rounded transition text-right text-slate-400 hover:text-white hover:bg-slate-900/60 group">
        <div class="flex items-center gap-2">
          ${ICONS.market}
          <span>شاشة السوق والسيولة</span>
        </div>
        <span class="text-[9px] px-1 py-0.2 rounded bg-slate-900 text-slate-400" id="badgeMarket">XAU</span>
      </button>

      <button id="nav-scanner" onclick="switchTab('scanner')" class="w-full flex items-center justify-between px-2.5 py-2 rounded transition text-right text-slate-400 hover:text-white hover:bg-slate-900/60 group">
        <div class="flex items-center gap-2">
          ${ICONS.scanner}
          <span>الماسح اللحظي (30)</span>
        </div>
        <span class="text-[9px] px-1 py-0.2 rounded bg-slate-900 text-slate-400" id="badgeScanner">PULSE</span>
      </button>

      <div class="pt-2 px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">الاستراتيجية والتنفيذ</div>

      <button id="nav-setups" onclick="switchTab('setups')" class="w-full flex items-center justify-between px-2.5 py-2 rounded transition text-right text-slate-400 hover:text-white hover:bg-slate-900/60 group">
        <div class="flex items-center gap-2">
          ${ICONS.setups}
          <span>نماذج الإعداد (Setups)</span>
        </div>
        <span class="text-[9px] px-1 py-0.2 rounded bg-slate-900 text-slate-400" id="badgeSetups">0</span>
      </button>

      <button id="nav-signals" onclick="switchTab('signals')" class="w-full flex items-center justify-between px-2.5 py-2 rounded transition text-right text-slate-400 hover:text-white hover:bg-slate-900/60 group">
        <div class="flex items-center gap-2">
          ${ICONS.signals}
          <span>الإشارات الحتمية</span>
        </div>
        <span class="text-[9px] px-1 py-0.2 rounded bg-slate-900 text-slate-400" id="badgeSignals">0</span>
      </button>

      <button id="nav-trades" onclick="switchTab('trades')" class="w-full flex items-center justify-between px-2.5 py-2 rounded transition text-right text-slate-400 hover:text-white hover:bg-slate-900/60 group">
        <div class="flex items-center gap-2">
          ${ICONS.trades}
          <span>دفتر الصفقات والمراكز</span>
        </div>
        <span class="text-[9px] px-1 py-0.2 rounded bg-slate-900 text-slate-400" id="badgeTrades">0</span>
      </button>

      <div class="pt-2 px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">المخاطر والأمان</div>

      <button id="nav-risk" onclick="switchTab('risk')" class="w-full flex items-center justify-between px-2.5 py-2 rounded transition text-right text-slate-400 hover:text-white hover:bg-slate-900/60 group">
        <div class="flex items-center gap-2">
          ${ICONS.risk}
          <span>مركز إدارة المخاطر</span>
        </div>
        <span class="text-[9px] px-1 py-0.2 rounded bg-slate-900 text-emerald-400" id="badgeRisk">OK</span>
      </button>

      <button id="nav-ai" onclick="switchTab('ai')" class="w-full flex items-center justify-between px-2.5 py-2 rounded transition text-right text-slate-400 hover:text-white hover:bg-slate-900/60 group">
        <div class="flex items-center gap-2">
          ${ICONS.ai}
          <span>استشارات AI</span>
        </div>
        <span class="text-[9px] px-1 py-0.2 rounded bg-slate-900 text-slate-400">ADV</span>
      </button>

      <div class="pt-2 px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">المحاكاة والتحقق</div>

      <button id="nav-backtest" onclick="switchTab('backtest')" class="w-full flex items-center justify-between px-2.5 py-2 rounded transition text-right text-slate-400 hover:text-white hover:bg-slate-900/60 group">
        <div class="flex items-center gap-2">
          ${ICONS.backtest}
          <span>الاختبار التاريخي والمحاكي</span>
        </div>
        <span class="text-[9px] px-1 py-0.2 rounded bg-slate-900 text-slate-400">SIM</span>
      </button>

      <div class="pt-2 px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">النظام والتحكم</div>

      <button id="nav-mt5" onclick="switchTab('mt5')" class="w-full flex items-center justify-between px-2.5 py-2 rounded transition text-right text-slate-400 hover:text-white hover:bg-slate-900/60 group">
        <div class="flex items-center gap-2">
          ${ICONS.broker}
          <span>وسيط MT5 والحساب الحقيقي</span>
        </div>
        <span class="text-[9px] px-1 py-0.2 rounded bg-slate-900 text-rose-400 font-bold" id="badgeMt5">MT5</span>
      </button>

      <button id="nav-telegram" onclick="switchTab('telegram')" class="w-full flex items-center justify-between px-2.5 py-2 rounded transition text-right text-slate-400 hover:text-white hover:bg-slate-900/60 group">
        <div class="flex items-center gap-2">
          ${ICONS.telegram}
          <span>مركز تحكم تيليجرام</span>
        </div>
        <span class="text-[9px] px-1 py-0.2 rounded bg-slate-900 text-slate-500" id="badgeTelegram">OFF</span>
      </button>

      <button id="nav-system" onclick="switchTab('system')" class="w-full flex items-center justify-between px-2.5 py-2 rounded transition text-right text-slate-400 hover:text-white hover:bg-slate-900/60 group">
        <div class="flex items-center gap-2">
          ${ICONS.system}
          <span>صحة الخدمات والمطابقة</span>
        </div>
        <span class="text-[9px] px-1 py-0.2 rounded bg-slate-900 text-cyan-400" id="badgeSystem">SYS</span>
      </button>

      <button id="nav-settings" onclick="switchTab('settings')" class="w-full flex items-center justify-between px-2.5 py-2 rounded transition text-right text-slate-400 hover:text-white hover:bg-slate-900/60 group">
        <div class="flex items-center gap-2">
          ${ICONS.settings}
          <span>إعدادات المشغل ورأس المال</span>
        </div>
        <span class="text-[9px] px-1 py-0.2 rounded bg-slate-900 text-amber-400">EDIT</span>
      </button>

    </nav>

    <!-- Sidebar Bottom Status Footer -->
    <div class="p-2.5 border-t border-slate-800 bg-[#070A10] text-[10px] text-slate-400 space-y-1.5">
      <div class="flex items-center justify-between">
        <span class="text-slate-500">مزود البيانات:</span>
        <span class="text-rose-400 font-bold" id="sideProviderText">NOT CONNECTED</span>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-slate-500">منفذ التداول:</span>
        <span class="text-amber-400 font-bold">PAPER (SIM)</span>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-slate-500">وسيط MT5:</span>
        <span class="text-rose-400 font-bold">DEFERRED</span>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-slate-500">قاعدة البيانات:</span>
        <span class="text-slate-400 font-bold">IN-MEMORY (DEV)</span>
      </div>
    </div>
  </aside>

  <!-- Mobile Bottom Navigation (Visible only on small viewports) -->
  <nav class="md:hidden fixed bottom-0 inset-x-0 h-14 bg-[#090D15] border-t border-slate-800 flex items-center justify-around z-30 select-none font-mono text-[10px]">
    <button onclick="switchTab('dashboard')" id="mob-dashboard" class="flex flex-col items-center gap-1 text-amber-400 py-1 px-2">
      ${ICONS.dashboard}
      <span>الرئيسية</span>
    </button>
    <button onclick="switchTab('market')" id="mob-market" class="flex flex-col items-center gap-1 text-slate-400 hover:text-white py-1 px-2">
      ${ICONS.market}
      <span>السوق</span>
    </button>
    <button onclick="switchTab('scanner')" id="mob-scanner" class="flex flex-col items-center gap-1 text-slate-400 hover:text-white py-1 px-2">
      ${ICONS.scanner}
      <span>الماسح</span>
    </button>
    <button onclick="switchTab('trades')" id="mob-trades" class="flex flex-col items-center gap-1 text-slate-400 hover:text-white py-1 px-2">
      ${ICONS.trades}
      <span>الصفقات</span>
    </button>
    <button onclick="toggleMobileDrawer()" id="mob-more" class="flex flex-col items-center gap-1 text-slate-400 hover:text-white py-1 px-2">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7"></path></svg>
      <span>المزيد</span>
    </button>
  </nav>

  <!-- Mobile Full Drawer Backdrop & Panel -->
  <div id="mobileDrawerBackdrop" onclick="toggleMobileDrawer()" class="fixed inset-0 bg-black/70 z-40 hidden md:hidden transition-opacity"></div>
  <div id="mobileDrawer" class="fixed inset-y-0 right-0 w-72 bg-[#090D15] border-l border-slate-800 z-50 transform translate-x-full transition-transform duration-200 md:hidden flex flex-col font-mono">
    <div class="p-3.5 border-b border-slate-800 flex items-center justify-between">
      <span class="font-bold text-sm text-white">قائمة عمليات التيرمينال</span>
      <button onclick="toggleMobileDrawer()" class="p-1 text-slate-400 hover:text-white">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
      </button>
    </div>
    <div class="flex-1 overflow-y-auto p-2.5 space-y-1 text-xs">
      <button onclick="switchTab('dashboard'); toggleMobileDrawer();" class="w-full flex items-center gap-2.5 p-2 rounded text-slate-300 hover:bg-slate-900">${ICONS.dashboard}<span>لوحة العمليات</span></button>
      <button onclick="switchTab('market'); toggleMobileDrawer();" class="w-full flex items-center gap-2.5 p-2 rounded text-slate-300 hover:bg-slate-900">${ICONS.market}<span>شاشة السوق والسيولة</span></button>
      <button onclick="switchTab('scanner'); toggleMobileDrawer();" class="w-full flex items-center gap-2.5 p-2 rounded text-slate-300 hover:bg-slate-900">${ICONS.scanner}<span>الماسح اللحظي (30)</span></button>
      <button onclick="switchTab('setups'); toggleMobileDrawer();" class="w-full flex items-center gap-2.5 p-2 rounded text-slate-300 hover:bg-slate-900">${ICONS.setups}<span>نماذج الإعداد (Setups)</span></button>
      <button onclick="switchTab('signals'); toggleMobileDrawer();" class="w-full flex items-center gap-2.5 p-2 rounded text-slate-300 hover:bg-slate-900">${ICONS.signals}<span>الإشارات الحتمية</span></button>
      <button onclick="switchTab('trades'); toggleMobileDrawer();" class="w-full flex items-center gap-2.5 p-2 rounded text-slate-300 hover:bg-slate-900">${ICONS.trades}<span>دفتر الصفقات والمراكز</span></button>
      <button onclick="switchTab('risk'); toggleMobileDrawer();" class="w-full flex items-center gap-2.5 p-2 rounded text-slate-300 hover:bg-slate-900">${ICONS.risk}<span>مركز إدارة المخاطر</span></button>
      <button onclick="switchTab('ai'); toggleMobileDrawer();" class="w-full flex items-center gap-2.5 p-2 rounded text-slate-300 hover:bg-slate-900">${ICONS.ai}<span>استشارات AI</span></button>
      <button onclick="switchTab('backtest'); toggleMobileDrawer();" class="w-full flex items-center gap-2.5 p-2 rounded text-slate-300 hover:bg-slate-900">${ICONS.backtest}<span>الاختبار التاريخي والمحاكي</span></button>
      <button onclick="switchTab('mt5'); toggleMobileDrawer();" class="w-full flex items-center gap-2.5 p-2 rounded text-slate-300 hover:bg-slate-900">${ICONS.broker}<span>وسيط MT5 والحساب الحقيقي</span></button>
      <button onclick="switchTab('telegram'); toggleMobileDrawer();" class="w-full flex items-center gap-2.5 p-2 rounded text-slate-300 hover:bg-slate-900">${ICONS.telegram}<span>مركز تحكم تيليجرام</span></button>
      <button onclick="switchTab('system'); toggleMobileDrawer();" class="w-full flex items-center gap-2.5 p-2 rounded text-slate-300 hover:bg-slate-900">${ICONS.system}<span>صحة الخدمات والمطابقة</span></button>
      <button onclick="switchTab('settings'); toggleMobileDrawer();" class="w-full flex items-center gap-2.5 p-2 rounded text-slate-300 hover:bg-slate-900">${ICONS.settings}<span>إعدادات المشغل ورأس المال</span></button>
    </div>
  </div>
  `;
}
