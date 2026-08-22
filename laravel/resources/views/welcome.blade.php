@extends('Layout.usergame')
@section('content')
@php
    $loggedIn = session()->has('userlogin');
    // name, tag, tile, hero banner, route, blurb, demo (fun coins, not the wallet)
    $games = [
        ['Aviator', 'Crash', asset('images/tile-aviator.jpg'), asset('images/slider2.jpg'), '/crash', 'Cash out before the plane flies away.', false],
        ['Chicken Road', 'Arcade', asset('images/tile-chicken-road.jpg'), asset('images/slider5.jpg'), '/chicken-road/', 'Cross the traffic, bank your multiplier.', false],
        ['Ludo Royale', 'Multiplayer', asset('images/tile-ludo.jpg'), asset('images/slider4.jpg'), '/ludo/', 'Real players, real money boards.', false],
        ['Gold of Egypt', 'Slot', asset('images/tile-gold-egypt.jpg'), asset('images/slider3.jpg'), '/gold-egypt/', '243 ways to win, wilds, free spins.', false],
        ['Glamour Spins', 'Slot', asset('images/tile-slot-glamour.jpg'), asset('images/slider1.jpg'), '/slot-glamour/', 'Cascading match-3 reels, free spins.', false],
    ];
@endphp
<div class="tl-lobby">
    <section class="tl-slider-wrap">
        {{-- owl is already loaded and js/main.js inits every .owl-carousel (loop + autoplay + lazyLoad) --}}
        <div class="owl-carousel tl-slider">
            @foreach ($games as [$name, $tag, $tile, $banner, $href, $desc, $demo])
                <a class="tl-slide"
                    @if ($loggedIn) href="{{ $href }}"
                    @else href="javascript:void(0);" data-bs-toggle="modal" data-bs-target="#login-modal" @endif>
                    <img class="owl-lazy" data-src="{{ $banner }}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="{{ $name }}">
                </a>
            @endforeach
        </div>
        {{-- the artwork already paints an arrow on each edge, these strips just make them work --}}
        <button type="button" class="tl-slide-nav tl-slide-prev" aria-label="Previous game"></button>
        <button type="button" class="tl-slide-nav tl-slide-next" aria-label="Next game"></button>
    </section>

    <section class="tl-hero-bar">
        <div>
            <span class="tl-kicker">5 games &middot; one wallet</span>
            <p>Aviator, Chicken Road, Ludo Royale and two slots — all on a single Turbo Legends balance.</p>
        </div>
        <div class="tl-cta">
            @if ($loggedIn)
                <a href="/crash" class="tl-btn tl-btn-primary">PLAY AVIATOR</a>
                <a href="/deposit" class="tl-btn tl-btn-ghost">DEPOSIT</a>
                <span class="tl-balance">Balance <b>&#8377;{{ wallet(user('id')) }}</b></span>
            @else
                <button class="tl-btn tl-btn-primary" data-bs-toggle="modal" data-bs-target="#register-modal">CREATE ACCOUNT</button>
                <button class="tl-btn tl-btn-ghost" data-bs-toggle="modal" data-bs-target="#login-modal">LOGIN</button>
            @endif
        </div>
    </section>

    <div class="tl-section-head">
        <h2>Our games</h2>
        <span>{{ $loggedIn ? 'Pick a table' : 'Login to play' }}</span>
    </div>
    <div class="tl-grid">
        @foreach ($games as [$name, $tag, $tile, $banner, $href, $desc, $demo])
            <article class="tl-card{{ $tag === 'Slot' ? ' tl-card--slot' : '' }}{{ $name === 'Gold of Egypt' ? ' tl-card--egypt' : '' }}{{ $name === 'Glamour Spins' ? ' tl-card--glamour' : '' }}">
                <div class="tl-card-media">
                    <img src="{{ $tile }}" alt="{{ $name }}" loading="lazy">
                    <span class="tl-tag">{{ $tag }}</span>
                    @if ($demo)
                        {{-- these two still run on their own fun coins, the wallet is not wired --}}
                        <span class="tl-tag tl-tag-demo">DEMO</span>
                    @endif
                </div>
                <div class="tl-card-body">
                    <h3>{{ $name }}</h3>
                    <p>{{ $desc }}</p>
                    @if ($loggedIn)
                        <a href="{{ $href }}" class="tl-btn {{ $demo ? 'tl-btn-ghost' : 'tl-btn-primary' }} tl-btn-block">{{ $demo ? 'PLAY DEMO' : 'PLAY NOW' }}</a>
                    @else
                        <button class="tl-btn tl-btn-ghost tl-btn-block" data-bs-toggle="modal" data-bs-target="#login-modal">LOGIN TO PLAY</button>
                    @endif
                </div>
            </article>
        @endforeach
    </div>
</div>
@endsection
@section('js')
<script>
    // owl is set up with nav:false in js/main.js, so drive it from the edge strips
    $(function () {
        $('.tl-slide-prev').on('click', function () { $('.tl-slider').trigger('prev.owl.carousel'); });
        $('.tl-slide-next').on('click', function () { $('.tl-slider').trigger('next.owl.carousel'); });
    });
</script>
@endsection
