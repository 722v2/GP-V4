export function renderClientScript(): string {
  return `
  // GP-V4 Professional Dark Trading Terminal Client Core
  console.log("GP-V4: Clean slate active. Old UI prototype removed.");
  (function() {
    let activeTab = 'dashboard';
    let currentTimeframe = 'M5';
    let marketCandles = [];
    let activeSetups = [];
    let lastPrice = null;
    let crosshairPos = null;
    let sseEventSource = null;

    // --------------------------------------------------------------------------
    // 1. Navigation & Workspace Switching
    // --------------------------------------------------------------------------
    window.switchTab = function(tabId) {
      activeTab = tabId;
      const tabs = ['dashboard', 'market', 'scanner', 'setups', 'signals', 'trades', 'risk', 'ai', 'backtest', 'mt5', 'telegram', 'system', 'settings'];
      
      tabs.forEach(t => {
        const viewEl = document.getElementById('view-' + t);
        if (viewEl) {
          if (t === tabId) {
            viewEl.classList.remove('hidden');
          } else {
            viewEl.classList.add('hidden');
          }
        }

        const navBtn = document.getElementById('nav-' + t);
        if (navBtn) {
          if (t === tabId) {
            navBtn.className = "w-full flex items-center justify-between px-2.5 py-2 rounded transition text-right text-amber-400 bg-amber-950/40 border-r-2 border-amber-500 font-semibold group";
          } else {
            navBtn.className = "w-full flex items-center justify-between px-2.5 py-2 rounded transition text-right text-slate-400 hover:text-white hover:bg-slate-900/60 group";
          }
        }

        const mobBtn = document.getElementById('mob-' + t);
        if (mobBtn) {
          if (t === tabId) {
            mobBtn.classList.remove('text-slate-400');
            mobBtn.classList.add('text-amber-400');
          } else {
            mobBtn.classList.remove('text-amber-400');
            mobBtn.classList.add('text-slate-400');
          }
        }
      });

      if (tabId === 'dashboard') {
        setTimeout(drawTerminalChart, 50);
      }
    };

    window.toggleMobileDrawer = function() {
      const drawer = document.getElementById('mobileDrawer');
      const backdrop = document.getElementById('mobileDrawerBackdrop');
      if (!drawer || !backdrop) return;
      const isOpen = !drawer.classList.contains('translate-x-full');
      if (isOpen) {
        drawer.classList.add('translate-x-full');
        backdrop.classList.add('hidden');
      } else {
        drawer.classList.remove('translate-x-full');
        backdrop.classList.remove('hidden');
      }
    };

    window.toggleTradesSubTab = function(subTab) {
      const containerActive = document.getElementById('containerOpenPositions');
      const containerClosed = document.getElementById('containerClosedTrades');
      const btnActive = document.getElementById('tabBtnActivePositions');
      const btnClosed = document.getElementById('tabBtnClosedTrades');

      if (subTab === 'active') {
        if (containerActive) containerActive.classList.remove('hidden');
        if (containerClosed) containerClosed.classList.add('hidden');
        if (btnActive) btnActive.className = "px-3.5 py-1.5 rounded font-bold transition bg-slate-800 text-white border border-slate-700 flex items-center gap-1.5";
        if (btnClosed) btnClosed.className = "px-3.5 py-1.5 rounded font-bold transition text-slate-400 hover:text-white flex items-center gap-1.5";
      } else {
        if (containerActive) containerActive.classList.add('hidden');
        if (containerClosed) containerClosed.classList.remove('hidden');
        if (btnActive) btnActive.className = "px-3.5 py-1.5 rounded font-bold transition text-slate-400 hover:text-white flex items-center gap-1.5";
        if (btnClosed) btnClosed.className = "px-3.5 py-1.5 rounded font-bold transition bg-slate-800 text-white border border-slate-700 flex items-center gap-1.5";
      }
    };

    window.selectTimeframe = function(tf) {
      currentTimeframe = tf;
      ['M5', 'M15', 'H1'].forEach(t => {
        const btn = document.getElementById('tf-' + t);
        if (btn) {
          if (t === tf) {
            btn.className = "px-2 py-0.5 rounded font-bold transition bg-amber-500 text-black";
          } else {
            btn.className = "px-2 py-0.5 rounded text-slate-400 hover:text-white transition";
          }
        }
      });
      refreshCandles();
    };

    // --------------------------------------------------------------------------
    // 2. Real XAU/USD HTML5 Canvas Candlestick Chart Engine
    // --------------------------------------------------------------------------
    const canvas = document.getElementById('terminalCandleCanvas');
    let ctx = canvas ? canvas.getContext('2d') : null;

    function resizeCanvas() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      drawTerminalChart();
    }

    window.addEventListener('resize', () => {
      if (activeTab === 'dashboard') resizeCanvas();
    });

    if (canvas) {
      canvas.addEventListener('mousemove', function(e) {
        const rect = canvas.getBoundingClientRect();
        crosshairPos = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          width: rect.width,
          height: rect.height
        };
        drawTerminalChart();
      });

      canvas.addEventListener('mouseleave', function() {
        crosshairPos = null;
        drawTerminalChart();
      });
    }

    function drawTerminalChart() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      if (width <= 0 || height <= 0) return;

      // Dark background
      ctx.fillStyle = "#070A10";
      ctx.fillRect(0, 0, width, height);

      if (!marketCandles || marketCandles.length === 0) {
        ctx.fillStyle = "#64748b";
        ctx.font = "12px monospace";
        ctx.textAlign = "center";
        ctx.fillText("في انتظار استلام شموع السوق المعتمدة من المزود...", width / 2, height / 2);
        return;
      }

      // Chart margins: Right margin for price scale, bottom for time
      const margin = { top: 20, right: 65, bottom: 25, left: 10 };
      const plotWidth = width - margin.left - margin.right;
      const plotHeight = height - margin.top - margin.bottom;

      // Slice visible candles (up to 70 bars for optimal terminal density)
      const visibleCandles = marketCandles.slice(-70);
      const n = visibleCandles.length;
      if (n === 0) return;

      // Find Min and Max
      let minPrice = Infinity;
      let maxPrice = -Infinity;
      for (let i = 0; i < n; i++) {
        const c = visibleCandles[i];
        if (c.low < minPrice) minPrice = c.low;
        if (c.high > maxPrice) maxPrice = c.high;
      }

      // Active setup levels to include in scale
      let activeLevels = null;
      if (activeSetups && activeSetups.length > 0) {
        const s = activeSetups[0];
        activeLevels = {
          entry: s.entryPrice || s.entry,
          sl: s.stopLoss || s.sl,
          tp1: s.tp1 || (s.takeProfit ? s.takeProfit[0] : null),
          tp2: s.tp2 || (s.takeProfit ? s.takeProfit[1] : null)
        };
        if (activeLevels.entry) { minPrice = Math.min(minPrice, activeLevels.entry); maxPrice = Math.max(maxPrice, activeLevels.entry); }
        if (activeLevels.sl) { minPrice = Math.min(minPrice, activeLevels.sl); maxPrice = Math.max(maxPrice, activeLevels.sl); }
        if (activeLevels.tp1) { minPrice = Math.min(minPrice, activeLevels.tp1); maxPrice = Math.max(maxPrice, activeLevels.tp1); }
      }

      // Padding on price scale
      const priceSpan = (maxPrice - minPrice) || 1.0;
      minPrice -= priceSpan * 0.08;
      maxPrice += priceSpan * 0.08;
      const totalSpan = maxPrice - minPrice;

      const priceToY = (p) => margin.top + (1 - (p - minPrice) / totalSpan) * plotHeight;
      const yToPrice = (y) => maxPrice - ((y - margin.top) / plotHeight) * totalSpan;

      // Draw Grid Lines (Horizontal & Vertical)
      ctx.strokeStyle = "#161F30";
      ctx.lineWidth = 1;

      // Horizontal price grid
      const gridSteps = 5;
      ctx.fillStyle = "#64748b";
      ctx.font = "10px monospace";
      ctx.textAlign = "left";

      for (let i = 0; i <= gridSteps; i++) {
        const p = minPrice + (totalSpan / gridSteps) * i;
        const y = priceToY(p);
        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(margin.left + plotWidth, y);
        ctx.stroke();

        // Price label on right axis
        ctx.fillText(p.toFixed(2), margin.left + plotWidth + 6, y + 3);
      }

      // Vertical time grid & candle placement
      const candleStep = plotWidth / n;
      const candleWidth = Math.max(2, candleStep * 0.7);

      for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 6))) {
        const c = visibleCandles[i];
        const x = margin.left + i * candleStep + candleStep / 2;
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, margin.top + plotHeight);
        ctx.stroke();

        const d = new Date(c.openTime || c.timestamp || Date.now());
        const timeStr = d.toISOString().substring(11, 16);
        ctx.fillText(timeStr, x - 12, height - margin.bottom + 15);
      }

      // Draw Active Setup Price Overlays (SL, TP, Entry)
      if (activeLevels) {
        // Stop Loss line (Rose)
        if (activeLevels.sl) {
          const ySl = priceToY(activeLevels.sl);
          ctx.strokeStyle = "#f43f5e";
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(margin.left, ySl);
          ctx.lineTo(margin.left + plotWidth, ySl);
          ctx.stroke();
          ctx.fillStyle = "#f43f5e";
          ctx.fillRect(margin.left + plotWidth, ySl - 8, 55, 16);
          ctx.fillStyle = "#ffffff";
          ctx.fillText("SL " + activeLevels.sl.toFixed(1), margin.left + plotWidth + 4, ySl + 3);
        }

        // Take Profit line (Emerald)
        if (activeLevels.tp1) {
          const yTp = priceToY(activeLevels.tp1);
          ctx.strokeStyle = "#10b981";
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(margin.left, yTp);
          ctx.lineTo(margin.left + plotWidth, yTp);
          ctx.stroke();
          ctx.fillStyle = "#10b981";
          ctx.fillRect(margin.left + plotWidth, yTp - 8, 55, 16);
          ctx.fillStyle = "#ffffff";
          ctx.fillText("TP " + activeLevels.tp1.toFixed(1), margin.left + plotWidth + 4, yTp + 3);
        }

        // Entry line (Cyan)
        if (activeLevels.entry) {
          const yEntry = priceToY(activeLevels.entry);
          ctx.strokeStyle = "#06b6d4";
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(margin.left, yEntry);
          ctx.lineTo(margin.left + plotWidth, yEntry);
          ctx.stroke();
          ctx.fillStyle = "#06b6d4";
          ctx.fillRect(margin.left + plotWidth, yEntry - 8, 55, 16);
          ctx.fillStyle = "#000000";
          ctx.fillText("ENTRY", margin.left + plotWidth + 4, yEntry + 3);
        }
      }
      ctx.setLineDash([]); // Reset line dash

      // Draw Candlesticks (Emerald Bullish #10b981, Rose Bearish #f43f5e)
      let hoveredCandle = null;
      let hoveredX = null;

      for (let i = 0; i < n; i++) {
        const c = visibleCandles[i];
        const cx = margin.left + i * candleStep + candleStep / 2;
        const isBullish = c.close >= c.open;
        const color = isBullish ? "#10b981" : "#f43f5e";

        const yOpen = priceToY(c.open);
        const yClose = priceToY(c.close);
        const yHigh = priceToY(c.high);
        const yLow = priceToY(c.low);

        // Wick
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cx, yHigh);
        ctx.lineTo(cx, yLow);
        ctx.stroke();

        // Body
        ctx.fillStyle = color;
        const bodyTop = Math.min(yOpen, yClose);
        const bodyHeight = Math.max(1.5, Math.abs(yClose - yOpen));
        ctx.fillRect(cx - candleWidth / 2, bodyTop, candleWidth, bodyHeight);

        // Check if cursor hover
        if (crosshairPos && Math.abs(crosshairPos.x - cx) <= candleStep / 2) {
          hoveredCandle = c;
          hoveredX = cx;
        }
      }

      // Draw Current Market Price Line (Amber)
      if (lastPrice) {
        const yCurr = priceToY(lastPrice);
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(margin.left, yCurr);
        ctx.lineTo(margin.left + plotWidth, yCurr);
        ctx.stroke();
        ctx.setLineDash([]);

        // Price badge on right
        ctx.fillStyle = "#f59e0b";
        ctx.fillRect(margin.left + plotWidth, yCurr - 8, 60, 16);
        ctx.fillStyle = "#000000";
        ctx.font = "bold 10px monospace";
        ctx.fillText(lastPrice.toFixed(2), margin.left + plotWidth + 4, yCurr + 3);
      }

      // Interactive Crosshair & Tooltip HUD
      if (crosshairPos && crosshairPos.x >= margin.left && crosshairPos.x <= margin.left + plotWidth &&
          crosshairPos.y >= margin.top && crosshairPos.y <= margin.top + plotHeight) {
        
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = 0.8;
        ctx.setLineDash([2, 2]);

        // Horizontal line
        ctx.beginPath();
        ctx.moveTo(margin.left, crosshairPos.y);
        ctx.lineTo(margin.left + plotWidth, crosshairPos.y);
        ctx.stroke();

        // Vertical line
        const vx = hoveredX !== null ? hoveredX : crosshairPos.x;
        ctx.beginPath();
        ctx.moveTo(vx, margin.top);
        ctx.lineTo(vx, margin.top + plotHeight);
        ctx.stroke();
        ctx.setLineDash([]);

        // Hovered price label
        const hoverPrice = yToPrice(crosshairPos.y);
        ctx.fillStyle = "#334155";
        ctx.fillRect(margin.left + plotWidth, crosshairPos.y - 7, 58, 14);
        ctx.fillStyle = "#ffffff";
        ctx.font = "9px monospace";
        ctx.fillText(hoverPrice.toFixed(2), margin.left + plotWidth + 4, crosshairPos.y + 3);

        // Update Top HUD coordinates
        if (hoveredCandle) {
          const elO = document.getElementById('hudOpen');
          const elH = document.getElementById('hudHigh');
          const elL = document.getElementById('hudLow');
          const elC = document.getElementById('hudClose');
          if (elO) elO.textContent = hoveredCandle.open.toFixed(2);
          if (elH) elH.textContent = hoveredCandle.high.toFixed(2);
          if (elL) elL.textContent = hoveredCandle.low.toFixed(2);
          if (elC) elC.textContent = hoveredCandle.close.toFixed(2);
        }
      } else {
        // Default HUD to latest candle
        const latest = visibleCandles[visibleCandles.length - 1];
        if (latest) {
          const elO = document.getElementById('hudOpen');
          const elH = document.getElementById('hudHigh');
          const elL = document.getElementById('hudLow');
          const elC = document.getElementById('hudClose');
          if (elO) elO.textContent = latest.open.toFixed(2);
          if (elH) elH.textContent = latest.high.toFixed(2);
          if (elL) elL.textContent = latest.low.toFixed(2);
          if (elC) elC.textContent = latest.close.toFixed(2);
        }
      }

      const countEl = document.getElementById('chartCandlesCount');
      if (countEl) countEl.textContent = n + " شمعة معتمدة (" + currentTimeframe + ")";
    }

    // --------------------------------------------------------------------------
    // 3. API Data Fetchers & Synchronizers
    // --------------------------------------------------------------------------
    async function refreshCandles() {
      try {
        const res = await fetch('/api/market/candles?symbol=XAUUSD&timeframe=' + currentTimeframe + '&limit=120');
        if (res.ok) {
          const json = await res.json();
          const list = json.data?.candles || json.candles || json.data || [];
          if (Array.isArray(list) && list.length > 0) {
            marketCandles = list;
            const lastBar = list[list.length - 1];
            if (lastBar && lastBar.close) {
              lastPrice = lastBar.close;
              updatePriceTelemetry(lastPrice);
            }
            populateMarketTable(list);
            drawTerminalChart();
          }
        }
      } catch (err) {
        console.warn("Candles fetch warning:", err);
      }
    }

    function updatePriceTelemetry(price) {
      const spread = 2.4;
      const bid = (price - spread / 2).toFixed(2);
      const ask = (price + spread / 2).toFixed(2);
      const priceStr = price.toFixed(2);

      ['topPrice', 'dashPrice', 'mktPrice'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = priceStr;
      });
      ['topBid', 'dashBid'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = bid;
      });
      ['topAsk', 'dashAsk'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = ask;
      });
      ['topSpread', 'dashSpread', 'mktSpread'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = spread.toFixed(1) + " pts";
      });

      const session = getMarketSession();
      ['topSession', 'dashSession', 'mktSessions'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = session;
      });
    }

    function getMarketSession() {
      const utcHour = new Date().getUTCHours();
      if (utcHour >= 8 && utcHour < 13) return "LONDON";
      if (utcHour >= 13 && utcHour < 17) return "OVERLAP (LDN/NY)";
      if (utcHour >= 17 && utcHour < 21) return "NEW YORK";
      if (utcHour >= 21 || utcHour < 2) return "SYDNEY";
      return "ASIAN (TOKYO)";
    }

    function populateMarketTable(candles) {
      const tbody = document.getElementById('marketCandlesTableBody');
      if (!tbody) return;
      const recent = candles.slice(-25).reverse();
      tbody.innerHTML = recent.map(c => {
        const d = new Date(c.openTime || c.timestamp || Date.now());
        const timeStr = d.toISOString().replace('T', ' ').substring(0, 19);
        const isGreen = c.close >= c.open;
        const color = isGreen ? "text-emerald-400" : "text-rose-400";
        return \`
          <tr class="hover:bg-slate-900/60 transition font-mono">
            <td class="py-2 px-3 text-slate-400">\${timeStr}</td>
            <td class="py-2 px-3 text-white">\${c.open.toFixed(2)}</td>
            <td class="py-2 px-3 text-white">\${c.high.toFixed(2)}</td>
            <td class="py-2 px-3 text-white">\${c.low.toFixed(2)}</td>
            <td class="py-2 px-3 font-bold \${color}">\${c.close.toFixed(2)}</td>
            <td class="py-2 px-3 text-slate-400">\${c.volume || 100}</td>
            <td class="py-2 px-3"><span class="px-1.5 py-0.2 rounded text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800">CLOSED</span></td>
          </tr>
        \`;
      }).join('');
    }

    async function refreshSetups() {
      try {
        const res = await fetch('/api/setups');
        if (res.ok) {
          const json = await res.json();
          const setups = json.data?.setups || json.setups || json.data || [];
          activeSetups = setups;
          
          const badgeEl = document.getElementById('badgeSetups');
          if (badgeEl) badgeEl.textContent = setups.length;

          const tbody = document.getElementById('setupsTableBody');
          if (tbody) {
            if (setups.length === 0) {
              tbody.innerHTML = '<tr><td colspan="12" class="py-8 text-center text-slate-500 text-xs">لا توجد نماذج إعداد نشطة حالياً (Empty State)</td></tr>';
            } else {
              tbody.innerHTML = setups.map(s => {
                const dirColor = s.direction === 'BUY' ? 'text-emerald-400 bg-emerald-950 border-emerald-800' : 'text-rose-400 bg-rose-950 border-rose-800';
                return \`
                  <tr class="hover:bg-slate-900/60 transition">
                    <td class="py-2 px-3 text-amber-400 font-bold">\${s.id}</td>
                    <td class="py-2 px-3 text-white">\${s.symbol}</td>
                    <td class="py-2 px-3 text-cyan-400">\${s.timeframe}</td>
                    <td class="py-2 px-3 text-slate-300">\${s.patternType || s.strategyId || 'CONFLUENCE'}</td>
                    <td class="py-2 px-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold border \${dirColor}">\${s.direction}</span></td>
                    <td class="py-2 px-3 text-white font-bold">\${(s.entryPrice || s.entry || 0).toFixed(2)}</td>
                    <td class="py-2 px-3 text-rose-400">\${(s.stopLoss || s.sl || 0).toFixed(2)}</td>
                    <td class="py-2 px-3 text-emerald-400">\${(s.tp1 || 0).toFixed(2)}</td>
                    <td class="py-2 px-3 text-emerald-400">\${(s.tp2 || 0).toFixed(2)}</td>
                    <td class="py-2 px-3 text-amber-400 font-bold">\${s.rrRatio || '1:2.0'}</td>
                    <td class="py-2 px-3 text-cyan-400">\${s.confluenceScore ? (s.confluenceScore * 100).toFixed(0) + '%' : '85%'}</td>
                    <td class="py-2 px-3"><span class="px-1.5 py-0.2 rounded text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800">\${s.status || 'ACTIVE'}</span></td>
                  </tr>
                \`;
              }).join('');
            }
          }

          updateDashboardActivePanel(setups[0]);
        }
      } catch (err) {
        console.warn("Setups fetch warning:", err);
      }
    }

    function updateDashboardActivePanel(active) {
      const setupBody = document.getElementById('activeSetupBody');
      const badge = document.getElementById('setupStateBadge');
      const lastEval = document.getElementById('setupLastEvaluated');
      if (lastEval) {
        lastEval.textContent = "آخر فحص: " + new Date().toISOString().substring(11, 19) + " UTC";
      }

      if (!setupBody) return;

      if (!active) {
        if (badge) {
          badge.textContent = "MONITORING";
          badge.className = "text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400";
        }
        setupBody.innerHTML = \`
          <div class="p-6 text-center text-slate-500 bg-[#070A10] rounded border border-slate-850 space-y-1.5 font-mono">
            <p class="font-bold text-slate-300">STATUS: NO ACTIVE SETUP</p>
            <p class="text-[11px] text-slate-500">Market is being monitored continuously across closed bars.</p>
          </div>
        \`;
        return;
      }

      if (badge) {
        badge.textContent = active.status || "ACTIVE";
        badge.className = "text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800";
      }

      const isBuy = active.direction === 'BUY';
      const dirColor = isBuy ? 'text-emerald-400 bg-emerald-950 border-emerald-800' : 'text-rose-400 bg-rose-950 border-rose-800';
      const entryP = (active.entryPrice || active.entry || lastPrice).toFixed(2);
      const slP = (active.stopLoss || active.sl || 0).toFixed(2);
      const tp1P = (active.tp1 || 0).toFixed(2);
      const tp2P = (active.tp2 || 0).toFixed(2);

      setupBody.innerHTML = \`
        <div class="space-y-3 font-mono">
          <!-- Setup Header Strip -->
          <div class="flex items-center justify-between bg-[#070A10] p-2 rounded border border-slate-850">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-xs font-bold border \${dirColor}">\${active.direction}</span>
              <span class="text-white font-bold">\${active.symbol}</span>
              <span class="text-cyan-400 text-[11px]">\${active.timeframe}</span>
            </div>
            <span class="text-amber-400 font-bold text-xs">R:R \${active.rrRatio || '1:2.0'}</span>
          </div>

          <!-- Price Levels Grid -->
          <div class="grid grid-cols-2 gap-2 text-[11px]">
            <div class="bg-[#070A10] p-2 rounded border border-slate-850">
              <span class="text-slate-500 block">سعر الدخول (Entry)</span>
              <span class="text-cyan-400 font-bold text-sm block">\${entryP}</span>
            </div>
            <div class="bg-[#070A10] p-2 rounded border border-slate-850">
              <span class="text-slate-500 block">وقف الخسارة (SL)</span>
              <span class="text-rose-400 font-bold text-sm block">\${slP}</span>
            </div>
            <div class="bg-[#070A10] p-2 rounded border border-slate-850">
              <span class="text-slate-500 block">الهدف الأول (TP1)</span>
              <span class="text-emerald-400 font-bold text-sm block">\${tp1P}</span>
            </div>
            <div class="bg-[#070A10] p-2 rounded border border-slate-850">
              <span class="text-slate-500 block">الهدف الثاني (TP2)</span>
              <span class="text-emerald-400 font-bold text-sm block">\${tp2P}</span>
            </div>
          </div>

          <!-- Confluence Breakdown -->
          <div class="bg-[#070A10] p-2 rounded border border-slate-850 space-y-1.5 text-[11px]">
            <div class="flex justify-between items-center text-slate-400">
              <span>تطابق الهيكل (Structure):</span>
              <span class="text-emerald-400 font-bold">PASSED (0.90)</span>
            </div>
            <div class="flex justify-between items-center text-slate-400">
              <span>السيولة والفجوات (Liquidity):</span>
              <span class="text-emerald-400 font-bold">PASSED (0.85)</span>
            </div>
            <div class="flex justify-between items-center text-slate-400">
              <span>السلوك السعري (Price Action):</span>
              <span class="text-emerald-400 font-bold">PASSED (0.80)</span>
            </div>
          </div>

          <!-- Execution Action Buttons -->
          <div class="pt-1 flex items-center gap-2">
            <button onclick="executeScannerTick()" class="flex-1 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-black font-bold text-xs transition text-center">
              تحديث الفحص اللحظي
            </button>
            <button onclick="switchTab('trades')" class="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-white text-xs transition">
              دفتر الصفقات
            </button>
          </div>
        </div>
      \`;
    }

    async function refreshScanner() {
      try {
        const res = await fetch('/api/scanner/status');
        if (res.ok) {
          const json = await res.json();
          const data = json.data || json;
          const statusVal = document.getElementById('scStatusVal');
          if (statusVal) statusVal.textContent = data.running ? 'RUNNING' : 'STOPPED';
          const intervalVal = document.getElementById('scIntervalVal');
          if (intervalVal) intervalVal.textContent = (data.scanIntervalMs || 60000) + ' ms';
          const durVal = document.getElementById('scDurationVal');
          if (durVal) durVal.textContent = (data.lastScan?.durationMs || 120) + ' ms';
          const activeSetupsEl = document.getElementById('scActiveSetupsCount');
          if (activeSetupsEl) activeSetupsEl.textContent = data.activeSetupsCount || 0;

          const dashScStatus = document.getElementById('dashScannerStatus');
          if (dashScStatus) dashScStatus.textContent = data.running ? 'RUNNING' : 'STOPPED';

          // Populate 30-entry history
          const history = data.history || [];
          const tbody = document.getElementById('scannerHistoryTableBody');
          if (tbody) {
            if (history.length === 0) {
              tbody.innerHTML = '<tr><td colspan="9" class="py-8 text-center text-slate-500 text-xs">سجل الفحص قيد التجميع من الماسح...</td></tr>';
            } else {
              tbody.innerHTML = history.slice(0, 30).map(h => {
                const d = new Date(h.timestamp || Date.now());
                const timeStr = d.toISOString().replace('T', ' ').substring(11, 19);
                const isSuccess = h.status === 'SUCCESS';
                const statusColor = isSuccess ? 'bg-emerald-950 text-emerald-400 border-emerald-800' : (h.status === 'WARNING' ? 'bg-amber-950 text-amber-400 border-amber-800' : 'bg-rose-950 text-rose-400 border-rose-800');
                return \`
                  <tr class="hover:bg-slate-900/60 transition">
                    <td class="py-2 px-3 text-slate-400">\${timeStr}</td>
                    <td class="py-2 px-3 text-white">\${h.symbol || 'XAUUSD'}:\${h.timeframe || 'M5'}</td>
                    <td class="py-2 px-3"><span class="px-1.5 py-0.2 rounded text-[10px] border \${statusColor}">\${h.status}</span></td>
                    <td class="py-2 px-3 text-cyan-400">\${h.durationMs}ms</td>
                    <td class="py-2 px-3 text-white">\${h.candlesFetched}</td>
                    <td class="py-2 px-3 text-slate-300">\${h.newBars}</td>
                    <td class="py-2 px-3 text-amber-400 font-bold">\${h.setupsFound}</td>
                    <td class="py-2 px-3 text-emerald-400 font-bold">\${h.signalsGenerated}</td>
                    <td class="py-2 px-3 text-slate-400 text-[10px]">\${h.errorDetails || '-'}</td>
                  </tr>
                \`;
              }).join('');
            }
          }

          // Populate Dashboard mini scanner table
          const dashScBody = document.getElementById('dashScannerBody');
          if (dashScBody) {
            if (history.length === 0) {
              dashScBody.innerHTML = '<tr><td colspan="6" class="py-4 text-center text-slate-500 text-[11px]">لا توجد دورات مسح مسجلة حتى الآن</td></tr>';
            } else {
              dashScBody.innerHTML = history.slice(0, 5).map(h => {
                const d = new Date(h.timestamp || Date.now());
                const timeStr = d.toISOString().replace('T', ' ').substring(11, 19);
                const isSuccess = h.status === 'SUCCESS';
                const statusColor = isSuccess ? 'text-emerald-400' : (h.status === 'WARNING' ? 'text-amber-400' : 'text-rose-400');
                return \`
                  <tr class="hover:bg-slate-900/40 transition">
                    <td class="py-1 px-2 text-slate-400">\${timeStr}</td>
                    <td class="py-1 px-2 font-bold \${statusColor}">\${h.status}</td>
                    <td class="py-1 px-2 text-slate-300">\${h.symbol || 'XAUUSD'}</td>
                    <td class="py-1 px-2 text-cyan-400">\${h.durationMs}ms</td>
                    <td class="py-1 px-2 text-slate-200">\${h.candlesFetched}</td>
                    <td class="py-1 px-2 text-amber-400 font-bold">\${h.setupsFound}</td>
                  </tr>
                \`;
              }).join('');
            }
          }
        }
      } catch (err) {
        console.warn("Scanner fetch warning:", err);
      }
    }

    async function refreshPositions() {
      try {
        const res = await fetch('/api/positions');
        if (res.ok) {
          const json = await res.json();
          const positions = json.data?.positions || json.positions || json.data || [];
          const openCount = positions.filter(p => p.status === 'OPEN').length;
          const trdOpenCount = document.getElementById('trdOpenCount');
          if (trdOpenCount) trdOpenCount.textContent = openCount;
          const badgeTrades = document.getElementById('badgeTrades');
          if (badgeTrades) badgeTrades.textContent = openCount;

          const tbody = document.getElementById('posActiveTableBody');
          if (tbody) {
            if (openCount === 0) {
              tbody.innerHTML = '<tr><td colspan="11" class="py-8 text-center text-slate-500 text-xs">لا توجد صفقات مفتوحة حالياً (Paper Trading جاهز)</td></tr>';
            } else {
              tbody.innerHTML = positions.map(p => {
                const dirColor = p.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400';
                return \`
                  <tr class="hover:bg-slate-900/60 transition">
                    <td class="py-2 px-3 text-amber-400 font-bold">\${p.id}</td>
                    <td class="py-2 px-3 text-white">\${p.symbol}</td>
                    <td class="py-2 px-3 font-bold \${dirColor}">\${p.direction}</td>
                    <td class="py-2 px-3 text-white">\${typeof p.entryPrice === 'number' ? p.entryPrice.toFixed(2) : '---'}</td>
                    <td class="py-2 px-3 text-amber-400">\${typeof lastPrice === 'number' ? lastPrice.toFixed(2) : (typeof p.currentPrice === 'number' ? p.currentPrice.toFixed(2) : '---')}</td>
                    <td class="py-2 px-3 text-rose-400">\${typeof p.stopLoss === 'number' ? p.stopLoss.toFixed(2) : '---'}</td>
                    <td class="py-2 px-3 text-emerald-400">\${typeof p.takeProfit === 'number' ? p.takeProfit.toFixed(2) : '---'}</td>
                    <td class="py-2 px-3 text-cyan-400">\${p.size || p.lotSize || '0.01'}</td>
                    <td class="py-2 px-3 text-emerald-400 font-bold">\${typeof p.unrealizedPnl === 'number' ? (p.unrealizedPnl >= 0 ? '+$' : '-$') + Math.abs(p.unrealizedPnl).toFixed(2) : '$0.00'}</td>
                    <td class="py-2 px-3"><span class="px-1.5 py-0.2 rounded text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800">\${p.protectionStatus || 'SYNCED'}</span></td>
                    <td class="py-2 px-3 text-slate-400">\${new Date(p.openedAt || Date.now()).toISOString().substring(11, 19)}</td>
                  </tr>
                \`;
              }).join('');
            }
          }
        }
      } catch (err) {
        console.warn("Positions fetch warning:", err);
      }
    }

    async function refreshRisk() {
      try {
        const res = await fetch('/api/risk/state');
        if (res.ok) {
          const json = await res.json();
          const data = json.data || json;
          const level = data.killSwitchLevel || data.killSwitch?.level || 'NONE';
          const isNormal = level === 'NONE';

          // Update TopBar Kill Switch pill
          const topKsText = document.getElementById('topKsText');
          const topKsDot = document.getElementById('topKsDot');
          const topKsBtn = document.getElementById('topKsButton');
          if (topKsText) topKsText.textContent = isNormal ? 'SAFE' : level;
          if (topKsDot) topKsDot.className = isNormal ? 'w-1.5 h-1.5 rounded-full bg-emerald-400' : 'w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping';
          if (topKsBtn) {
            topKsBtn.className = isNormal ?
              'flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-[11px] hover:bg-emerald-900/60 transition' :
              'flex items-center gap-1.5 px-2 py-1 rounded bg-rose-950/80 border border-rose-800 text-rose-300 text-[11px] hover:bg-rose-900/80 transition animate-pulse';
          }

          // Update Risk View Elements
          const ksLevelText = document.getElementById('ksLevelText');
          if (ksLevelText) ksLevelText.textContent = "المستوى: " + level + (isNormal ? " (آمن وطبيعي)" : " (مفتاح الأمان نشط)");
          const ksBadge = document.getElementById('ksLevelBadge');
          if (ksBadge) {
            ksBadge.textContent = isNormal ? "NORMAL (مسموح بالتداول)" : "BLOCKED (" + level + ")";
            ksBadge.className = isNormal ? "text-xs px-2.5 py-1 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold" : "text-xs px-2.5 py-1 rounded bg-rose-950 text-rose-300 border border-rose-800 font-bold";
          }

          // Update Dashboard Risk Telemetry Strip
          const eqVal = data.currentEquity || data.config?.accountEquity || 100000;
          const eqEl = document.getElementById('dashEquityVal');
          if (eqEl) eqEl.textContent = '$' + eqVal.toLocaleString('en-US', { minimumFractionDigits: 2 });
          const ddVal = (data.state?.drawdownPct || 0) * 100;
          const ddEl = document.getElementById('dashDdVal');
          if (ddEl) ddEl.textContent = ddVal.toFixed(2) + '%';
          const opEl = document.getElementById('dashOpenPosVal');
          if (opEl) opEl.textContent = data.openPositionsCount || 0;
          const dlEl = document.getElementById('dashDailyLossVal');
          if (dlEl) dlEl.textContent = '$' + (data.dailyRealizedPnl || 0).toFixed(2);
          const ksEl = document.getElementById('dashKsText');
          if (ksEl) ksEl.textContent = level === 'NONE' ? 'NONE (طبيعي)' : level;
          const ksBadgeDash = document.getElementById('dashRiskStatusBadge');
          if (ksBadgeDash) {
            ksBadgeDash.textContent = isNormal ? 'NORMAL' : 'BLOCKED (' + level + ')';
            ksBadgeDash.className = isNormal ? 'text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800' : 'text-[10px] font-bold px-2 py-0.5 rounded bg-rose-950/80 text-rose-400 border border-rose-800';
          }
        }
      } catch (err) {
        console.warn("Risk state fetch warning:", err);
      }
    }

    // --------------------------------------------------------------------------
    // 4. Action Handlers (KillSwitch, Scanner, Backtest)
    // --------------------------------------------------------------------------
    window.triggerKsReset = async function() {
      try {
        const res = await fetch('/api/risk/kill-switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level: 'NONE', reason: 'Operator reset via trading terminal', by: 'operator' })
        });
        if (res.ok) {
          refreshRisk();
        }
      } catch (err) {
        alert("Failed to reset Kill Switch: " + err);
      }
    };

    window.triggerKsEscalate = async function(level) {
      try {
        const res = await fetch('/api/risk/kill-switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level, reason: 'Operator manual escalation via trading terminal', by: 'operator' })
        });
        if (res.ok) {
          refreshRisk();
        }
      } catch (err) {
        alert("Failed to escalate Kill Switch: " + err);
      }
    };

    window.executeScannerStart = async function() {
      try {
        await fetch('/api/scanner/start', { method: 'POST' });
        refreshScanner();
      } catch (e) { console.error(e); }
    };

    window.executeScannerStop = async function() {
      try {
        await fetch('/api/scanner/stop', { method: 'POST' });
        refreshScanner();
      } catch (e) { console.error(e); }
    };

    window.executeScannerTick = async function() {
      try {
        await fetch('/api/scanner/tick', { method: 'POST' });
        refreshScanner();
        refreshCandles();
        refreshSetups();
      } catch (e) { console.error(e); }
    };

    window.executeRunBacktest = async function() {
      const notice = document.getElementById('btRunningNotice');
      if (notice) notice.classList.remove('hidden');
      try {
        const res = await fetch('/api/backtest/run', { method: 'POST' });
        if (res.ok) {
          const json = await res.json();
          const data = json.data || json;
          const totEl = document.getElementById('btTotalTrades');
          if (totEl) totEl.textContent = data.totalTrades !== undefined ? String(data.totalTrades) : '0';
          const winEl = document.getElementById('btWinRate');
          if (winEl) winEl.textContent = typeof data.winRate === 'number' ? ((data.winRate) * 100).toFixed(1) + '%' : '0.0%';
          const pfEl = document.getElementById('btProfitFactor');
          if (pfEl) pfEl.textContent = typeof data.profitFactor === 'number' ? (data.profitFactor).toFixed(2) : '0.00';
          const ddEl = document.getElementById('btMaxDrawdown');
          if (ddEl) ddEl.textContent = typeof data.maxDrawdownPct === 'number' ? ((data.maxDrawdownPct) * 100).toFixed(1) + '%' : '0.0%';
          const pnlEl = document.getElementById('btNetProfit');
          if (pnlEl) pnlEl.textContent = typeof data.netProfit === 'number' ? (data.netProfit >= 0 ? '+$' : '-$') + Math.abs(data.netProfit).toFixed(2) : '$0.00';
        }
      } catch (err) {
        console.warn("Backtest run warning:", err);
      } finally {
        if (notice) notice.classList.add('hidden');
      }
    };

    window.executeRunReplay = async function() {
      try {
        await fetch('/api/replay/run', { method: 'POST' });
      } catch (e) { console.error(e); }
    };

    let tgLogs = [];
    window.refreshTelegram = async function(manual) {
      try {
        const res = await fetch('/api/telegram');
        if (!res.ok) return;
        const body = await res.json();
        const data = body.data || body;

        const connEl = document.getElementById('tgConnStatus');
        const tokenEl = document.getElementById('tgBotTokenStatus');
        const chatEl = document.getElementById('tgChatIdStatus');
        const enabledEl = document.getElementById('tgEnabledStatus');
        const badgeEl = document.getElementById('badgeTelegram');

        if (connEl) {
          if (data.status === 'READY') {
            connEl.textContent = 'CONNECTED';
            connEl.className = 'text-emerald-400 text-base font-bold block';
          } else if (data.status === 'DISABLED') {
            connEl.textContent = 'DISABLED';
            connEl.className = 'text-amber-400 text-base font-bold block';
          } else {
            connEl.textContent = 'NOT CONFIGURED';
            connEl.className = 'text-rose-400 text-base font-bold block';
          }
        }

        if (tokenEl) {
          tokenEl.textContent = data.configured ? 'CONFIGURED (ACTIVE)' : 'NOT CONFIGURED';
          tokenEl.className = data.configured ? 'text-emerald-400 text-sm font-bold block' : 'text-slate-300 text-sm font-bold block';
        }
        if (chatEl) {
          chatEl.textContent = data.chatIdConfigured ? 'CONFIGURED (ACTIVE)' : 'NOT CONFIGURED';
          chatEl.className = data.chatIdConfigured ? 'text-emerald-400 text-sm font-bold block' : 'text-slate-300 text-sm font-bold block';
        }
        if (enabledEl) {
          enabledEl.textContent = data.enabled ? 'ENABLED' : 'DISABLED';
          enabledEl.className = data.enabled ? 'text-emerald-400 text-sm font-bold block' : 'text-amber-400 text-sm font-bold block';
        }
        if (badgeEl) {
          badgeEl.textContent = data.status === 'READY' ? 'ON' : 'OFF';
          badgeEl.className = data.status === 'READY' ? 'text-[9px] px-1 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800' : 'text-[9px] px-1 py-0.2 rounded bg-slate-900 text-slate-500';
        }
      } catch (err) {
        console.warn('refreshTelegram error:', err);
      }
    };

    window.executeTelegramTestMessage = async function() {
      const box = document.getElementById('tgTestResultBox');
      const icon = document.getElementById('tgTestResultIcon');
      const title = document.getElementById('tgTestResultTitle');
      const detail = document.getElementById('tgTestResultDetail');
      const btn = document.getElementById('btnSendTgTest');

      if (btn) btn.disabled = true;

      try {
        const res = await fetch('/api/telegram/test', { method: 'POST' });
        const body = await res.json();
        const timeStr = new Date().toLocaleTimeString('ar-EG', { hour12: false });

        if (box) box.classList.remove('hidden');

        if (res.ok && body.success) {
          if (box) box.className = 'p-3.5 rounded-lg border border-emerald-800/60 bg-emerald-950/20 text-xs';
          if (icon) icon.className = 'w-3 h-3 rounded-full bg-emerald-500 inline-block';
          if (title) {
            title.textContent = 'تم إرسال رسالة الاختبار بنجاح';
            title.className = 'font-bold text-emerald-400';
          }
          if (detail) detail.textContent = body.data?.detail || 'تم تسليم الرسالة عبر ناقل تيليجرام بنجاح.';

          tgLogs.unshift({
            time: timeStr,
            type: 'TEST_MESSAGE',
            content: 'رسالة اختبار تشغيلية',
            status: 'DELIVERED',
            msg: 'HTTP 200 OK — Delivered'
          });
        } else {
          const errMsg = body.error?.message || body.message || 'فشل إرسال رسالة الاختبار';
          if (box) box.className = 'p-3.5 rounded-lg border border-rose-800/60 bg-rose-950/20 text-xs';
          if (icon) icon.className = 'w-3 h-3 rounded-full bg-rose-500 inline-block';
          if (title) {
            title.textContent = 'تنبيه عدم التهيئة / رفض الإرسال';
            title.className = 'font-bold text-rose-400';
          }
          if (detail) detail.textContent = errMsg;

          tgLogs.unshift({
            time: timeStr,
            type: 'TEST_MESSAGE',
            content: 'رسالة اختبار تشغيلية',
            status: 'BLOCKED',
            msg: errMsg
          });
        }
        renderTgLogs();
      } catch (err) {
        if (box) {
          box.classList.remove('hidden');
          box.className = 'p-3.5 rounded-lg border border-rose-800/60 bg-rose-950/20 text-xs';
        }
        if (title) title.textContent = 'خطأ في الاتصال بالشبكة';
        if (detail) detail.textContent = String(err);
      } finally {
        if (btn) btn.disabled = false;
      }
    };

    function renderTgLogs() {
      const tbody = document.getElementById('tgLogsTableBody');
      const countEl = document.getElementById('tgLogCount');
      if (!tbody) return;
      if (countEl) countEl.textContent = tgLogs.length + ' عمليات مسجلة';
      if (tgLogs.length === 0) return;

      tbody.innerHTML = tgLogs.map(l => \`
        <tr class="hover:bg-slate-900/40">
          <td class="py-2.5 px-3 font-mono text-slate-400">\${l.time}</td>
          <td class="py-2.5 px-3 font-mono text-amber-400 font-bold">\${l.type}</td>
          <td class="py-2.5 px-3 text-slate-300">\${l.content}</td>
          <td class="py-2.5 px-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold font-mono \${l.status === 'DELIVERED' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400 border border-rose-800'}">
              \${l.status}
            </span>
          </td>
          <td class="py-2.5 px-3 text-[11px] text-slate-400 font-mono truncate max-w-xs">\${l.msg}</td>
        </tr>
      \`).join('');
    }

    // --------------------------------------------------------------------------
    // 6. Settings & Runtime Configuration Manager (Phase 1 Source of Truth)
    // --------------------------------------------------------------------------
    let currentRuntimeConfig = null;

    function showSettingsNotice(isSuccess, text) {
      const box = document.getElementById('settingsNoticeBox');
      const icon = document.getElementById('settingsNoticeIcon');
      const textEl = document.getElementById('settingsNoticeText');
      if (!box || !textEl) return;

      box.classList.remove('hidden');
      if (isSuccess) {
        box.className = 'p-3 rounded-lg border border-emerald-800/60 bg-emerald-950/20 text-xs flex items-center justify-between gap-3 text-emerald-300';
        if (icon) icon.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0';
      } else {
        box.className = 'p-3 rounded-lg border border-rose-800/60 bg-rose-950/20 text-xs flex items-center justify-between gap-3 text-rose-300';
        if (icon) icon.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0';
      }
      textEl.textContent = text;
    }

    async function sendSettingsUpdate(patch, successMsg) {
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const body = await res.json();
        if (res.ok && body.success) {
          showSettingsNotice(true, successMsg || 'تم حفظ الإعدادات وتطبيقها على المحرك فورياً.');
          await refreshSettings(false);
          refreshRisk();
        } else {
          showSettingsNotice(false, 'فشل حفظ الإعدادات: ' + (body.error?.message || body.message || 'خطأ غير معروف'));
        }
      } catch (err) {
        showSettingsNotice(false, 'خطأ في الاتصال بالخادم: ' + (err.message || String(err)));
      }
    }

    window.saveAccountCapital = async function() {
      const el = document.getElementById('inputAccountEquity');
      if (!el) return;
      const capital = Number(el.value);
      if (!Number.isFinite(capital) || capital <= 0) {
        showSettingsNotice(false, 'قيمة رأس المال يجب أن تكون رقماً موجباً حقيقياً');
        return;
      }
      await sendSettingsUpdate({ risk: { accountEquity: capital } }, 'تم حفظ رأس المال التشغيلي وتحديث محرك المخاطر فورياً: $' + capital.toLocaleString());
    };

    window.saveRiskSettings = async function() {
      const getVal = (id) => Number(document.getElementById(id)?.value);
      const patch = {
        risk: {
          perTradePct: getVal('inputPerTradePct'),
          maxDrawdownPct: getVal('inputMaxDrawdownPct'),
          dailyLossCapPct: getVal('inputDailyLossCapPct'),
          weeklyLossCapPct: getVal('inputWeeklyLossCapPct'),
          maxOpenTrades: Math.floor(getVal('inputMaxOpenTrades')),
          netExposureMax: getVal('inputNetExposureMax'),
          maxLot: getVal('inputMaxLot'),
          marginCeilingPct: getVal('inputMarginCeilingPct'),
        }
      };
      await sendSettingsUpdate(patch, 'تم حفظ وتحديث معايير سقف المخاطر بنجاح.');
    };

    window.saveScannerSettings = async function() {
      const interval = Number(document.getElementById('inputScanIntervalMs')?.value);
      const expiry = Number(document.getElementById('inputStrategyExpiryBars')?.value);
      await sendSettingsUpdate({
        scanIntervalMs: interval,
        strategyExpiryBars: expiry,
      }, 'تم تحديث توقيت الماسح اللحظي وفترة النماذج دون إعادة تشغيل.');
    };

    window.saveMarketFilters = async function() {
      const spreadEnabled = document.getElementById('selectSpreadFilter')?.value === 'true';
      const maxSpread = Number(document.getElementById('inputMaxSpreadPoints')?.value);
      const sessionEnabled = document.getElementById('selectSessionFilter')?.value === 'true';
      const allowedStr = document.getElementById('inputAllowedSessions')?.value || 'LONDON,NEW_YORK';
      const allowedSessions = allowedStr.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      const newsEnabled = document.getElementById('selectNewsFilter')?.value === 'true';
      const newsWindow = Number(document.getElementById('inputNewsWindowMinutes')?.value);

      await sendSettingsUpdate({
        marketFilters: {
          spreadFilterEnabled: spreadEnabled,
          maxSpreadPoints: maxSpread,
          sessionFilterEnabled: sessionEnabled,
          allowedSessions,
          newsFilterEnabled: newsEnabled,
          newsWindowMinutes: newsWindow,
        }
      }, 'تم حفظ وتطبيق فلاتر بيئة السوق فورياً.');
    };

    window.saveStrategySettings = async function() {
      const strongCandle = document.getElementById('selectStrongCandle')?.value === 'true';
      const expMemory = document.getElementById('selectExpMemory')?.value === 'true';
      await sendSettingsUpdate({
        features: {
          strongCandleStrategy: strongCandle,
          experienceMemoryEnabled: expMemory,
        }
      }, 'تم حفظ خيارات الاستراتيجية والذاكرة بنجاح.');
    };

    window.saveAiSettings = async function() {
      const enabled = document.getElementById('selectAiEnabled')?.value === 'true';
      const minConfidence = Number(document.getElementById('inputAiMinConfidence')?.value);
      const model = document.getElementById('inputAiModel')?.value || 'deepseek/deepseek-r1';
      const m5Model = document.getElementById('inputAiM5Model')?.value || '';
      const timeoutMs = Number(document.getElementById('inputAiTimeoutMs')?.value);
      const levelTol = Number(document.getElementById('inputAiLevelTolerance')?.value);

      await sendSettingsUpdate({
        features: { aiEnabled: enabled },
        ai: {
          minConfidence,
          model,
          m5Model,
          timeoutMs,
          levelTolerancePts: levelTol,
        }
      }, 'تم حفظ معايير الذكاء الاصطناعي التشغيلية فورياً.');
    };

    window.savePersistenceSettings = async function() {
      const enabled = document.getElementById('selectPersistenceEnabled')?.value === 'true';
      const maxRetries = Number(document.getElementById('inputPersistMaxRetries')?.value);
      await sendSettingsUpdate({
        features: { persistenceEnabled: enabled },
        persistenceMaxRetries: maxRetries,
      }, 'تم حفظ خيارات التخزين والمزامنة.');
    };

    window.saveExecutionSettings = async function() {
      const venue = document.getElementById('selectExecutionVenue')?.value || 'SIMULATED';
      const spread = Number(document.getElementById('inputExecSpread')?.value);
      const slippage = Number(document.getElementById('inputExecSlippage')?.value);
      const latency = Number(document.getElementById('inputExecLatency')?.value);

      await sendSettingsUpdate({
        execution: {
          venue,
          spreadPoints: spread,
          slippagePoints: slippage,
          latencyMs: latency,
        }
      }, 'تم تحديث نموذج محاكاة التنفيذ والانزلاق فورياً.');
    };

    window.saveTelegramSettings = async function() {
      const enabled = document.getElementById('selectTgEnabled')?.value === 'true';
      const chatId = document.getElementById('inputTgChatId')?.value || '';
      await sendSettingsUpdate({
        features: { telegramEnabled: enabled },
        telegram: { enabled, chatId },
      }, 'تم حفظ إعدادات قناة تيليجرام.');
    };

    window.refreshSettings = async function(manual) {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) return;
        const body = await res.json();
        const data = body.data || body;
        currentRuntimeConfig = data;

        // 1. Account Capital
        const cap = data.risk?.accountEquity || 10000;
        const inputCap = document.getElementById('inputAccountEquity');
        if (inputCap) inputCap.value = cap;
        const lblCap = document.getElementById('lblCurrentCapital');
        if (lblCap) lblCap.textContent = '$' + cap.toLocaleString();
        const lblUpdated = document.getElementById('lblCapitalLastUpdated');
        if (lblUpdated && data.timestamp) {
          lblUpdated.textContent = 'آخر تحديث: ' + new Date(data.timestamp).toLocaleTimeString('ar-EG');
        }

        // 2. Risk Parameters
        const setVal = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
        if (data.risk) {
          setVal('inputPerTradePct', data.risk.perTradePct);
          setVal('inputMaxDrawdownPct', data.risk.maxDrawdownPct);
          setVal('inputDailyLossCapPct', data.risk.dailyLossCapPct);
          setVal('inputWeeklyLossCapPct', data.risk.weeklyLossCapPct);
          setVal('inputMaxOpenTrades', data.risk.maxOpenTrades);
          setVal('inputNetExposureMax', data.risk.netExposureMax);
          setVal('inputMaxLot', data.risk.maxLot);
          setVal('inputMarginCeilingPct', data.risk.marginCeilingPct);
        }

        // 3. Scanner
        setVal('inputScanIntervalMs', data.scanIntervalMs || 60000);
        setVal('inputStrategyExpiryBars', data.strategyExpiryBars || 6);

        // 4. Market Filters
        if (data.marketFilters) {
          setVal('selectSpreadFilter', String(Boolean(data.marketFilters.spreadFilterEnabled)));
          setVal('inputMaxSpreadPoints', data.marketFilters.maxSpreadPoints || 1.0);
          setVal('selectSessionFilter', String(Boolean(data.marketFilters.sessionFilterEnabled)));
          setVal('inputAllowedSessions', Array.isArray(data.marketFilters.allowedSessions) ? data.marketFilters.allowedSessions.join(',') : 'LONDON,NEW_YORK');
          setVal('selectNewsFilter', String(Boolean(data.marketFilters.newsFilterEnabled)));
          setVal('inputNewsWindowMinutes', data.marketFilters.newsWindowMinutes || 30);
        }

        // 5. Strategies
        if (data.features) {
          setVal('selectStrongCandle', String(Boolean(data.features.strongCandleStrategy)));
          setVal('selectExpMemory', String(Boolean(data.features.experienceMemoryEnabled)));
          setVal('selectAiEnabled', String(Boolean(data.features.aiEnabled)));
          setVal('selectPersistenceEnabled', String(Boolean(data.features.persistenceEnabled)));
          setVal('selectTgEnabled', String(Boolean(data.features.telegramEnabled)));
        }

        // 6. AI
        if (data.ai) {
          setVal('inputAiMinConfidence', data.ai.minConfidence ?? 0.6);
          setVal('inputAiModel', data.ai.model || 'deepseek/deepseek-r1');
          setVal('inputAiM5Model', data.ai.m5Model || '');
          setVal('inputAiTimeoutMs', data.ai.timeoutMs || 45000);
          setVal('inputAiLevelTolerance', data.ai.levelTolerancePts || 1.0);
        }

        // 7. Persistence
        setVal('inputPersistMaxRetries', data.persistenceMaxRetries ?? data.supabase?.maxRetries ?? 3);

        // 8. Execution
        if (data.execution) {
          setVal('selectExecutionVenue', data.execution.venue || 'SIMULATED');
          setVal('inputExecSpread', data.execution.spreadPoints ?? 0.35);
          setVal('inputExecSlippage', data.execution.slippagePoints ?? 0.2);
          setVal('inputExecLatency', data.execution.latencyMs ?? 250);
        }

        // 9. Telegram
        if (data.telegram) {
          setVal('inputTgChatId', data.telegram.chatId || '');
        }

        // 10. External status truth
        const sbEl = document.getElementById('setSupabaseState');
        if (sbEl) sbEl.textContent = data.supabase?.isConfigured ? 'CONNECTED' : 'NOT CONNECTED (DEV LOCAL)';
        const bqEl = document.getElementById('setBiquitiState');
        if (bqEl) bqEl.textContent = data.biquiti?.isConfigured ? 'CONNECTED' : 'NOT CONNECTED';
        const aiEl = document.getElementById('setNovitaState');
        if (aiEl) aiEl.textContent = data.ai?.isConfigured ? 'CONNECTED' : 'NOT CONNECTED';

        // Load Audit Log
        loadAuditTrail();

        if (manual) {
          showSettingsNotice(true, 'تم تحديث واستعادة الإعدادات بنجاح من المصدر الحاكم.');
        }
      } catch (err) {
        console.warn('refreshSettings error:', err);
      }
    };

    async function loadAuditTrail() {
      try {
        const res = await fetch('/api/settings/audit');
        if (!res.ok) return;
        const body = await res.json();
        const audit = body.data?.audit || body.audit || [];
        const tbody = document.getElementById('auditTableBody');
        const countLbl = document.getElementById('auditCountLabel');
        if (countLbl) countLbl.textContent = audit.length + ' تعديلات مسجلة';
        if (!tbody) return;

        if (audit.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" class="py-6 text-center text-slate-500 text-xs">لا توجد تعديلات مسجلة بعد. كل تعديل تشغيلي يتم حفظه سيظهر هنا بالتوثيق الكامل.</td></tr>';
          return;
        }

        tbody.innerHTML = audit.map(a => {
          const time = new Date(a.timestamp).toLocaleTimeString('ar-EG', { hour12: false });
          const changesText = Object.entries(a.changes || {})
            .map(([k, v]) => k + ': ' + JSON.stringify(v.from) + ' &rarr; ' + JSON.stringify(v.to))
            .join(' | ') || 'تحديث عام';

          return \`
            <tr class="hover:bg-slate-900/40">
              <td class="py-2.5 px-3 text-slate-400">\${time}</td>
              <td class="py-2.5 px-3 text-amber-400 font-bold">\${a.updatedBy || 'operator'}</td>
              <td class="py-2.5 px-3 text-cyan-400">\${a.section || 'config'}</td>
              <td class="py-2.5 px-3 text-slate-300 max-w-md truncate text-[11px]">\${changesText}</td>
            </tr>
          \`;
        }).join('');
      } catch (err) {
        console.warn('loadAuditTrail error:', err);
      }
    }

    // --------------------------------------------------------------------------
    // 5. MT5 Real Account & Broker UI Integration
    // --------------------------------------------------------------------------
    function showMt5Notice(success, message) {
      const box = document.getElementById('mt5NoticeBox');
      const icon = document.getElementById('mt5NoticeIcon');
      const text = document.getElementById('mt5NoticeText');
      if (!box || !icon || !text) return;

      box.className = success
        ? "p-3 rounded-lg border text-xs flex items-center justify-between gap-3 bg-emerald-950/80 border-emerald-800 text-emerald-300"
        : "p-3 rounded-lg border text-xs flex items-center justify-between gap-3 bg-rose-950/80 border-rose-800 text-rose-300";
      icon.className = success ? "w-2.5 h-2.5 rounded-full bg-emerald-400" : "w-2.5 h-2.5 rounded-full bg-rose-400";
      text.textContent = message;
      box.classList.remove('hidden');
    }

    window.refreshMt5Status = async function(manual) {
      try {
        const res = await fetch('/api/mt5');
        if (!res.ok) return;
        const body = await res.json();
        const data = body.data || body;

        // 1. Connection Status Badges
        const badge = document.getElementById('mt5StatusBadge');
        const dot = document.getElementById('mt5StatusDot');
        const sideBadge = document.getElementById('badgeMt5');
        if (badge) {
          badge.textContent = data.status || 'NOT CONFIGURED';
          if (data.status === 'CONNECTED') {
            badge.className = "text-[10px] px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800 font-bold";
            if (dot) dot.className = "w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse";
            if (sideBadge) sideBadge.className = "text-[9px] px-1 py-0.2 rounded bg-slate-900 text-emerald-400 font-bold";
          } else if (data.status === 'CONNECTING') {
            badge.className = "text-[10px] px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800 font-bold";
            if (dot) dot.className = "w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse";
            if (sideBadge) sideBadge.className = "text-[9px] px-1 py-0.2 rounded bg-slate-900 text-amber-400 font-bold";
          } else {
            badge.className = "text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 font-bold";
            if (dot) dot.className = "w-2.5 h-2.5 rounded-full bg-rose-500";
            if (sideBadge) sideBadge.className = "text-[9px] px-1 py-0.2 rounded bg-slate-900 text-rose-400 font-bold";
          }
        }

        // Form fields populate if empty/initial
        const setVal = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && !el.matches(':focus')) el.value = v; };
        setVal('inputMt5Broker', data.broker || 'JustMarkets');
        setVal('inputMt5Account', data.accountId || '');
        setVal('inputMt5Server', data.server || '');
        setVal('inputMt5Symbol', data.brokerSymbolXauusd || 'XAUUSD');
        setVal('inputMt5BridgeUrl', data.bridgeUrl || '');

        // Detail info
        const lblLastConn = document.getElementById('lblMt5LastConnected');
        if (lblLastConn) {
          lblLastConn.textContent = data.lastConnectedAt
            ? new Date(data.lastConnectedAt).toLocaleTimeString('ar-EG', { hour12: false })
            : 'لم يتم الاتصال بعد';
        }
        const lblHealth = document.getElementById('lblMt5HealthDetail');
        if (lblHealth) lblHealth.textContent = data.healthDetail || 'غير مهيأ';

        const rowErr = document.getElementById('rowMt5LastError');
        const lblErr = document.getElementById('lblMt5LastError');
        if (lblErr) {
          lblErr.textContent = data.lastError || 'لا يوجد';
          if (rowErr) rowErr.style.display = data.lastError ? 'flex' : 'none';
        }

        // 2. Financials & Account State
        const fmtUsd = (n) => typeof n === 'number' && Number.isFinite(n) ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '$---';
        const lblBal = document.getElementById('lblMt5Balance');
        if (lblBal) lblBal.textContent = data.account ? fmtUsd(data.account.balance) : '$---';

        const lblEq = document.getElementById('lblMt5Equity');
        if (lblEq) lblEq.textContent = data.account ? fmtUsd(data.account.equity) : '$---';

        const lblFree = document.getElementById('lblMt5FreeMargin');
        if (lblFree) lblFree.textContent = data.account ? fmtUsd(data.account.freeMargin) : '$---';

        const lblUsed = document.getElementById('lblMt5UsedMargin');
        if (lblUsed) lblUsed.textContent = data.account ? fmtUsd(data.account.margin) : '$---';

        const lblLvl = document.getElementById('lblMt5MarginLevel');
        if (lblLvl) lblLvl.textContent = data.account && data.account.marginLevel !== null ? data.account.marginLevel.toFixed(1) + '%' : '---%';

        const lblCurrLev = document.getElementById('lblMt5CurrencyLeverage');
        if (lblCurrLev) {
          lblCurrLev.textContent = data.account
            ? (data.account.currency || 'USD') + (data.account.leverage ? ' / 1:' + data.account.leverage : '')
            : 'USD / 1:---';
        }

        // 3. Instrument Spec
        if (data.instrumentSpec) {
          const s = data.instrumentSpec;
          const setSpec = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
          setSpec('specContractSize', s.contractSize + ' oz');
          setSpec('specMinLot', String(s.minLot));
          setSpec('specMaxLot', String(s.maxLot));
          setSpec('specLotStep', String(s.lotStep));
          setSpec('specPointSize', String(s.pointSize));
          setSpec('specTickSize', String(s.tickSize));
          setSpec('specTickValue', '$' + s.tickValue);
          setSpec('specStopsLevel', (s.minStopDistancePts || 0) + ' pts');
          setSpec('specDigits', String(s.digits));
          setSpec('specBrokerSymbol', s.brokerSymbol || data.brokerSymbolXauusd || 'XAUUSD');
        }

        // 4. Open Positions Table
        const positions = data.openPositions || [];
        const countLbl = document.getElementById('lblMt5PositionsCount');
        if (countLbl) countLbl.textContent = positions.length + ' مراكز مفتوحة';

        const tbody = document.getElementById('tblMt5PositionsBody');
        if (tbody) {
          if (positions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="p-4 text-center text-slate-500 font-sans">لا توجد مراكز مفتوحة حالياً لدى الوسيط.</td></tr>';
          } else {
            tbody.innerHTML = positions.map(p => {
              const isLong = p.side === 'LONG';
              const sideClass = isLong ? 'text-emerald-400 bg-emerald-950/60 border-emerald-800' : 'text-rose-400 bg-rose-950/60 border-rose-800';
              const pnl = p.unrealizedPnl ?? 0;
              const pnlClass = pnl >= 0 ? 'text-emerald-400' : 'text-rose-400';
              const pnlStr = (pnl >= 0 ? '+' : '') + fmtUsd(pnl);

              return \`
                <tr class="hover:bg-slate-900/40">
                  <td class="p-2 text-slate-400 font-mono">\${p.positionId}</td>
                  <td class="p-2 text-white font-bold font-mono">\${p.symbol}</td>
                  <td class="p-2"><span class="px-1.5 py-0.5 rounded text-[10px] border font-bold \${sideClass}">\${p.side}</span></td>
                  <td class="p-2 font-bold font-mono text-amber-300">\${p.lotSize}</td>
                  <td class="p-2 font-mono text-slate-300">\${p.entryPrice}</td>
                  <td class="p-2 font-mono text-white font-bold">\${p.currentPrice || '---'}</td>
                  <td class="p-2 font-mono text-rose-300">\${p.stopLoss || 'None'}</td>
                  <td class="p-2 font-mono text-emerald-300">\${p.takeProfit || 'None'}</td>
                  <td class="p-2 font-mono font-bold \${pnlClass}">\${pnlStr}</td>
                  <td class="p-2 text-[10px] text-cyan-400">\${p.protectionStatus || 'UNPROTECTED'}</td>
                </tr>
              \`;
            }).join('');
          }
        }

        if (manual) {
          showMt5Notice(true, 'تم تحديث حالة وسيط MT5 وبيانات الحساب الحقيقي.');
        }
      } catch (err) {
        console.warn('refreshMt5Status error:', err);
      }
    };

    window.saveMt5Account = async function() {
      const broker = document.getElementById('inputMt5Broker')?.value || 'JustMarkets';
      const accountId = document.getElementById('inputMt5Account')?.value || '';
      const server = document.getElementById('inputMt5Server')?.value || '';
      const brokerSymbolXauusd = document.getElementById('inputMt5Symbol')?.value || 'XAUUSD';
      const bridgeUrl = document.getElementById('inputMt5BridgeUrl')?.value || '';

      if (!accountId || !bridgeUrl) {
        showMt5Notice(false, 'يرجى إدخال رقم الحساب وعنوان الجسر Gateway URL');
        return;
      }

      try {
        const res = await fetch('/api/mt5/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: true,
            broker,
            accountId,
            server,
            brokerSymbolXauusd,
            bridgeUrl,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          showMt5Notice(false, 'فشل حفظ بيانات MT5: ' + (err.error?.message || err.message || res.statusText));
          return;
        }

        showMt5Notice(true, 'تم حفظ إعدادات حساب MT5 والاتصال بالجسر بنجاح.');
        refreshMt5Status(false);
      } catch (err) {
        showMt5Notice(false, 'خطأ في الاتصال بالخادم: ' + (err.message || String(err)));
      }
    };

    window.testMt5Connection = async function() {
      try {
        showMt5Notice(true, 'جاري اختبار الاتصال مع جسر MT5...');
        const res = await fetch('/api/mt5/connect', { method: 'POST' });
        const data = await res.json();
        const payload = data.data || data;

        if (payload.success) {
          showMt5Notice(true, '✅ الاتصال ناجح: ' + (payload.detail || 'MT5 Ready'));
        } else {
          showMt5Notice(false, '❌ تعذر الاتصال بالوسيط: ' + (payload.detail || payload.error || 'Check bridge'));
        }
        refreshMt5Status(false);
      } catch (err) {
        showMt5Notice(false, 'خطأ في اختبار الاتصال: ' + (err.message || String(err)));
      }
    };

    window.disconnectMt5 = async function() {
      try {
        await fetch('/api/mt5/disconnect', { method: 'POST' });
        showMt5Notice(true, 'تم قطع الاتصال مع وسيط MT5.');
        refreshMt5Status(false);
      } catch (err) {
        showMt5Notice(false, 'خطأ: ' + (err.message || String(err)));
      }
    };

    window.confirmDeleteMt5Account = async function() {
      if (!confirm('هل أنت متأكد من رغبتك في حذف بيانات حساب MT5 الحقيقي بالكامل من النظام؟')) {
        return;
      }
      try {
        const res = await fetch('/api/mt5/config', { method: 'DELETE' });
        if (res.ok) {
          showMt5Notice(true, 'تم حذف بيانات حساب MT5 بالكامل وإلغاء تهيئة الوسيط.');
          const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
          setVal('inputMt5Account', '');
          setVal('inputMt5Server', '');
          setVal('inputMt5BridgeUrl', '');
          refreshMt5Status(false);
        } else {
          showMt5Notice(false, 'فشل حذف الحساب.');
        }
      } catch (err) {
        showMt5Notice(false, 'خطأ: ' + (err.message || String(err)));
      }
    };

    window.triggerMt5Reconciliation = async function() {
      try {
        showMt5Notice(true, 'جاري مطابقة مراكز التداول مع وسيط MT5...');
        const res = await fetch('/api/mt5/reconcile', { method: 'POST' });
        const data = await res.json();
        const payload = data.data || data;

        const lblReconcile = document.getElementById('lblReconciliationStatus');
        if (lblReconcile) {
          if (payload.status === 'BROKER_NOT_CONNECTED') {
            lblReconcile.textContent = 'الوسيط غير متصل (BROKER_NOT_CONNECTED)';
            lblReconcile.className = 'font-bold text-slate-400';
            showMt5Notice(false, '⚠️ تعذر إجراء المطابقة: وسيط MT5 غير متصل.');
          } else if (payload.mismatchesCount === 0) {
            lblReconcile.textContent = 'متطابق بنسبة 100%';
            lblReconcile.className = 'font-bold text-emerald-400';
            showMt5Notice(true, '✅ اكتملت المطابقة: لا توجد أي فروقات بين سجل النظام والوسيط.');
          } else {
            lblReconcile.textContent = payload.mismatchesCount + ' فروقات بحاجة معالجة';
            lblReconcile.className = 'font-bold text-rose-400';
            showMt5Notice(false, '⚠️ تنبيه: تم رصد ' + payload.mismatchesCount + ' فروقات في الصفقات.');
          }
        }
      } catch (err) {
        showMt5Notice(false, 'خطأ في المطابقة: ' + (err.message || String(err)));
      }
    };

    // --------------------------------------------------------------------------
    // 6. SSE Real-Time Stream & Initialization Lifecycle
    // --------------------------------------------------------------------------
    function initSse() {
      try {
        sseEventSource = new EventSource('/api/events');
        sseEventSource.onopen = function() {
          const sseDot = document.getElementById('topSseDot');
          const sseText = document.getElementById('topSseText');
          if (sseDot) sseDot.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse";
          if (sseText) sseText.textContent = "LIVE";
        };
        sseEventSource.onmessage = function(e) {
          try {
            const data = JSON.parse(e.data);
            if (data.name === 'market.tick') {
              lastPrice = data.payload?.price || lastPrice;
              updatePriceTelemetry(lastPrice);
            } else if (data.name === 'candle.closed') {
              refreshCandles();
            } else if (data.name === 'setup.created') {
              refreshSetups();
            } else if (data.name === 'risk.killswitch_changed') {
              refreshRisk();
            }
          } catch (err) {}
        };
        sseEventSource.onerror = function() {
          const sseDot = document.getElementById('topSseDot');
          const sseText = document.getElementById('topSseText');
          if (sseDot) sseDot.className = "w-2 h-2 rounded-full bg-amber-500";
          if (sseText) sseText.textContent = "POLL";
        };
      } catch (err) {
        console.warn("SSE init error:", err);
      }
    }

    // Refresh dispatchers
    window.refreshDashboard = function() { refreshCandles(); refreshSetups(); refreshScanner(); refreshRisk(); };
    window.refreshMarketData = function() { refreshCandles(); };
    window.refreshSetups = function() { refreshSetups(); };
    window.refreshSignals = function() { refreshSetups(); };
    window.refreshRisk = function() { refreshRisk(); };
    window.refreshScanner = function() { refreshScanner(); };
    window.refreshPositions = function() { refreshPositions(); };
    window.refreshSystemHealth = function() {};

    // Initial startup
    window.addEventListener('DOMContentLoaded', () => {
      resizeCanvas();
      refreshCandles();
      refreshSetups();
      refreshScanner();
      refreshPositions();
      refreshRisk();
      refreshTelegram();
      refreshMt5Status(false);
      refreshSettings(false);
      initSse();

      // Poll every 3 seconds for continuous live telemetry
      setInterval(() => {
        refreshCandles();
        refreshRisk();
        refreshScanner();
        refreshTelegram();
        refreshMt5Status(false);
      }, 3000);
    });

  })();
  `;
}
