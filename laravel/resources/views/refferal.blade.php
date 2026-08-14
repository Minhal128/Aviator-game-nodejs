@extends('Layout.usergame2')
@section('content')
    <div class="active" id="via-email">
        <form class="register-form row w-25" style="margin: 100px auto 0 auto; color: white !important;" onsubmit="return false;">
            <h2>Referral</h2>
            @csrf
            <div class="col-md-12 col-12">
                <p>My Code: {{ user('id') }}</p>
            </div>
            <div class="col-md-12 col-12">
                <p>My URL:</p>
                <input type="text" class="form-control" id="tl_referral_url" readonly
                    value="{{ url('register?refer=' . user('id')) }}">
                <button type="button" class="btn btn-primary mt-2" id="tl_copy_referral">Copy link</button>
            </div>
        </form>
    </div>
    <script>
        document.getElementById('tl_copy_referral').addEventListener('click', function () {
            var input = document.getElementById('tl_referral_url');
            var btn = this;
            navigator.clipboard.writeText(input.value).then(function () {
                btn.textContent = 'Copied!';
                setTimeout(function () { btn.textContent = 'Copy link'; }, 1500);
            });
        });
    </script>
@endsection
