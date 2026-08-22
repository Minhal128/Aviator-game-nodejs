@extends('Layout.usergame2')
@section('content')
    @php($url = url('register?refer=' . user('id')))
    <div class="tl-wallet tl-ref">
        <div class="tl-wallet-head">
            <h1>Invite &amp; Earn</h1>
            <div class="tl-wallet-bal">Get <b>&#8377;{{ number_format($bonus, 0) }}</b> every time a friend signs up with your link</div>
        </div>

        <div class="tl-ref-card">
            <span class="tl-ref-label">Your referral code</span>
            <div class="tl-ref-code">
                <span id="tl_referral_code">{{ user('id') }}</span>
                <button type="button" class="tl-ref-icon" data-copy="#tl_referral_code" aria-label="Copy code">
                    <span class="material-symbols-outlined">content_copy</span>
                </button>
            </div>

            <span class="tl-ref-label">Your invite link</span>
            <div class="tl-ref-url">
                <input type="text" id="tl_referral_url" value="{{ $url }}" readonly aria-label="Referral link">
                <button type="button" class="tl-ref-icon" data-copy="#tl_referral_url" aria-label="Copy link">
                    <span class="material-symbols-outlined">content_copy</span>
                </button>
            </div>

            <div class="tl-ref-actions">
                <button type="button" class="tl-btn tl-btn-primary tl-btn-block" id="tl_share">
                    <span class="material-symbols-outlined">share</span> SHARE LINK
                </button>
                <a class="tl-btn tl-btn-ghost tl-btn-block" id="tl_whatsapp"
                   href="https://wa.me/?text={{ rawurlencode('Play on Turbo Legends and get a signup bonus: ' . $url) }}"
                   target="_blank" rel="noopener">
                    <span class="material-symbols-outlined">chat</span> WHATSAPP
                </a>
            </div>
        </div>

        <div class="tl-ref-stats">
            <div class="tl-ref-stat">
                <span class="tl-ref-stat-num">{{ $invited }}</span>
                <span class="tl-ref-stat-label">Friends joined</span>
            </div>
            <div class="tl-ref-stat">
                <span class="tl-ref-stat-num tl-ref-stat-cash">&#8377;{{ number_format($earned, 2) }}</span>
                <span class="tl-ref-stat-label">Bonus earned</span>
            </div>
        </div>

        <ol class="tl-ref-steps">
            <li><b>Share</b> your link with friends.</li>
            <li>They <b>register</b> — your code fills in for them.</li>
            <li>You both get a <b>bonus</b> credited instantly.</li>
        </ol>
    </div>

    <script>
        (function () {
            function flash(btn) {
                var ico = btn.querySelector('.material-symbols-outlined');
                btn.classList.add('is-copied');
                ico.textContent = 'check';
                setTimeout(function () {
                    btn.classList.remove('is-copied');
                    ico.textContent = 'content_copy';
                }, 1400);
            }

            document.querySelectorAll('[data-copy]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var el = document.querySelector(btn.dataset.copy);
                    var text = el.value !== undefined ? el.value : el.textContent.trim();
                    // clipboard API needs https; select+execCommand is the http fallback
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(text).then(function () { flash(btn); });
                    } else if (el.select) {
                        el.select();
                        document.execCommand('copy');
                        flash(btn);
                    }
                });
            });

            var share = document.getElementById('tl_share');
            var url = document.getElementById('tl_referral_url').value;
            share.addEventListener('click', function () {
                if (navigator.share) {
                    navigator.share({ title: 'Turbo Legends', text: 'Play on Turbo Legends and get a signup bonus', url: url });
                } else {
                    document.getElementById('tl_whatsapp').click();
                }
            });
        })();
    </script>
@endsection
