 <!-- partial:partials/_sidebar.html -->
 <nav class="sidebar sidebar-offcanvas" id="sidebar">
     <ul class="nav">
         <li class="nav-item nav-profile">
             <a href="/admin/dashboard" class="nav-link">
                 <div class="nav-profile-image">
                     <img src="/css/tl/images/faces/face1.jpg" alt="profile">
                     <span class="login-status online"></span>
                 </div>
                 <div class="nav-profile-text d-flex flex-column">
                     <span class="font-weight-bold mb-2">{{admin('name')}}</span>
                     <span class="text-secondary text-small">{{admin('email')}}</span>
                 </div>
                 <i class="mdi mdi-airplane text-success nav-profile-badge"></i>
             </a>
         </li>
         <li class="nav-item">
             <a class="nav-link" href="dashboard">
                 <span class="menu-title">Control Tower</span>
                 <i class="mdi mdi-radar menu-icon"></i>
             </a>
         </li>
         <li class="nav-item">
             <a class="nav-link" href="user-list">
                 <span class="menu-title">Players</span>
                 <i class="mdi mdi-account-multiple menu-icon"></i>
             </a>
         </li>
         <li class="nav-section">Money</li>
         <li class="nav-item">
             <a class="nav-link" href="deposits">
                 <span class="menu-title">Deposits</span>
                 <i class="mdi mdi-cash-multiple menu-icon"></i>
             </a>
         </li>
         <li class="nav-item">
             <a class="nav-link" href="withdrawals">
                 <span class="menu-title">Withdrawals</span>
                 <i class="mdi mdi-cash-refund menu-icon"></i>
             </a>
         </li>
         <li class="nav-section">Settings</li>
         <li class="nav-item">
             <a class="nav-link" href="bank-detail">
                 <span class="menu-title">Bank rails</span>
                 <i class="mdi mdi-bank menu-icon"></i>
             </a>
         </li>
         <li class="nav-item">
             <a class="nav-link" href="referral">
                 <span class="menu-title">Referral</span>
                 <i class="mdi mdi-account-plus menu-icon"></i>
             </a>
         </li>
     </ul>
 </nav>
 <!-- partial -->
