function gameover(lastint) {
    var gid = (current_game_data && current_game_data.id) ? current_game_data.id : '';
    $.ajax({
        url: '/game/game_over',
        type: "POST",
        data: {
            _token: hash_id,
            "last_time": lastint,
            "game_id": gid
        },
        dataType: "text",
        success: function (result) {
            $("#wallet_balance").text(currency_symbol + result);
            $("#header_wallet_balance").text(currency_symbol + result);
            for (let i = 0; i < bet_array.length; i++) {
                if (bet_array[i] && bet_array[i].is_bet) {
                    bet_array.splice(i, 1);
                    i--;
                }
            }
        }
    });
}

function currentid() {
    $.ajax({
        url: '/game/currentid',
        type: "post",
        data: { _token: hash_id },
        dataType: "json",
        success: function () {}
    });
}

var ROUND_WAIT_SEC = 10;
var _wait_timer = null;
var _wait_left = 0;
var _flight_game_id = null;
var _in_flight = false;

function resetFillLine(seconds) {
    var el = document.getElementById('round_fill_line') || document.querySelector('.fill-line');
    if (!el) return;
    el.classList.remove('is-paused');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = 'line-fill ' + seconds + 's linear';
}

// ponytail: no bet → waiting for bet; else next round
function updateWaitingText() {
    var hasBet = (typeof bet_array !== 'undefined' && bet_array.length > 0)
        || $("#main_bet_section #cancle_button:visible").length > 0
        || $("#extra_bet_section #cancle_button:visible").length > 0;
    $(".waiting-text").text(hasBet ? 'WAITING FOR NEXT ROUND' : 'WAITING FOR BET');
}

function gamegenerate() {
    _in_flight = false;
    setTimeout(function () {
        stage_time_out = 0;
        $("#auto_increment_number_div").hide();
        $(".flew_away_section").hide();
        $("#auto_increment_number").removeClass('text-danger');
        $('.loading-game').addClass('show');
        updateWaitingText();

        _wait_left = ROUND_WAIT_SEC;
        $("#round_countdown").text(_wait_left);
        resetFillLine(ROUND_WAIT_SEC);

        if (_wait_timer) clearInterval(_wait_timer);
        _wait_timer = setInterval(function () {
            _wait_left--;
            $("#round_countdown").text(Math.max(_wait_left, 0));
            if (_wait_left <= 0) {
                clearInterval(_wait_timer);
                _wait_timer = null;
                start_round();
            }
        }, 1000);
    }, 400);
}

function start_round() {
    $.ajax({
        url: '/game/new_game_generated',
        type: "POST",
        data: { _token: hash_id },
        dataType: "json",
        success: function (result) {
            stage_time_out = 1;
            current_game_data = result;

            $.ajax({
                url: '/game/currentlybet',
                type: "POST",
                data: { _token: hash_id },
                dataType: "json",
                success: function (intialData) { info_data(intialData); }
            });

            hide_loading_game();
            new_game_generated(); // auto-bet can join bet_array here

            function afterBets() {
                lets_fly_one();
                lets_fly();
                run_multiplier();
            }

            if (bet_array.length > 0) {
                place_bet_now(afterBets);
            } else {
                afterBets();
            }
        }
    });
}

function refresh_my_bets_after_crash() {
    $("#all_bets .mCSB_container").empty();
    $.ajax({
        url: '/game/my_bets_history',
        type: "POST",
        data: { _token: hash_id },
        dataType: "json",
        success: function (rows) {
            $("#my_bet_list").empty();
            for (let $i = 0; $i < rows.length; $i++) {
                let date = new Date(rows[$i].created_at);
                $("#my_bet_list").append(`
                                    <div class="list-items">
                                    <div class="column-1 users fw-normal">
                                        ` + date.getHours() + `:` + date.getMinutes() + `
                                    </div>
                                    <div class="column-2">
                                        <button class="btn btn-transparent previous-history d-flex align-items-center mx-auto fw-normal">
                                            ` + rows[$i].amount + `₹
                                        </button>
                                    </div>
                                    <div class="column-3">
                                        <div class="bg3 custom-badge mx-auto">
                                            ` + rows[$i].cashout_multiplier + `x</div>
                                    </div>
                                    <div class="column-4 fw-normal">
                                        ` + Math.round(rows[$i].cashout_multiplier * rows[$i].amount) + `₹
                                    </div>
                                </div>`);
            }
        }
    });
}

// ponytail: server-authoritative multiplier + pool crash via socket (poll fallback)
var _flight_tick_timer = null;
var _flight_crashed = false;
var gameSocket = null;
var _last_tick_at = 0;

