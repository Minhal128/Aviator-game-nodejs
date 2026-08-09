@extends('Layout.admindashboard')
@section('css')
@endsection

@section('content')
<div class="content-wrapper">
  <div class="page-header">
    <h3 class="page-title mb-0">
      <span class="page-title-icon bg-gradient-primary text-white me-2">
        <i class="mdi mdi-radar"></i>
      </span> Control Tower
    </h3>
    <div id="hdr_live_pill" class="tl-live-pill is-idle">
      <span class="dot"></span>
      <span class="lbl">STANDBY</span>
    </div>
  </div>

  <div class="tl-hud" id="flight_hud">
    <div class="tl-hud-inner">
      <div class="tl-hud-top">
        <h4 class="tl-hud-title">Live Flight <span id="hud_game_id">#—</span></h4>
        <div id="hud_phase_pill" class="tl-live-pill is-idle"><span class="dot"></span><span class="lbl">IDLE</span></div>
      </div>
      <div class="d-flex flex-wrap align-items-end justify-content-between gap-3">
        <div>
          <div class="tl-stat-label" style="color:var(--tl-muted);font-size:.75rem;letter-spacing:.1em;text-transform:uppercase;">Multiplier</div>
          <div id="hud_mult" class="tl-mult">1.00x</div>
        </div>
        <div class="text-end">
          <div class="tl-stat-label" style="color:var(--tl-muted);font-size:.75rem;letter-spacing:.1em;text-transform:uppercase;">Admin wallet</div>
          <div id="hud_admin_wallet" style="font-family:var(--tl-mono);font-size:1.4rem;font-weight:700;">—</div>
        </div>
      </div>
      <div class="tl-hud-grid">
        <div class="tl-metric"><label>Total bets</label><strong id="hud_total">0</strong></div>
        <div class="tl-metric"><label>Payout pool</label><strong id="hud_pool">0</strong></div>
        <div class="tl-metric"><label>Paid out</label><strong id="hud_paid">0</strong></div>
        <div class="tl-metric"><label>Remaining</label><strong id="hud_remain">0</strong></div>
      </div>
      <div class="tl-pool-bar" title="Pool remaining"><i id="hud_bar"></i></div>
    </div>
  </div>

  <div class="row">
    <div class="col-12 col-sm-6 col-lg-3 stretch-card grid-margin">
      <div class="card tl-stat">
        <div class="card-body">
          <div class="tl-stat-label">Total users</div>
          <p class="tl-stat-value">{{ count($user) }}</p>
        </div>
      </div>
    </div>
    <div class="col-12 col-sm-6 col-lg-3 stretch-card grid-margin">
      <div class="card tl-stat tl-stat-amber">
        <div class="card-body">
          <div class="tl-stat-label">Recharges</div>
          <p class="tl-stat-value">{{ count($recharge) }}</p>
        </div>
      </div>
    </div>
    <div class="col-12 col-sm-6 col-lg-3 stretch-card grid-margin">
      <div class="card tl-stat tl-stat-signal">
        <div class="card-body">
          <div class="tl-stat-label">Withdrawals</div>
          <p class="tl-stat-value">{{ count($withdrawal) }}</p>
        </div>
      </div>
    </div>
    <div class="col-12 col-sm-6 col-lg-3 stretch-card grid-margin">
      <div class="card tl-stat">
        <div class="card-body">
          <div class="tl-stat-label">Pending queue</div>
          <p class="tl-stat-value"><span id="hud_pending">0</span></p>
        </div>
      </div>
    </div>
  </div>

  <div class="row">
    <div class="col-12 grid-margin stretch-card">
      <div class="card tl-bets-panel">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h4 class="card-title mb-0">Round bets</h4>
            <span class="text-muted" style="font-size:.8rem;">Updates every 400ms</span>
          </div>
          <div class="table-responsive">
            <table class="table mb-0">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Bet</th>
                  <th>Status</th>
                  <th>Mult</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody id="hud_bets">
                <tr><td colspan="5" class="tl-empty">Waiting for round…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
@endsection

