 <!-- partial:partials/_sidebar.html -->
 <nav class="sidebar sidebar-offcanvas" id="sidebar">
     <ul class="nav">
         <li class="nav-item nav-profile">
             <a href="/admin/dashboard" class="nav-link">
                 <div class="nav-profile-image">
                     <img src="/aviatoradmin/assets/images/faces/face1.jpg" alt="profile">
                     <span class="login-status online"></span>
                 </div>
                 <div class="nav-profile-text d-flex flex-column">
                     <span class="font-weight-bold mb-2">{{admin('name')}}</span>
                     <span class="text-secondary text-small">Signal Tower</span>
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
         <li class="nav-item">
             <a class="nav-link" href="recharge-history">
                 <span class="menu-title">Recharges</span>
                 <i class="mdi mdi-cash-plus menu-icon"></i>
             </a>
         </li>
         <li class="nav-item">
             <a class="nav-link" href="withdrawal-history">
                 <span class="menu-title">Withdrawals</span>
                 <i class="mdi mdi-cash-minus menu-icon"></i>
             </a>
         </li>
         <li class="nav-item">
             <a class="nav-link" href="amount-setup">
                 <span class="menu-title">Limits &amp; setup</span>
                 <i class="mdi mdi-tune menu-icon"></i>
             </a>
         </li>
         <li class="nav-item">
             <a class="nav-link" href="bank-detail">
                 <span class="menu-title">Bank rails</span>
                 <i class="mdi mdi-bank menu-icon"></i>
             </a>
         </li>
     </ul>
 </nav>
 <!-- partial -->
