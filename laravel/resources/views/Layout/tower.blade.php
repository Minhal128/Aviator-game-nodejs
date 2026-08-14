<!DOCTYPE html>
<html lang="en">
<head>
    @include('include.admin.tlhead')
    @yield('css')
</head>
<body>
    <div class="container-scroller">
        @include('include.admin.tlheader')
        <div class="container-fluid page-body-wrapper">
            @include('include.admin.tlsidebar')
            <div class="main-panel">
                @yield('content')
                @include('include.admin.footer')
            </div>
        </div>
    </div>
    @include('include.admin.tlfoot')
    @yield('js')
</body>
</html>