@section('js')
<script src="/socket.io/socket.io.js"></script>
<script>
(function () {
  var GAME_SOCKET_URL = @json(env('GAME_SOCKET_URL', 'http://127.0.0.1:3001'));
  var pollTimer = null;
  var watchedId = null;
  var socket = null;

  function money(n) {
    return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function setPill(el, phase) {
    if (!el) return;
    el.classList.remove('is-idle', 'is-crash');
    var lbl = el.querySelector('.lbl');
    if (phase === 'flying') {
      if (lbl) lbl.textContent = 'LIVE';
    } else if (phase === 'crashed') {
      el.classList.add('is-crash');
      if (lbl) lbl.textContent = 'CRASHED';
    } else {
      el.classList.add('is-idle');
      if (lbl) lbl.textContent = phase === 'idle' ? 'STANDBY' : String(phase || 'IDLE').toUpperCase();
    }
  }

  function render(data) {
    var t = data.tick || {};
    var phase = t.phase || 'idle';
    setPill(document.getElementById('hdr_live_pill'), phase === 'flying' ? 'flying' : (phase === 'crashed' ? 'crashed' : 'idle'));
    setPill(document.getElementById('hud_phase_pill'), phase);

    document.getElementById('hud_game_id').textContent = t.game_id ? ('#' + t.game_id) : '#—';
    var multEl = document.getElementById('hud_mult');
    var m = (Number(t.multiplier) || 1).toFixed(2) + 'x';
    if (multEl.textContent !== m) {
      multEl.textContent = m;
      multEl.style.transform = 'scale(1.04)';
      setTimeout(function () { multEl.style.transform = 'scale(1)'; }, 120);
    }
    multEl.classList.toggle('is-crash', !!t.crashed || phase === 'crashed');

    document.getElementById('hud_total').textContent = money(t.total_bets);
    document.getElementById('hud_pool').textContent = money(t.pool);
    document.getElementById('hud_paid').textContent = money(t.paid);
    document.getElementById('hud_remain').textContent = money(t.remaining_pool);
    document.getElementById('hud_admin_wallet').textContent = money(data.admin_wallet);
    document.getElementById('hud_pending').textContent =
      (Number(data.pending_recharge) || 0) + (Number(data.pending_withdraw) || 0);

    var pct = t.pool > 0 ? Math.max(0, Math.min(100, (t.remaining_pool / t.pool) * 100)) : 0;
    document.getElementById('hud_bar').style.width = pct + '%';

    var bets = data.bets || [];
    var tb = document.getElementById('hud_bets');
    if (!bets.length) {
      tb.innerHTML = '<tr><td colspan="5" class="tl-empty">No bets this round</td></tr>';
    } else {
      tb.innerHTML = bets.map(function (b) {
        var st = b.status === 'cashed'
          ? '<span class="tl-bet-cashed">CASHED</span>'
          : '<span class="tl-bet-flying">FLYING</span>';
        var mx = b.status === 'cashed' ? (b.cashout_multiplier || '—') : (Number(t.multiplier) || 1).toFixed(2);
        return '<tr>' +
          '<td>' + (b.name || b.userid) + '</td>' +
          '<td>' + money(b.amount) + '</td>' +
          '<td>' + st + '</td>' +
          '<td>' + mx + 'x</td>' +
          '<td>' + money(b.potential) + '</td>' +
          '</tr>';
      }).join('');
    }

    if (socket && socket.connected && t.game_id && t.game_id !== watchedId && phase === 'flying') {
      watchedId = t.game_id;
      socket.emit('watch', { game_id: t.game_id });
    }
  }

  function fetchLive() {
    $.getJSON('/admin/api/live-round')
      .done(render)
      .fail(function () { /* keep last frame */ });
  }

  try {
    if (typeof io !== 'undefined') {
      socket = io(GAME_SOCKET_URL, { transports: ['websocket', 'polling'] });
      socket.on('tick', function (tick) {
        // merge socket tick into next poll paint; still poll for bets/wallet
        var multEl = document.getElementById('hud_mult');
        if (multEl && tick && tick.multiplier != null) {
          multEl.textContent = Number(tick.multiplier).toFixed(2) + 'x';
          multEl.classList.toggle('is-crash', !!tick.crashed);
          setPill(document.getElementById('hud_phase_pill'), tick.crashed ? 'crashed' : 'flying');
          setPill(document.getElementById('hdr_live_pill'), tick.crashed ? 'crashed' : 'flying');
        }
      });
    }
  } catch (e) {}

  fetchLive();
  pollTimer = setInterval(fetchLive, 400);
})();
</script>
@endsection
