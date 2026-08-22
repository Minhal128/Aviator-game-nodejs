{{-- covers FOUC / broken owl-lazy imgs until the page is ready --}}
<style>
#tl-boot{position:fixed;inset:0;z-index:99999;background:#070b14;display:flex;align-items:center;justify-content:center;transition:opacity .2s}
#tl-boot.is-done{opacity:0;pointer-events:none}
.tl-boot-spin{width:36px;height:36px;border:3px solid rgba(255,255,255,.15);border-top-color:#e50539;border-radius:50%;animation:tl-boot-spin .7s linear infinite}
@keyframes tl-boot-spin{to{transform:rotate(360deg)}}
</style>
<div id="tl-boot" aria-busy="true" aria-label="Loading"><div class="tl-boot-spin"></div></div>
<script>
(function () {
  var b = document.getElementById('tl-boot');
  function hide() {
    if (!b || b.classList.contains('is-done')) return;
    b.classList.add('is-done');
    b.setAttribute('aria-busy', 'false');
    setTimeout(function () { if (b && b.parentNode) b.parentNode.removeChild(b); }, 220);
  }
  if (document.readyState === 'complete') hide();
  else window.addEventListener('load', hide);
  // ponytail: same overlay on in-app navigations so empty/broken states never flash
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.getAttribute('data-bs-toggle')) return;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) return;
    try { if (new URL(a.href, location.href).origin !== location.origin) return; } catch (err) { return; }
    if (!document.getElementById('tl-boot')) {
      var n = document.createElement('div');
      n.id = 'tl-boot';
      n.setAttribute('aria-busy', 'true');
      n.innerHTML = '<div class="tl-boot-spin"></div>';
      document.body.appendChild(n);
    }
  }, true);
})();
</script>
