@extends('Layout.usergame')
@section('content')
@php
    // ponytail: static copy for all five footer pages lives in this one file.
    // Swap the support address for the real one before launch.
    $support = 'support@turbolegends.in';
    $pages = [
        'about' => ['About us', 'Turbo Legends is an online games club built around five titles and one wallet.', <<<'HTML'
<h3>Who we are</h3>
<p>Turbo Legends runs a small, hand-picked lobby instead of a catalogue of a thousand
clones. Every title on the site is one we operate ourselves: <b>Aviator</b>, <b>Chicken Road</b>,
<b>Ludo Royale</b>, <b>Gold of Egypt</b> and <b>Glamour Spins</b>. One account, one balance,
no juggling sub-wallets between games.</p>

<h3>How a round works</h3>
<p>Bets are placed before a round starts. The result of that round is decided on our
server, not in your browser, and the same result is served to every player in the
round. In Aviator that means the crash point is fixed server-side before the plane
takes off, and your cash-out is settled against the multiplier that was live at the
moment your request reached the server.</p>

<h3>Payouts</h3>
<p>Winnings land in your Turbo Legends balance the instant a round is settled. Moving that
balance to your bank or UPI is a separate withdrawal request, reviewed by our team &mdash;
see <a href="/rules">The rules</a> for what we check.</p>

<h3>Play inside your limits</h3>
<p>Turbo Legends is entertainment, not income. The site is for players aged 18 and over.
Never stake money you need for something else, decide a budget before you open a game,
and stop when you hit it. If gambling has stopped being a choice for you, write to us
and we will freeze or close your account the same day &mdash; no questions.</p>
HTML],

        'rules' => ['The rules', 'The short version of what you agree to when you play here.', <<<'HTML'
<h3>1. Your account</h3>
<ul>
<li>One account per person. Duplicates are closed and their balances frozen.</li>
<li>Register with details that are actually yours &mdash; withdrawals are paid only to an
account in the same name.</li>
<li>You are responsible for your password. Anything played from your session counts as
played by you.</li>
<li>Minimum age is 18.</li>
</ul>

<h3>2. Bets and rounds</h3>
<ul>
<li>A bet is accepted only while the round is open for betting. Once a round starts its
outcome is already fixed on the server and cannot be changed by anyone, including us.</li>
<li>A cash-out counts at the multiplier that was live when your request reached the
server. Network lag is not grounds for a re-settle.</li>
<li>If a round fails to complete &mdash; a restart or a fault on our side &mdash; every stake in
that round is returned in full. A void round pays neither side.</li>
<li>Stake limits per round are shown on the game screen.</li>
</ul>

<h3>3. Deposits</h3>
<ul>
<li>Deposit only from a payment method in your own name. The methods and limits available
to you are shown on the deposit screen.</li>
<li>A deposit is credited once the payment clears. If it does not appear, send us the
reference number and we will trace it.</li>
</ul>

<h3>4. Withdrawals</h3>
<ul>
<li>Requests are reviewed in the order they arrive, during working hours.</li>
<li>We may ask for ID before a first payout, or when the payout details change.</li>
<li>We do not pay out to a third party's account.</li>
<li>Promotional credit has to be played through before it can be withdrawn.</li>
</ul>

<h3>5. Fair play</h3>
<p>Automated play, scripted clients, farming a bug instead of reporting it, and collusion
between accounts all end the same way: the account is closed and the affected winnings
are reversed. Report a bug to <a href="/contacts">support</a> instead and we will
thank you properly.</p>

<h3>6. Changes</h3>
<p>These rules can change. The version on this page is the one that applies, and material
changes are announced on the lobby before they take effect.</p>
HTML],

        'contacts' => ['Contacts', 'A real person reads every message. Give us enough to find your account.', <<<HTML
<h3>Support</h3>
<p><b>Email:</b> <a href="mailto:{$support}">{$support}</a><br>
<b>Hours:</b> 09:00 &ndash; 23:00 IST, every day<br>
<b>First reply:</b> usually within a few hours, always inside 24.</p>

<h3>What to include</h3>
<ul>
<li>Your user ID (top of the profile menu) or the email you registered with.</li>
<li>The game, and roughly when it happened.</li>
<li>For a payment: the amount and the transaction / UTR reference.</li>
<li>A screenshot, if there is anything to see.</li>
</ul>
<p>Please do not send your password. Nobody from Turbo Legends will ever ask for it.</p>

<h3>Payments and withdrawals</h3>
<p>Same address &mdash; put <b>PAYMENT</b> in the subject line and it goes straight to the
payouts queue.</p>

<h3>Complaints</h3>
<p>If an answer from support does not hold up, reply in the same thread and ask for it to
be escalated. Escalated cases get a written decision, including what we found in the
round logs.</p>

<h3>Account closure</h3>
<p>Ask us to close, freeze, or take a break and we will do it the same day. A freeze blocks
new bets and deposits while leaving your balance withdrawable.</p>
HTML],

        'affiliate' => ['Affiliate program', 'Bring players in, earn from their play for as long as they play.', <<<'HTML'
<h3>How it works</h3>
<p>Every account is an affiliate account &mdash; there is nothing to apply for. Your referral
code is your user ID and your invite link is on the <a href="/referal">Referral</a> page
inside your account. Anyone who registers through that link is tied to you permanently.</p>

<h3>Three levels</h3>
<p>Referrals are tracked three levels deep:</p>
<ul>
<li><b>Level 1</b> &mdash; players who signed up with your link.</li>
<li><b>Level 2</b> &mdash; players their referrals brought in.</li>
<li><b>Level 3</b> &mdash; one level further down.</li>
</ul>
<p>Your live tree, with counts per level, is on the
<a href="/level-management">Level management</a> page. Commission rates per level are set
on your account and shown there; they are paid on turnover, so you earn whether your
referrals win or lose.</p>

<h3>Getting paid</h3>
<p>Commission is credited to your normal Turbo Legends balance. Withdraw it exactly like
any other winnings.</p>

<h3>What gets you removed</h3>
<ul>
<li>Registering accounts yourself to farm your own link.</li>
<li>Spam, or promoting the site anywhere aimed at under-18s.</li>
<li>Promising guaranteed wins, faking screenshots, or claiming to be Turbo Legends staff.</li>
</ul>
<p>Referral earnings from any of the above are reversed.</p>
HTML],

        'faq' => ['FAQ', 'The questions support actually gets.', <<<'HTML'
<details open><summary>Do I need an account to play?</summary>
<p>Yes. Rounds are settled server-side against a real balance, so every game needs a
logged-in account. Registering from the lobby takes about a minute.</p></details>

<details><summary>Is the Aviator crash point random, or fixed?</summary>
<p>It is generated on our server before the round starts and is identical for every player
in that round. Nothing in your browser can move it, and neither can we once the round
is open.</p></details>

<details><summary>I cashed out and got a lower multiplier than I saw.</summary>
<p>The multiplier on screen is drawn by your browser; the one that pays is the one live on
the server when your tap arrived. On a slow connection those differ slightly. Your bet
history shows the exact value we settled at.</p></details>

<details><summary>How long does a withdrawal take?</summary>
<p>Requests are reviewed during working hours and paid in the order received. A first
payout can take longer because we verify ID once.</p></details>

<details><summary>My deposit has not shown up.</summary>
<p>Send us the amount and the transaction reference. If the money left your bank, we can
find it.</p></details>

<details><summary>Can I change my registered email or phone?</summary>
<p>Write to support from the address on the account. We change it after a check, because
payout details are tied to it.</p></details>

<details><summary>Why was my bet not accepted?</summary>
<p>Almost always because the betting window for that round had closed, or the stake was
outside the limits shown on the game screen. Place it again in the next round.</p></details>

<details><summary>Can I play on my phone?</summary>
<p>Yes. The whole site, all five games included, runs in a mobile browser. There is nothing
to install.</p></details>

<details><summary>How do I take a break or close my account?</summary>
<p>Ask support. A freeze stops bets and deposits and leaves your balance withdrawable; a
closure is permanent.</p></details>
HTML],
    ];

    [$title, $lead, $body] = $pages[$slug];
    $nav = ['about' => 'About us', 'rules' => 'The rules', 'contacts' => 'Contacts', 'affiliate' => 'Affiliate program', 'faq' => 'FAQ'];
@endphp
<div class="tl-lobby tl-doc">
    <nav class="tl-crumb"><a href="/dashboard">Home</a> <span>/</span> {{ $title }}</nav>
    <h1>{{ $title }}</h1>
    <p class="tl-doc-lead">{{ $lead }}</p>
    <article class="tl-doc-body">{!! $body !!}</article>
    <div class="tl-doc-more">
        @foreach ($nav as $s => $t)
            @if ($s !== $slug)
                <a href="/{{ $s }}">{{ $t }}</a>
            @endif
        @endforeach
    </div>
</div>
@endsection
