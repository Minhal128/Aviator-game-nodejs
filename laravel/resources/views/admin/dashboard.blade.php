@extends('Layout.tower')
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
          <div class="tl-stat-label">Deposits</div>
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
    <div class="col-12 col-xl-7 grid-margin stretch-card">
      <div class="card">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
            <div>
              <h4 class="card-title mb-1">Cashier, last 14 days</h4>
              <span class="text-muted" style="font-size:.8rem;">Approved deposits against approved withdrawals</span>
            </div>
            <div class="text-end">
              <div class="tl-chart-fig" id="fig_dep">—</div>
              <div class="tl-chart-cap">in &middot; <span id="fig_wd">—</span> out</div>
            </div>
          </div>
          <div class="tl-chart-wrap"><canvas id="chart_cashier" height="220"></canvas><p class="tl-chart-empty" id="chart_cashier_empty" hidden></p></div>
        </div>
      </div>
    </div>
    <div class="col-12 col-xl-5 grid-margin stretch-card">
      <div class="card">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
            <div>
              <h4 class="card-title mb-1">Play, last 14 days</h4>
              <span class="text-muted" style="font-size:.8rem;">Staked against paid out, all five games</span>
            </div>
            <div class="text-end">
              <div class="tl-chart-fig" id="fig_house">—</div>
              <div class="tl-chart-cap">house kept</div>
            </div>
          </div>
          <div class="tl-chart-wrap"><canvas id="chart_play" height="220"></canvas><p class="tl-chart-empty" id="chart_play_empty" hidden></p></div>
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
            <span class="text-muted" style="font-size:.8rem;" id="hud_bets_label">Updates every 400ms</span>
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
    var lbl = document.getElementById('hud_bets_label');
    if (lbl) {
      lbl.textContent = data.bets_is_prev
        ? ('Last round #' + (data.bets_game_id || '—'))
        : 'Updates every 400ms';
    }
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

  // ---- charts: every point comes from /admin/api/stats, which is all SQL ----
  var css = getComputedStyle(document.body);
  var pick = function (name, fallback) {
    var v = (css.getPropertyValue(name) || '').trim();
    return v || fallback;
  };
  var CRIMSON = pick('--tl-crimson', '#e50539');
  var AMBER = pick('--tl-amber', '#ffb020');
  var GREEN = pick('--tl-green', '#14c46a');
  var MUTED = pick('--tl-muted', '#8ea3c6');
  var GRID = 'rgba(255,255,255,.07)';

  var base = {
    maintainAspectRatio: false,
    legend: { labels: { fontColor: MUTED, boxWidth: 12, fontSize: 11 } },
    tooltips: { mode: 'index', intersect: false },
    scales: {
      xAxes: [{ gridLines: { color: GRID, zeroLineColor: GRID }, ticks: { fontColor: MUTED, fontSize: 10, maxRotation: 0, autoSkipPadding: 12 } }],
      yAxes: [{ gridLines: { color: GRID, zeroLineColor: GRID }, ticks: { fontColor: MUTED, fontSize: 10, beginAtZero: true } }]
    }
  };
  var cashierChart = null;
  var playChart = null;

  function fill(ctx, color) {
    var g = ctx.createLinearGradient(0, 0, 0, 220);
    g.addColorStop(0, color.replace('rgb', 'rgba').replace(')', ',.35)'));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    return g;
  }

  function drawCharts(d) {
    document.getElementById('fig_dep').textContent = '₹' + money(d.totals.deposits);
    document.getElementById('fig_wd').textContent = '₹' + money(d.totals.withdrawals);
    document.getElementById('fig_house').textContent =
      d.totals.house_pct === null ? 'no play yet' : d.totals.house_pct + '%';

    if (!window.Chart) return;

    // an all-zero window draws a bare grid, which reads as broken rather than quiet
    var sum = function (a) { return (a || []).reduce(function (t, v) { return t + (Number(v) || 0); }, 0); };
    function emptyState(id, empty, note) {
      document.getElementById(id).style.visibility = empty ? 'hidden' : 'visible';
      var el = document.getElementById(id + '_empty');
      el.textContent = note;
      el.hidden = !empty;
    }
    emptyState('chart_cashier', sum(d.deposits) + sum(d.withdrawals) === 0,
      'Nothing approved in the last 14 days. ' + d.totals.pending_deposits + ' deposit and ' +
      d.totals.pending_withdrawals + ' withdrawal requests are waiting.');
    emptyState('chart_play', sum(d.staked) === 0, 'No bets placed in the last 14 days.');

    if (cashierChart) {
      cashierChart.data.labels = d.labels;
      cashierChart.data.datasets[0].data = d.deposits;
      cashierChart.data.datasets[1].data = d.withdrawals;
      cashierChart.update();
    } else {
      cashierChart = new Chart(document.getElementById('chart_cashier').getContext('2d'), {
        type: 'bar',
        data: {
          labels: d.labels,
          datasets: [
            { label: 'Deposits in', data: d.deposits, backgroundColor: GREEN, borderWidth: 0, barPercentage: .7, categoryPercentage: .7 },
            { label: 'Withdrawals out', data: d.withdrawals, backgroundColor: CRIMSON, borderWidth: 0, barPercentage: .7, categoryPercentage: .7 }
          ]
        },
        options: base
      });
    }

    if (playChart) {
      playChart.data.labels = d.labels;
      playChart.data.datasets[0].data = d.staked;
      playChart.data.datasets[1].data = d.paid;
      playChart.update();
    } else {
      var ctx = document.getElementById('chart_play').getContext('2d');
      playChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: d.labels,
          datasets: [
            { label: 'Staked', data: d.staked, borderColor: AMBER, backgroundColor: fill(ctx, 'rgb(255,176,32)'), borderWidth: 2, pointRadius: 2, pointBackgroundColor: AMBER, lineTension: .3 },
            { label: 'Paid out', data: d.paid, borderColor: CRIMSON, backgroundColor: 'rgba(0,0,0,0)', borderWidth: 2, pointRadius: 2, pointBackgroundColor: CRIMSON, lineTension: .3 }
          ]
        },
        options: base
      });
    }
  }

  function fetchStats() {
    $.getJSON('/admin/api/stats').done(drawCharts).fail(function () { /* keep last frame */ });
  }
  fetchStats();
  // aggregates move when someone deposits or plays, not every frame
  setInterval(fetchStats, 15000);
})();
</script>
@endsection
