<!-- partial:partials/_navbar.html -->
<nav class="navbar default-layout-navbar col-lg-12 col-12 p-0 fixed-top d-flex flex-row">
    <div class="text-center navbar-brand-wrapper d-flex align-items-center justify-content-center">
      <a class="navbar-brand brand-logo" href="/admin/dashboard">
        <span class="tl-brand" aria-label="Turbo Legends">
        <svg class="tl-brand-mark" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M4 18 L28 10 L22 18 L28 22 L4 18 Z" fill="#e50539"/>
          <path d="M8 18 L14 16.5" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity="0.7"/>
        </svg>
        <span class="tl-brand-text"><b>TURBO</b><span>LEGENDS</span></span>
      </span>
      </a>
      <a class="navbar-brand brand-logo-mini" href="/admin/dashboard">
        <svg class="tl-brand-mark" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Turbo Legends">
          <path d="M4 18 L28 10 L22 18 L28 22 L4 18 Z" fill="#e50539"/>
        </svg>
      </a>
    </div>
    <div class="navbar-menu-wrapper d-flex align-items-stretch">
      <button class="navbar-toggler navbar-toggler align-self-center" type="button" data-toggle="minimize">
        <span class="mdi mdi-menu"></span>
      </button>
      <ul class="navbar-nav navbar-nav-right ms-auto">
        <li class="nav-item d-none d-md-flex align-items-center me-3">
          <div id="nav_live_pill" class="tl-live-pill is-idle">
            <span class="dot"></span>
            <span class="lbl">TOWER</span>
          </div>
        </li>
        <li class="nav-item nav-profile dropdown">
          <a class="nav-link dropdown-toggle" id="profileDropdown" href="#" data-bs-toggle="dropdown" aria-expanded="false">
            <div class="nav-profile-img">
              <img src="/aviatoradmin/assets/images/faces/face1.jpg" alt="image">
              <span class="availability-status online"></span>
            </div>
            <div class="nav-profile-text">
              <p class="mb-1 text-black">{{admin('name')}}</p>
            </div>
          </a>
          <div class="dropdown-menu navbar-dropdown" aria-labelledby="profileDropdown">
            <a class="dropdown-item" href="change-password">
              <i class="mdi mdi-cached me-2 text-success"></i> Change Password </a>
            <div class="dropdown-divider"></div>
            <a class="dropdown-item" href="/admin/logout">
              <i class="mdi mdi-logout me-2 text-primary"></i> Signout </a>
          </div>
        </li>
        <li class="nav-item d-none d-lg-block full-screen-link">
          <a class="nav-link">
            <i class="mdi mdi-fullscreen" id="fullscreen-button"></i>
          </a>
        </li>
      </ul>
      <button class="navbar-toggler navbar-toggler-right d-lg-none align-self-center" type="button" data-toggle="offcanvas">
        <span class="mdi mdi-menu"></span>
      </button>
    </div>
  </nav>
  <!-- partial -->
