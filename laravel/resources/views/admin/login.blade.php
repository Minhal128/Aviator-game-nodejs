<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>{{env('APP_NAME')}} - Login Panel</title>
    <link rel="shortcut icon" href="/images/logo.jpeg" type="image/jpeg" />
    <link rel="stylesheet" href="/css/iziToast.min.css">
    <style>
      :root {
        --ink: #070b14;
        --panel: #131c2e;
        --line: rgba(255, 255, 255, .09);
        --text: #e9eefb;
        --muted: #8ea3c6;
        --red: #e50539;
        --gold: #ffb020;
      }
      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; }
      body {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        font-family: system-ui, sans-serif;
        color: var(--text);
        background:
          radial-gradient(900px 500px at 10% -10%, rgba(229, 5, 57, .18), transparent 55%),
          radial-gradient(700px 400px at 100% 0%, rgba(255, 176, 32, .08), transparent 50%),
          var(--ink);
      }
      .card {
        width: min(420px, 100%);
        padding: 32px 28px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: linear-gradient(160deg, #1a2540, #131c2e);
        box-shadow: 0 24px 64px rgba(0, 0, 0, .55);
      }
      .brand {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        margin-bottom: 18px;
      }
      .brand svg { width: 28px; height: 28px; flex-shrink: 0; }
      .brand b {
        display: block;
        color: var(--red);
        letter-spacing: .14em;
        font-size: .95rem;
      }
      .brand i {
        display: block;
        color: #c8cddb;
        letter-spacing: .28em;
        font-size: .62rem;
        font-weight: 600;
        font-style: normal;
        margin-top: 2px;
      }
      .badge {
        display: block;
        text-align: center;
        color: var(--gold);
        font-size: .7rem;
        letter-spacing: .12em;
        text-transform: uppercase;
        margin-bottom: 8px;
      }
      h1 { margin: 0 0 6px; text-align: center; font-size: 1.35rem; }
      .sub { margin: 0 0 22px; text-align: center; color: var(--muted); font-size: .9rem; }
      input {
        width: 100%;
        margin-bottom: 14px;
        padding: 12px 14px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: #0e1626;
        color: var(--text);
        font-size: 1rem;
      }
      input:focus { outline: 0; border-color: var(--gold); }
      button {
        width: 100%;
        margin-top: 8px;
        padding: 13px;
        border: 1px solid var(--red);
        border-radius: 10px;
        background: linear-gradient(135deg, #e50539, #9a0426);
        color: #fff;
        font-weight: 700;
        letter-spacing: .04em;
        cursor: pointer;
      }
      button:hover { filter: brightness(1.08); }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="brand" aria-label="Turbo Legends">
        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M4 18 L28 10 L22 18 L28 22 L4 18 Z" fill="#e50539"/>
          <path d="M8 18 L14 16.5" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity="0.7"/>
        </svg>
        <span><b>TURBO</b><i>LEGENDS</i></span>
      </div>
      <span class="badge">Signal Tower</span>
      <h1>Command access</h1>
      <p class="sub">Authorize to open the control tower.</p>
      <form id="loginadmin">
        @csrf
        <input type="text" id="username" name="username" placeholder="Username" autocomplete="username" required>
        <input type="password" id="password" name="password" placeholder="Password" autocomplete="current-password" required>
        <button type="submit">ENTER TOWER</button>
      </form>
    </div>
    <script src="{{ asset('vendor/jquery/jquery-3.6.1.min.js') }}"></script>
    <script src="{{ asset('vendor/jquery-validation/dist/jquery.validate.min.js') }}"></script>
    <script src="/js/iziToast.min.js"></script>
    <script src="/js/appcustomize.js"></script>
    <script>
        $("#loginadmin").on('submit', function(e) {
            e.preventDefault();
        });
        $("#loginadmin").validate({
            submitHandler: function(form) {
                apex("POST", "{{url('auth/admin/login')}}", new FormData(form), form, "/admin/dashboard", "#");
            }
        });
    </script>
  </body>
</html>
