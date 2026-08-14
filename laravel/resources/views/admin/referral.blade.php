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
        <p class="text-muted" style="margin-top:-.5rem;">Credits paid when someone registers with a referral link.</p>

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
