// Floating lobby back + shared wallet HUD for every embedded game.
// Aviator already has #wallet_balance — skip the chip there to avoid a double display.
(function () {
    if (window.__TL_BACK__) return;
    window.__TL_BACK__ = true;

    function mountLobby() {
        var a = document.createElement('a');
        a.href = '/dashboard';
        a.setAttribute('aria-label', 'Back to lobby');
        a.textContent = '← Lobby';
        a.style.cssText = [
            'position:fixed', 'top:12px', 'left:12px', 'z-index:2147483646',
            'display:inline-flex', 'align-items:center', 'gap:6px',
            'padding:8px 14px', 'border-radius:999px',
            'background:rgba(10,14,24,.88)', 'border:1px solid rgba(255,255,255,.18)',
            'color:#fff', 'font:600 13px/1.2 system-ui,Segoe UI,sans-serif',
            'text-decoration:none', 'box-shadow:0 4px 16px rgba(0,0,0,.35)',
            'cursor:pointer', 'pointer-events:auto'
        ].join(';');
        if (!document.body.contains(a)) document.body.appendChild(a);
    }

    function money(n) {
        return '₹' + Number(n || 0).toFixed(2);
    }

    function mountWallet() {
        var w = window.TL_WALLET;
        if (!w) return;
        // site crash page already shows the real wallet
        if (document.getElementById('wallet_balance') || document.getElementById('header_wallet_balance')) return;
        if (document.getElementById('tl-wallet-hud')) return;

        var a = document.createElement('a');
        a.href = '/deposit';
        a.id = 'tl-wallet-hud';
        a.setAttribute('aria-label', 'Wallet / Deposit');
        a.innerHTML = '<span class="tl-bal">' + money(w.balance) + '</span><span style="opacity:.85;font-weight:700;margin-left:8px">DEPOSIT</span>';
        a.style.cssText = [
            'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483646',
            'display:inline-flex', 'align-items:center',
            'padding:8px 14px', 'border-radius:999px',
            'background:#ffba00', 'border:1px solid rgba(0,0,0,.15)',
            'color:#111', 'font:700 13px/1.2 system-ui,Segoe UI,sans-serif',
            'text-decoration:none', 'box-shadow:0 4px 16px rgba(0,0,0,.35)',
            'cursor:pointer', 'pointer-events:auto'
        ].join(';');
        document.body.appendChild(a);

        function paint(n) {
            var t = money(n);
            var bal = a.querySelector('.tl-bal');
            if (bal) bal.textContent = t;
            var side = document.getElementById('walletBalanceText');
            if (side) side.textContent = t;
        }

        window.TL_setWallet = function (n) {
            var v = Number(n);
            if (isNaN(v)) return;
            w.balance = v;
            paint(v);
        };

        // games that mutate TL_WALLET.balance get picked up without per-game hooks
        var last = Number(w.balance);
        setInterval(function () {
            var cur = Number(w.balance);
            if (!isNaN(cur) && cur !== last) {
                last = cur;
                paint(cur);
            }
        }, 400);
    }

    function boot() {
        mountLobby();
        mountWallet();
    }
    if (document.body) boot();
    else document.addEventListener('DOMContentLoaded', boot);
})();
