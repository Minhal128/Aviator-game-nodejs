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
                        class="btn btn-transparent dropdown-toggle p-0 d-flex align-items-center justify-content-center caret-none"
                        data-bs-toggle="dropdown" aria-expanded="false">
                        <span class="material-symbols-outlined f-24 menu-icon text-white">
                            menu
                        </span>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-end dropdown-menu-dark profile-dropdown p-0">
                        <li class="profile-head d-flex justify-content-between align-items-center">
                            <div class="d-flex align-items-center">
                                <img src="images/avtar/av-1.png" class="avtar-ico" id="avatar_img">
                                <div>
                                    <div class="profile-name mb-1">{{ user('email') }} </div>
                                    <div class="profile-name" id="username">{{ user('id') }}</div>
                                </div>

                            </div>
                        </li>


                        <li>
                            <a href="/crash" class="f-12 justify-content-between">
                                <div class="d-flex align-items-center">
                                    <span class="material-symbols-outlined ico f-20">
                                        flight_takeoff
                                    </span>
                                    <img src="/images/logo.jpeg" class="side_logo" alt="Turbo Legends">
                                </div>
                            </a>
                        </li>
                        <li>
                            <a href="/chicken-road/" class="f-12 justify-content-between">
                                <div class="d-flex align-items-center">
                                    <span class="material-symbols-outlined ico f-20">pets</span>
                                    CHICKEN ROAD
                                </div>
                            </a>
                        </li>
                        <li>
                            <a href="/ludo/" class="f-12 justify-content-between">
                                <div class="d-flex align-items-center">
                                    <span class="material-symbols-outlined ico f-20">casino</span>
                                    LUDO
                                </div>
                            </a>
                        </li>
                        <li>
                            <a href="/gold-egypt/" class="f-12 justify-content-between">
                                <div class="d-flex align-items-center">
                                    <span class="material-symbols-outlined ico f-20">diamond</span>
                                    GOLD OF EGYPT
                                </div>
                            </a>
                        </li>
                        <li>
                            <a href="/slot-glamour/" class="f-12 justify-content-between">
                                <div class="d-flex align-items-center">
                                    <span class="material-symbols-outlined ico f-20">stars</span>
                                    GLAMOUR SPINS
                                </div>
                            </a>
                        </li>

                        <li>
                            <a href="/deposit" class="f-12 justify-content-between">
                                <div class="d-flex align-items-center">
                                    <span class="material-symbols-outlined ico f-20">
                                        payments
                                    </span>DEPOSIT FUNDS
                                </div>
                            </a>
                        </li>
                        <li>
                            <a href="/withdraw" class="f-12 justify-content-between">
                                <div class="d-flex align-items-center">
                                    <span class="material-symbols-outlined ico f-20">
                                        payments
                                    </span>WITHDRAW FUNDS FROM THE ACCOUNT
                                </div>
                            </a>
                        </li>
                        <li>
                            <a href="/amount-transfer" class="f-12 justify-content-between">
                                <div class="d-flex align-items-center">
                                    <span class="material-symbols-outlined ico f-20">
                                        payments
                                    </span>AMOUNT TRANSFER
                                </div>
                            </a>
                        </li>
                        <li>
                            <a href="/profile" class="f-12 justify-content-between">
                                <div class="d-flex align-items-center">
                                    <span class="material-symbols-outlined ico f-20">
                                        account_circle
                                    </span>PERSONAL DETAILS
                                </div>
                            </a>
                        </li>
                        {{-- <li>
                            <a href="#" class="f-12 justify-content-between">
                                <div class="d-flex align-items-center">
                                    <span class="material-symbols-outlined ico f-20">
                                        payments
                                    </span>TRANSFER FUNDS
                                </div>
                            </a>
                        </li> --}}
                        <li>
                            <a href="/deposit_withdrawals" class="f-12 justify-content-between">
                                <div class="d-flex align-items-center">
                                    <span class="material-symbols-outlined ico f-20">
                                        payments
                                    </span>TRANSACTION HISTORY
                                </div>
                            </a>
                        </li>
                        <li>
                            <a href="/level-management" class="f-12 justify-content-between">
                                <div class="d-flex align-items-center">
                                    <span class="material-symbols-outlined ico f-20">
                                        payments
                                    </span>LEVEL MANAGEMENT
                                </div>
                            </a>
                        </li>
                        <li>
                            <a href="/referal" class="f-12 justify-content-between">
                                <div class="d-flex align-items-center">
                                    <span class="material-symbols-outlined ico f-20">
                                        payments
                                    </span>REFERRAL
                                </div>
                            </a>
                        </li>
                        <li>
                            <a href="/logout" class="f-12 justify-content-between">
                                <div class="d-flex align-items-center">
                                    <span class="material-symbols-outlined ico f-20">
                                        payments
                                    </span>SIGN OUT
                                </div>
                            </a>
                        </li>
                    </ul>
                </div>
            </div>
        @else
            <div class="header-right d-flex align-items-center">
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
