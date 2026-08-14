<!--====== Header Start ======-->
<header>
    <div class="header-top">
        <div class="header-left" onclick="window.location.href='/dashboard'">
            <a href="dashboard" class="tl-brand" aria-label="Turbo Legends" onclick="event.stopPropagation()">
                <svg class="tl-brand-mark" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M4 18 L28 10 L22 18 L28 22 L4 18 Z" fill="#E50539"/>
                    <path d="M8 18 L14 16.5" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity="0.7"/>
                </svg>
                <span class="tl-brand-text"><b>TURBO</b><span>LEGENDS</span></span>
            </a>
        </div>
        @if (session()->has('userlogin'))
            <div class="header-right d-flex align-items-center">
                <a href="/deposit">
                    <button class="deposite-btn rounded-pill d-flex align-items-center me-2">
                        <span class="material-symbols-outlined me-2"> payments </span>
                        <!-- <span>$</span> -->
                        <span class="me-2" id="header_wallet_balance">₹{{ wallet(user('id')) }}</span>
                        DEPOSIT
                    </button>
                </a>
                <div class="btn-group">
                    <button type="button"
                        class="btn btn-transparent dropdown-toggle p-0 d-flex align-items-center justify-content-center caret-none tl-burger"
                        data-bs-toggle="dropdown" aria-expanded="false">
                        <span class="material-symbols-outlined f-24 menu-icon text-white">
                            menu
                        </span>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-end dropdown-menu-dark profile-dropdown p-0">
                        <li class="profile-head">
                            <img src="images/avtar/av-1.png" class="avtar-ico" id="avatar_img">
                            <div class="tl-profile-meta">
                                <div class="profile-name" title="{{ user('email') }}">{{ user('email') }}</div>
                                <div class="tl-profile-id">ID <span id="username">{{ user('id') }}</span></div>
                            </div>
                        </li>
                        <li class="tl-menu-wallet">
                            <span class="tl-menu-wallet-label">Balance</span>
                            <span class="tl-menu-wallet-amt">₹{{ wallet(user('id')) }}</span>
                            <a href="/deposit" class="tl-menu-topup">Top up</a>
                        </li>
                        <li class="tl-menu-sec">Games</li>
                        <li>
                            <a href="/crash" class="tl-mi">
                                <span class="material-symbols-outlined ico">flight_takeoff</span>
                                <span class="tl-mi-label">Aviator</span>
                            </a>
                        </li>
                        <li>
                            <a href="/chicken-road/" class="tl-mi">
                                <span class="material-symbols-outlined ico">pets</span>
                                <span class="tl-mi-label">Chicken Road</span>
                            </a>
                        </li>
                        <li>
                            <a href="/ludo/" class="tl-mi">
                                <span class="material-symbols-outlined ico">casino</span>
                                <span class="tl-mi-label">Ludo</span>
                            </a>
                        </li>
                        <li>
                            <a href="/gold-egypt/" class="tl-mi">
                                <span class="material-symbols-outlined ico">diamond</span>
                                <span class="tl-mi-label">Gold of Egypt</span>
                            </a>
                        </li>
                        <li>
                            <a href="/slot-glamour/" class="tl-mi">
                                <span class="material-symbols-outlined ico">stars</span>
                                <span class="tl-mi-label">Glamour Spins</span>
                            </a>
                        </li>
                        <li class="tl-menu-sec">Wallet</li>
                        <li>
                            <a href="/deposit" class="tl-mi">
                                <span class="material-symbols-outlined ico">account_balance_wallet</span>
                                <span class="tl-mi-label">Deposit funds</span>
                            </a>
                        </li>
                        <li>
                            <a href="/withdraw" class="tl-mi">
                                <span class="material-symbols-outlined ico">payments</span>
                                <span class="tl-mi-label">Withdraw funds</span>
                            </a>
                        </li>
                        <li>
                            <a href="/amount-transfer" class="tl-mi">
                                <span class="material-symbols-outlined ico">swap_horiz</span>
                                <span class="tl-mi-label">Amount transfer</span>
                            </a>
                        </li>
                        <li>
                            <a href="/deposit_withdrawals" class="tl-mi">
                                <span class="material-symbols-outlined ico">receipt_long</span>
                                <span class="tl-mi-label">Transaction history</span>
                            </a>
                        </li>
                        <li class="tl-menu-sec">Account</li>
                        <li>
                            <a href="/profile" class="tl-mi">
                                <span class="material-symbols-outlined ico">account_circle</span>
                                <span class="tl-mi-label">Personal details</span>
                            </a>
                        </li>
                        <li>
                            <a href="/level-management" class="tl-mi">
                                <span class="material-symbols-outlined ico">military_tech</span>
                                <span class="tl-mi-label">Level management</span>
                            </a>
                        </li>
                        <li>
                            <a href="/referal" class="tl-mi">
                                <span class="material-symbols-outlined ico">group_add</span>
                                <span class="tl-mi-label">Referral</span>
                            </a>
                        </li>
                        <li>
                            <a href="/logout" class="tl-mi tl-mi-danger">
                                <span class="material-symbols-outlined ico">logout</span>
                                <span class="tl-mi-label">Sign out</span>
                            </a>
                        </li>
                    </ul>
                </div>
            </div>
        @else
            <div class="header-right d-flex align-items-center">
                {{-- three full-width pills do not fit a phone header, so the label collapses to the icon --}}
                <a href="https://turbolegends-downloads.s3.ap-south-1.amazonaws.com/turbo-legends.apk"
                    class="login-btn rounded-pill d-flex align-items-center me-2" style="white-space:nowrap"
                    aria-label="Download Game">
                    <span class="material-symbols-outlined d-md-none">download</span>
                    <span class="d-none d-md-inline">Download Game</span>
                </a>
                <button class="register-btn rounded-pill d-flex align-items-center me-2 reg_btn" data-bs-toggle="modal"
                    data-bs-target="#register-modal">
                    Register
                </button>
                <button class="login-btn rounded-pill d-flex align-items-center me-2" data-bs-toggle="modal"
                    data-bs-target="#login-modal" id="login">
                    Login
                </button>
            </div>
        @endif
    </div>
</header>
<!--====== Header End ======-->