(function initGameSocket() {
    // ponytail: empty GAME_SOCKET_URL means no game-server, so stay on the poll
    if (typeof io === 'undefined' || typeof GAME_SOCKET_URL === 'undefined' || !GAME_SOCKET_URL) return;
    try {
        gameSocket = io(GAME_SOCKET_URL, { transports: ['websocket', 'polling'], autoConnect: true });
        gameSocket.on('tick', function (tick) {
            if (!tick || _flight_crashed) return;
            _last_tick_at = Date.now();
            var m = parseFloat(tick.multiplier).toFixed(2);
            noteFlightProgress(m);
            incrementor(m);
            if (typeof applyTickForfeits === 'function') applyTickForfeits(tick);
            if (tick.crashed) {
                end_flight_crash(m);
            }
        });
    } catch (e) {
        gameSocket = null;
    }
})();

// ponytail: a failed /game/increamentor or /game/tick used to freeze the plane forever,
// because nothing else ends a round. No progress for 5s => end it and fly the next one.
var _round_watchdog = null;
var _last_progress_at = 0;
var _last_progress_mult = '';

function noteFlightProgress(m) {
    if (m === _last_progress_mult) return;
    _last_progress_mult = m;
    _last_progress_at = Date.now();
}

function startRoundWatchdog() {
    if (_round_watchdog) clearInterval(_round_watchdog);
    _last_progress_mult = '';
    _last_progress_at = Date.now();
    _round_watchdog = setInterval(function () {
        if (!_in_flight || _flight_crashed) {
            clearInterval(_round_watchdog);
            _round_watchdog = null;
            return;
        }
        if (Date.now() - _last_progress_at > 5000) {
            end_flight_crash($("#auto_increment_number").text().slice(0, -1) || '1.00');
        }
    }, 1000);
}

function end_flight_crash(res) {
    if (_flight_crashed) return;
    _flight_crashed = true;
    _in_flight = false;
    if (_round_watchdog) {
        clearInterval(_round_watchdog);
        _round_watchdog = null;
    }
    if (_flight_tick_timer) {
        clearInterval(_flight_tick_timer);
        _flight_tick_timer = null;
    }
    crash_plane(res);
    incrementor(res);
    gameover(res);
    refresh_my_bets_after_crash();
    gamegenerate();
}

function startFlightPoll(gameId) {
    if (_flight_tick_timer) {
        clearInterval(_flight_tick_timer);
        _flight_tick_timer = null;
    }
    _flight_tick_timer = setInterval(function () {
        if (_flight_crashed) return;
        $.ajax({
            url: '/game/tick',
            type: "POST",
            data: { _token: hash_id, game_id: gameId },
            dataType: "json",
            success: function (tick) {
                if (!tick) return;
                var m = parseFloat(tick.multiplier).toFixed(2);
                noteFlightProgress(m);
                incrementor(m);
                if (typeof applyTickForfeits === 'function') applyTickForfeits(tick);
                if (tick.crashed) {
                    end_flight_crash(m);
                }
            }
        });
    }, 100);
}

function run_multiplier() {
    _flight_crashed = false;
    _in_flight = true;
    if (_flight_tick_timer) {
        clearInterval(_flight_tick_timer);
        _flight_tick_timer = null;
    }
    startRoundWatchdog();

    $.ajax({
        url: '/game/increamentor',
        type: "POST",
        data: { _token: hash_id },
        dataType: "json",
        success: function (data) {
            var gameId = (data.game_id) ? data.game_id : (current_game_data && current_game_data.id);
            _flight_game_id = gameId;

            $.ajax({
                url: '/game/currentlybet',
                type: "POST",
                data: { _token: hash_id },
                dataType: "json",
                success: function (intialData) { info_data(intialData); }
            });

            if (gameSocket && gameSocket.connected) {
                gameSocket.emit('watch', { game_id: gameId });
                // ponytail: a socket that connects but never ticks (stale GAME_SOCKET_URL)
                // used to freeze the plane at 1.00x, so poll unless a tick actually lands
                _last_tick_at = 0;
                setTimeout(function () {
                    if (_in_flight && !_flight_crashed && !_last_tick_at) {
                        startFlightPoll(gameId);
                    }
                }, 700);
                return;
            }

            startFlightPoll(gameId);
        }
    });
}

function check_game_running(event) {}

$(document).ready(function () {
    check_game_running("check");
    // ponytail: nothing else boots the loop, so the plane sat at 1.00x after every reload;
    // from here crash -> gamegenerate -> start_round keeps it cycling on its own
    gamegenerate();
});
