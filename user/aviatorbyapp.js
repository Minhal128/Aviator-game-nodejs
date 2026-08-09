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

// ponytail: 8s bet window with visible countdown, then place bet → crash target → fly
var ROUND_WAIT_SEC = 8;

function gamegenerate() {
    setTimeout(function () {
        stage_time_out = 0;
        $("#auto_increment_number_div").hide();
        $(".flew_away_section").hide();
        $("#auto_increment_number").removeClass('text-danger');
        $('.loading-game').addClass('show');

        var left = ROUND_WAIT_SEC;
        $("#round_countdown").text(left);

        var tick = setInterval(function () {
            left--;
            $("#round_countdown").text(Math.max(left, 0));
            if (left <= 0) {
                clearInterval(tick);
                start_round();
            }
        }, 1000);
    }, 1200);
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

(function initGameSocket() {
    if (typeof io === 'undefined' || typeof GAME_SOCKET_URL === 'undefined') return;
    try {
        gameSocket = io(GAME_SOCKET_URL, { transports: ['websocket', 'polling'], autoConnect: true });
        gameSocket.on('tick', function (tick) {
            if (!tick || _flight_crashed) return;
            var m = parseFloat(tick.multiplier).toFixed(2);
            incrementor(m);
            if (tick.crashed) {
                end_flight_crash(m);
            }
        });
    } catch (e) {
        gameSocket = null;
    }
})();

function end_flight_crash(res) {
    if (_flight_crashed) return;
    _flight_crashed = true;
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

function run_multiplier() {
    _flight_crashed = false;
    if (_flight_tick_timer) {
        clearInterval(_flight_tick_timer);
        _flight_tick_timer = null;
    }

    $.ajax({
        url: '/game/increamentor',
        type: "POST",
        data: { _token: hash_id },
        dataType: "json",
        success: function (data) {
            var gameId = (data.game_id) ? data.game_id : (current_game_data && current_game_data.id);

            $.ajax({
                url: '/game/currentlybet',
                type: "POST",
                data: { _token: hash_id },
                dataType: "json",
                success: function (intialData) { info_data(intialData); }
            });

            if (gameSocket && gameSocket.connected) {
                gameSocket.emit('watch', { game_id: gameId });
                return;
            }

            // fallback: HTTP poll (same authority as socket)
            _flight_tick_timer = setInterval(function () {
                $.ajax({
                    url: '/game/tick',
                    type: "POST",
                    data: { _token: hash_id, game_id: gameId },
                    dataType: "json",
                    success: function (tick) {
                        if (!tick) return;
                        var m = parseFloat(tick.multiplier).toFixed(2);
                        incrementor(m);
                        if (tick.crashed) {
                            end_flight_crash(m);
                        }
                    }
                });
            }, 100);
        }
    });
}

function check_game_running(event) {}

$(document).ready(function () {
    check_game_running("check");
});
