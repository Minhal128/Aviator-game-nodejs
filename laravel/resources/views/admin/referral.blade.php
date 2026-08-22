@extends('Layout.tower')
@section('css')
@endsection

@section('content')
    <div class="content-wrapper">
        <div class="page-header">
            <h3 class="page-title">
                <span class="page-title-icon bg-gradient-primary text-white me-2">
                    <i class="mdi mdi-account-plus"></i>
                </span> Referral
            </h3>
        </div>
        <p class="text-muted" style="margin-top:-.5rem;">New-player bonus on signup. Referrer reward only after the referred player’s first approved deposit of ₹300 or more. Bonus is playable but not withdrawable until wagered.</p>

        <div class="row">
            <div class="col-lg-6 col-12 grid-margin stretch-card">
                <div class="card">
                    <div class="card-body">
                        <h4 class="card-title"><i class="mdi mdi-cash me-1"></i> Bonuses</h4>
                        <form class="forms-sample" id="referral_form">
                            @csrf
                            <div class="form-group">
                                <label for="referral_bonus">New player bonus (₹)</label>
                                <input type="number" min="0" step="1" class="form-control" id="referral_bonus"
                                    name="referral_bonus" value="{{ $referralBonus }}">
                            </div>
                            <div class="form-group">
                                <label for="referrer_bonus">Referrer reward (₹)</label>
                                <input type="number" min="0" step="1" class="form-control" id="referrer_bonus"
                                    name="referrer_bonus" value="{{ $referrerBonus }}">
                            </div>
                            <div class="form-group">
                                <label for="bonus_wager_mult">Bonus wager multiplier (×)</label>
                                <input type="number" min="0" step="0.1" class="form-control" id="bonus_wager_mult"
                                    name="bonus_wager_mult" value="{{ $bonusWagerMult }}">
                                <small class="form-text text-muted">1 = play the bonus once before it unlocks. 5 = stake 5× the bonus in games.</small>
                            </div>
                            <button type="submit" class="btn btn-gradient-primary me-2">Save</button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </div>
@endsection

@section('js')
    <script>
        $("#referral_form").on('submit', function (e) { e.preventDefault(); });
        $("#referral_form").validate({
            submitHandler: function (form) {
                apex("POST", "{{ url('admin/api/referral') }}", new FormData(form), form,
                    "/admin/referral", "#");
            }
        });
    </script>
@endsection
